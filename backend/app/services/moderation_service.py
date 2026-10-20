"""Сервис модерации: автофлаги, постановка в очередь и журнал действий.

Модуль намеренно не зависит от роутов, чтобы его могли использовать и API,
и фоновые задачи. Все функции принимают открытую сессию SQLAlchemy.
"""

import json
import re
from datetime import datetime, timezone
from typing import Any, List, Optional

from sqlalchemy.orm import Session

from app.models.moderation import AuditLog, ModerationTask
from app.models.price import PriceQuote
from app.models.promo import Promo
from app.models.recipe import Recipe

# ---------- Пороги ----------
# Ниже этого доверия контент всегда уходит на ручную проверку.
TRUST_THRESHOLD = 60.0
# Одобрение/отклонение двигают доверие автора.
TRUST_REWARD_APPROVE = 2.0
TRUST_PENALTY_REJECT = 5.0
TRUST_MIN = 0.0
TRUST_MAX = 100.0
# Слишком короткое описание — повод посмотреть вручную.
MIN_TEXT_LENGTH = 25
# Насколько глубоко просматриваем текст на «интересное».
MAX_SCAN_LENGTH = 5000


# ---------- Эвристики ----------
# Ссылки: явные URL, «голые» домены популярных зон, мессенджеры.
_LINK_RE = re.compile(
    r'(https?://|www\.|t\.me/|telegram\.me/|vk\.com/|vk\.me/|wa\.me/|'
    r'\b[a-z0-9-]+\.(?:ru|com|net|org|io|me|shop|site|online|store)\b)',
    re.IGNORECASE,
)

# Телефоны: +7..., 8 (999) 123-45-67, 9991234567 и т.п.
_PHONE_RE = re.compile(
    r'(\+?\d[\d\s\-()]{8,}\d)'
)

# Мессенджеры и соцсети — приглашения «в личку».
_MESSENGER_RE = re.compile(
    r'(whatsapp|ватсап|вацап|вотсап|telegram|телеграм|телега|viber|вайбер|'
    r'инстаграм|instagram|вконтакте|одноклассник|discord|скайп|skype)',
    re.IGNORECASE,
)

# Спам-маркеры и «запрещёнка».
_SPAM_RE = re.compile(
    r'(подписывайт|подпишись|подпишитесь|переходи по ссылк|жми на ссылк|'
    r'заработок|заработай|казинo|казино|ставки на спорт|букмекер|'
    r'промокод|скидочный купон|купи дешевле здесь|реклама|'
    r'купит[еь]? ?(?:диплом|курсовую|аттестат)|запрещен|запрещённ|'
    r'наркотик|18\+|интим|взлом|читер|обнал)',
    re.IGNORECASE,
)

# Мат и грубая лексика — корни слов (без учёта регистра).
_PROFANITY_RE = re.compile(
    r'(хуй|хуё|хуе|пизд|бляд|блят|ебал|ебат|ебуч|ёбал|ёбат|'
    r'мудак|мудил|залуп|манда|шлюх|сука б|сучк|гандон|пидор|пидар|'
    r'долбоёб|долбоеб|нахуй|охуе|ахуе)',
    re.IGNORECASE,
)

# Ссылки на сторонние ресурсы и телефоны в одном флаге не смешиваем:
# коды фиксированные, фронтенд показывает их как «опасные» теги.
FLAG_LABELS = {
    'link': 'Ссылка',
    'phone': 'Телефон',
    'messenger': 'Мессенджер',
    'spam': 'Спам-маркеры',
    'profanity': 'Мат/грубая лексика',
    'short_text': 'Слишком короткое описание',
    'no_photo': 'Нет фото',
}


def auto_flags_for(text: str, photo_url: Optional[str] = None) -> List[str]:
    """Простые эвристики для автофлагов модерации.

    Возвращает список кодов вида ``['link', 'phone', 'short_text']``.
    Пустой список означает «автоматика ничего подозрительного не нашла».
    """
    flags: List[str] = []
    raw = (text or '')[:MAX_SCAN_LENGTH]
    normalized = raw.strip()

    if _LINK_RE.search(raw):
        flags.append('link')

    if _PHONE_RE.search(raw):
        flags.append('phone')

    if _MESSENGER_RE.search(raw):
        flags.append('messenger')

    if _SPAM_RE.search(raw):
        flags.append('spam')

    if _PROFANITY_RE.search(raw):
        flags.append('profanity')

    if len(normalized) < MIN_TEXT_LENGTH:
        flags.append('short_text')

    if not (photo_url or '').strip():
        flags.append('no_photo')

    return flags


def flags_to_json(flags: Optional[List[str]]) -> Optional[str]:
    """Сериализует список автофлагов в JSON-строку для ``ModerationTask.auto_flags``."""
    if not flags:
        return None
    return json.dumps(list(flags), ensure_ascii=False)


