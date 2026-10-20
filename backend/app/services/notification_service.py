"""Сервис уведомлений: одна точка входа для всех событий приложения.

Правила сервиса:

* уведомление никогда не создаётся для самого себя (``user_id == actor_id``);
* `notify` **не коммитит** транзакцию — коммитит вызывающий код;
* сбой уведомления не должен ломать основную операцию (комментарий, реакция,
  решение модератора), поэтому вызывающий оборачивает вызов в ``try/except``
  и делает ``rollback`` при ошибке.

Модуль не зависит от роутов — его могут использовать и API, и фоновые задачи.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, Iterable, Optional

from sqlalchemy.orm import Session

from app.models.notification import Notification

logger = logging.getLogger(__name__)

# ---------- Типы событий ----------
TYPE_COMMENT = 'comment'
TYPE_REPLY = 'reply'
TYPE_REACTION = 'reaction'
TYPE_MODERATION = 'moderation'
TYPE_ACHIEVEMENT = 'achievement'
TYPE_PRICE_DROP = 'price_drop'
TYPE_BASKET_CHECKED = 'basket_checked'
TYPE_CHALLENGE = 'challenge'
TYPE_SYSTEM = 'system'

# Длина превью текста в теле уведомления.
PREVIEW_LENGTH = 120

# Человекочитаемые названия решений модератора.
DECISION_LABELS = {
    'publish': 'опубликован',
    'approved': 'одобрен',
    'reject': 'отклонён',
    'rejected': 'отклонён',
    'needs_changes': 'отправлен на доработку',
}

TARGET_LABELS = {
    'recipe': 'Рецепт',
    'cart': 'Смета',
    'review': 'Отзыв',
    'comment': 'Комментарий',
    'price': 'Цена',
    'avatar': 'Аватар',
    'photo': 'Фото',
}


def preview(text: Optional[str], limit: int = PREVIEW_LENGTH) -> str:
    """Обрезает длинный текст до ``limit`` символов, схлопывая переводы строк."""
    normalized = ' '.join((text or '').split())
    if len(normalized) <= limit:
        return normalized
    return normalized[:limit].rstrip() + '…'


def _dump_payload(payload: Optional[Any]) -> Optional[str]:
    """Сериализует payload в JSON-строку (строку отдаём как есть)."""
    if payload is None:
        return None
    if isinstance(payload, str):
        return payload
    try:
        return json.dumps(payload, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        logger.warning('Не удалось сериализовать payload уведомления: %r', payload)
        return None


def notify(
        db: Session,
        user_id: Optional[int],
        type: str,
        title: str,
        body: Optional[str] = None,
        actor_id: Optional[int] = None,
        target_type: Optional[str] = None,
        target_id: Optional[int] = None,
        payload: Optional[Any] = None,
) -> Optional[Notification]:
    """Создаёт уведомление и добавляет его в сессию. **Не коммитит.**

    Уведомление не создаётся, если получатель совпадает с автором события
    (``user_id == actor_id``) — не уведомляем себя о своих же действиях.

    :param payload: словарь/список или готовая JSON-строка; сохраняется как есть.
    :return: созданный ``Notification`` (без commit) либо ``None``.

    ВАЖНО: коммитит вызывающий код — так уведомление сохраняется в одной
    транзакции с основной операцией. Вызывающий обязан обернуть вызов в
    ``try/except`` и сделать ``db.rollback()`` при ошибке, чтобы сбой
    уведомления не сломал основную операцию.
    """
    if user_id is None:
        return None

    if actor_id is not None and int(actor_id) == int(user_id):
        return None

    notification = Notification(
        user_id=int(user_id),
        type=type,
        title=title,
        body=body,
        actor_id=actor_id,
        target_type=target_type,
        target_id=target_id,
        payload=_dump_payload(payload),
        is_read=False,
    )
    db.add(notification)
    return notification


# ---------- Обёртки под конкретные события ----------


def notify_comment(
        db: Session,
        recipe: Any,
        comment: Any,
        actor: Any,
) -> Optional[Notification]:
    """Новый комментарий к рецепту — автору рецепта."""
    recipe_id = getattr(recipe, 'id', None)
    recipe_title = getattr(recipe, 'title', None)
    actor_name = getattr(actor, 'username', None) or 'Пользователь'
    text = getattr(comment, 'text', None)

    return notify(
        db,
        user_id=getattr(recipe, 'user_id', None),
        type=TYPE_COMMENT,
        title='Новый комментарий к рецепту',
        body=f'{actor_name}: «{preview(text)}»',
        actor_id=getattr(actor, 'id', None),
        target_type='recipe',
        target_id=recipe_id,
        payload={
            'recipe_id': recipe_id,
            'recipe_title': recipe_title,
            'comment_id': getattr(comment, 'id', None),
            'comment_text': preview(text),
            'comment_author': actor_name,
        },
    )


def notify_reply(
        db: Session,
        parent_comment: Any,
        comment: Any,
        actor: Any,
        recipe: Any = None,
) -> Optional[Notification]:
    """Ответ на комментарий — автору родительского комментария."""
    actor_name = getattr(actor, 'username', None) or 'Пользователь'
    text = getattr(comment, 'text', None)
    recipe_id = getattr(recipe, 'id', None) or getattr(comment, 'recipe_id', None)

    return notify(
        db,
        user_id=getattr(parent_comment, 'user_id', None),
        type=TYPE_REPLY,
        title='Ответ на ваш комментарий',
        body=f'{actor_name}: «{preview(text)}»',
        actor_id=getattr(actor, 'id', None),
        target_type='recipe',
        target_id=recipe_id,
        payload={
            'recipe_id': recipe_id,
            'recipe_title': getattr(recipe, 'title', None),
            'comment_id': getattr(comment, 'id', None),
            'parent_comment_id': getattr(parent_comment, 'id', None),
            'comment_text': preview(text),
            'comment_author': actor_name,
        },
    )


def _reaction_summary(reaction: Any) -> str:
    """Короткое описание реакции: «вкус 5/5, выгодно 4/5, приготовил(а)»."""
    parts = []
    for axis, label in (('taste', 'вкус'), ('value', 'выгодно'), ('simplicity', 'просто')):
        value = getattr(reaction, axis, None)
        if value is not None:
            parts.append(f'{label} {value}/5')
    if getattr(reaction, 'cooked', False):
        parts.append('приготовил(а)')
    return ', '.join(parts)


def notify_reaction(
        db: Session,
        recipe: Any,
        reaction: Any,
        actor: Any,
) -> Optional[Notification]:
    """Новая оценка рецепта — автору рецепта."""
    actor_name = getattr(actor, 'username', None) or 'Пользователь'
    recipe_title = getattr(recipe, 'title', None)
    summary = _reaction_summary(reaction)

    body = f'{actor_name} оценил(а) «{recipe_title}»'
    if summary:
        body = f'{body}: {summary}'

    return notify(
        db,
        user_id=getattr(recipe, 'user_id', None),
        type=TYPE_REACTION,
        title='Новая оценка рецепта',
        body=body,
        actor_id=getattr(actor, 'id', None),
        target_type='recipe',
        target_id=getattr(recipe, 'id', None),
        payload={
            'recipe_id': getattr(recipe, 'id', None),
            'recipe_title': recipe_title,
            'taste': getattr(reaction, 'taste', None),
            'value': getattr(reaction, 'value', None),
            'simplicity': getattr(reaction, 'simplicity', None),
            'cooked': bool(getattr(reaction, 'cooked', False)),
        },
    )


def notify_moderation_decision(
        db: Session,
        user_id: Optional[int],
        decision: str,
        target_type: Optional[str] = None,
        target_id: Optional[int] = None,
        target_title: Optional[str] = None,
        reason: Optional[str] = None,
        comment: Optional[str] = None,
        moderator_id: Optional[int] = None,
        task_id: Optional[int] = None,
) -> Optional[Notification]:
    """Решение модератора — автору контента (approve / reject / needs_changes)."""
    decision_label = DECISION_LABELS.get(decision, decision)
    target_label = TARGET_LABELS.get(target_type or '', 'Материал')

    title = f'{target_label}: {decision_label}'
    if target_title:
        title = f'{target_label} «{preview(target_title, 60)}» {decision_label}'

    body_parts = []
    if reason:
        body_parts.append(f'Причина: {reason}')
    if comment:
        body_parts.append(preview(comment))
    if not body_parts and decision in ('publish', 'approved'):
        body_parts.append('Материал опубликован и виден всем пользователям.')

    return notify(
        db,
        user_id=user_id,
        type=TYPE_MODERATION,
        title=title,
        body=' '.join(body_parts) or None,
        actor_id=moderator_id,
        target_type=target_type,
        target_id=target_id,
        payload={
            'decision': decision,
            'reason': reason,
            'comment': comment,
            'task_id': task_id,
            'target_type': target_type,
            'target_id': target_id,
            'target_title': target_title,
        },
    )


def notify_achievement(
        db: Session,
        user_id: Optional[int],
        name: str,
        description: Optional[str] = None,
        icon: Optional[str] = None,
        code: Optional[str] = None,
        points: Optional[int] = None,
) -> Optional[Notification]:
    """Новая ачивка — её владельцу."""
    title = f'{icon} Новое достижение: {name}' if icon else f'Новое достижение: {name}'

    body_parts = [part for part in (description, f'+{points} баллов' if points else None) if part]

    return notify(
        db,
        user_id=user_id,
        type=TYPE_ACHIEVEMENT,
        title=title,
        body=' · '.join(body_parts) or None,
        target_type='achievement',
        target_id=None,
        payload={
            'code': code,
            'name': name,
            'description': description,
            'icon': icon,
            'points': points,
        },
    )


def notify_price_drop(
        db: Session,
        user_id: Optional[int],
        product_name: str,
        old_price: Optional[float] = None,
        new_price: Optional[float] = None,
        shop_name: Optional[str] = None,
        product_id: Optional[int] = None,
        recipe_id: Optional[int] = None,
) -> Optional[Notification]:
    """Цена на продукт упала — тому, кто следит за сметой."""
    body_parts = []
    if old_price is not None and new_price is not None:
        body_parts.append(f'{round(float(old_price), 2)} ₽ → {round(float(new_price), 2)} ₽')
    elif new_price is not None:
        body_parts.append(f'Новая цена: {round(float(new_price), 2)} ₽')
    if shop_name:
        body_parts.append(f'магазин «{shop_name}»')

    return notify(
        db,
        user_id=user_id,
        type=TYPE_PRICE_DROP,
        title=f'Цена снизилась: {preview(product_name, 60)}',
        body=' · '.join(body_parts) or None,
        target_type='price',
        target_id=product_id,
        payload={
            'product_id': product_id,
            'product_name': product_name,
            'old_price': old_price,
            'new_price': new_price,
            'shop_name': shop_name,
            'recipe_id': recipe_id,
        },
    )


def notify_basket_checked(
        db: Session,
        user_id: Optional[int],
        basket_title: Optional[str] = None,
        basket_id: Optional[int] = None,
        total: Optional[float] = None,
        items_count: Optional[int] = None,
        actor_id: Optional[int] = None,
) -> Optional[Notification]:
    """Смета проверена (модератором или автоматикой) — владельцу сметы."""
    title = 'Смета проверена'
    if basket_title:
        title = f'Смета «{preview(basket_title, 60)}» проверена'

    body_parts = []
    if items_count is not None:
        body_parts.append(f'позиций: {items_count}')
    if total is not None:
        body_parts.append(f'итого {round(float(total), 2)} ₽')

    return notify(
        db,
        user_id=user_id,
        type=TYPE_BASKET_CHECKED,
        title=title,
        body=' · '.join(body_parts) or None,
        actor_id=actor_id,
        target_type='cart',
        target_id=basket_id,
        payload={
            'basket_id': basket_id,
            'basket_title': basket_title,
            'total': total,
            'items_count': items_count,
        },
    )


def notify_challenge(
        db: Session,
        user_id: Optional[int],
        title: str,
        body: Optional[str] = None,
        challenge_id: Optional[int] = None,
        payload: Optional[Dict[str, Any]] = None,
) -> Optional[Notification]:
    """Событие челленджа (старт, итоги, награда)."""
    details = dict(payload or {})
    details.setdefault('challenge_id', challenge_id)

    return notify(
        db,
        user_id=user_id,
        type=TYPE_CHALLENGE,
        title=title,
        body=body,
        target_type='challenge',
        target_id=challenge_id,
        payload=details,
    )


def notify_system(
        db: Session,
        user_id: Optional[int],
        title: str,
        body: Optional[str] = None,
        payload: Optional[Dict[str, Any]] = None,
) -> Optional[Notification]:
    """Служебное уведомление (санкция, изменение правил, ответ поддержки)."""
    return notify(
        db,
        user_id=user_id,
        type=TYPE_SYSTEM,
        title=title,
        body=body,
        payload=payload,
    )


# ---------- Чтение и отметки ----------


def unread_count(db: Session, user_id: int) -> int:
    """Сколько непрочитанных уведомлений у пользователя (для счётчика в шапке)."""
    return (
        db.query(Notification)
        .filter(Notification.user_id == user_id, Notification.is_read.is_(False))
        .count()
    )


def mark_all_read(db: Session, user_id: int) -> int:
    """Отмечает все уведомления пользователя прочитанными. Возвращает их число.

    Коммитит самостоятельно: это самостоятельная массовая операция, результат
    которой нужен сразу (счётчик в шапке обновляется этим же ответом).
    """
    updated = (
        db.query(Notification)
        .filter(Notification.user_id == user_id, Notification.is_read.is_(False))
        .update({Notification.is_read: True}, synchronize_session=False)
    )
    db.commit()
    return int(updated or 0)


def types_of(notifications: Iterable[Notification]) -> Dict[str, int]:
    """Служебная сводка «тип → количество» (диагностика и админка)."""
    summary: Dict[str, int] = {}
    for notification in notifications:
        summary[notification.type] = summary.get(notification.type, 0) + 1
    return summary