def flags_from_json(raw: Optional[str]) -> List[str]:
    """Разбирает JSON-строку автофлагов обратно в список (устойчиво к мусору)."""
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except (ValueError, TypeError):
        return [raw]

    if isinstance(parsed, list):
        return [str(item) for item in parsed]
    return [str(parsed)]


def enqueue_if_needed(
        db: Session,
        target_type: str,
        target_id: int,
        author_id: Optional[int],
        auto_flags: Optional[List[str]] = None,
) -> bool:
    """Ставит контент в очередь модерации, если это нужно.

    Задача создаётся, когда автор ещё не набрал доверие (``trust_score < 60``)
    или когда автоматика нашла флаги. Иначе контент публикуется сразу без
    задачи, и функция возвращает ``False``.

    :return: ``True``, если задача создана (контент нужно придержать).
    """
    from app.models.user import User  # локальный импорт — избегаем циклов

    flags = list(auto_flags or [])

    author = None
    if author_id is not None:
        author = db.query(User).filter(User.id == author_id).first()

    trust = TRUST_THRESHOLD
    if author is not None and author.trust_score is not None:
        trust = float(author.trust_score)

    if trust >= TRUST_THRESHOLD and not flags:
        return False

    task = ModerationTask(
        target_type=target_type,
        target_id=target_id,
        status='pending',
        reason_code=flags[0] if flags else None,
        auto_flags=flags_to_json(flags),
        author_id=author_id,
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    return True


def log_action(
        db: Session,
        actor_id: Optional[int],
        action: str,
        target_type: Optional[str] = None,
        target_id: Optional[int] = None,
        payload: Optional[Any] = None,
) -> AuditLog:
    """Запись в неизменяемый журнал действий (``AuditLog``).

    ``payload`` может быть словарём/списком (сериализуется в JSON) или уже
    готовой строкой.
    """
    if payload is None:
        payload_text = None
    elif isinstance(payload, str):
        payload_text = payload
    else:
        payload_text = json.dumps(payload, ensure_ascii=False, default=str)

    entry = AuditLog(
        actor_id=actor_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        payload=payload_text,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)

    return entry


def apply_decision(
        db: Session,
        target_type: str,
        target_id: Optional[int],
        decision: str,
        moderator_id: Optional[int] = None,
        reason: Optional[str] = None,
) -> bool:
    """Применяет решение модератора к объекту.

    ``decision``: ``publish`` | ``reject`` | ``needs_changes``.
    Возвращает ``True``, если объект найден и обновлён.
    """
    if target_id is None:
        return False

    now = datetime.now(timezone.utc)

    if target_type == 'recipe':
        obj = db.query(Recipe).filter(Recipe.id == target_id).first()
        if obj is None:
            return False

        if decision == 'publish':
            obj.status = 'published'
            obj.is_verified = True
            obj.reject_reason = None
        elif decision == 'reject':
            obj.status = 'rejected'
            obj.reject_reason = reason
        else:
            obj.status = 'needs_changes'
            obj.reject_reason = None

        obj.moderated_by = moderator_id
        obj.moderated_at = now
        db.commit()
        return True

    if target_type == 'price':
        quote = db.query(PriceQuote).filter(PriceQuote.id == target_id).first()
        if quote is None:
            return False

        if decision == 'publish':
            quote.status = 'confirmed'
        elif decision == 'reject':
            quote.status = 'rejected'
        else:
            quote.status = 'pending'

        db.commit()
        return True

    if target_type == 'promo':
        promo = db.query(Promo).filter(Promo.id == target_id).first()
        if promo is None:
            return False

        if decision == 'publish':
            promo.status = 'published'
            promo.is_verified = True
            promo.reject_reason = None
        elif decision == 'reject':
            promo.status = 'rejected'
            promo.reject_reason = reason
        else:
            promo.status = 'needs_changes'
            promo.reject_reason = None

        promo.moderated_by = moderator_id
        promo.moderated_at = now
        db.commit()
        return True

    # Для остальных типов (cart, review, comment, avatar, photo) отдельных
    # статусов в моделях пока нет — решение фиксируется только в задаче.
    return False


def shift_trust(db: Session, user_id: Optional[int], delta: float) -> Optional[float]:
    """Меняет доверие автора в границах 0..100. Возвращает новое значение."""
    if user_id is None:
        return None

    from app.models.user import User

    author = db.query(User).filter(User.id == user_id).first()
    if author is None:
        return None

    current = float(author.trust_score or 0.0)
    new_value = max(TRUST_MIN, min(TRUST_MAX, current + delta))
    author.trust_score = new_value
    db.commit()

    return new_value
