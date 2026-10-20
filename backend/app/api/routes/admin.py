"""Админка и модерация: очередь задач, жалобы, санкции, журнал и метрики.

Роутер подключается отдельно (``admin_router``) — регистрация в
``app/api/routes/__init__.py`` и ``app/main.py`` выполняется другим исполнителем.
"""

from datetime import datetime, timedelta, timezone
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import (
    get_current_moderator,
    get_current_user_required,
)
from app.core.database import get_db
from app.models.basket import Basket
from app.models.geo import Shop
from app.models.moderation import AuditLog, ModerationTask, Report, UserSanction
from app.models.price import PriceQuote
from app.models.product import Product
from app.models.promo import Promo
from app.models.recipe import Recipe
from app.models.review import Review
from app.models.user import User
from app.services.moderation_service import (
    apply_decision,
    flags_from_json,
    log_action,
)
from app.services.notification_service import notify_moderation_decision

logger = logging.getLogger(__name__)

admin_router = APIRouter(prefix="/admin", tags=["Модерация"])

# ---------- Справочники ----------
TARGET_TYPE_LABELS = {
    'recipe': 'Рецепт',
    'cart': 'Корзина',
    'review': 'Отзыв',
    'comment': 'Комментарий',
    'price': 'Цена',
    'avatar': 'Аватар',
    'photo': 'Фото',
}

REASON_LABELS = {
    'spam': 'Спам',
    'abuse': 'Оскорбления',
    'fake_price': 'Фейковая цена',
    'copyright': 'Нарушение авторских прав',
    'duplicate': 'Дубликат',
    'forbidden': 'Запрещённый контент',
    'other': 'Другое',
}

SANCTION_KINDS = ('warning', 'mute', 'ban', 'shadowban')

REPORT_STATUSES = ('open', 'resolved', 'rejected')

TASK_STATUSES = ('pending', 'approved', 'rejected', 'needs_changes')

# ---------- Модели запросов ----------


class RejectRequest(BaseModel):
    reason_code: str = Field(..., min_length=1, max_length=64)
    comment: Optional[str] = None


class NeedsChangesRequest(BaseModel):
    comment: Optional[str] = None
    reason_code: Optional[str] = None


class ReportResolveRequest(BaseModel):
    resolution: str = Field(..., min_length=1)
    status: str = Field(default='resolved')


class SanctionRequest(BaseModel):
    user_id: int
    kind: str
    reason: Optional[str] = None
    expires_at: Optional[datetime] = None


# ---------- Утилиты ----------


def _to_iso(value: Optional[datetime]) -> Optional[str]:
    """Дата в ISO-строке (БД может вернуть naive или aware datetime)."""
    if value is None:
        return None
    return value.isoformat()


def _as_utc_naive(value: Optional[datetime]) -> Optional[datetime]:
    """Приводит дату к naive-UTC, чтобы вычитать даты из разных БД одинаково."""
    if value is None:
        return None
    if value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _serialize_task_base(task: ModerationTask) -> Dict[str, Any]:
    return {
        'id': task.id,
        'target_type': task.target_type,
        'target_type_label': TARGET_TYPE_LABELS.get(task.target_type, task.target_type),
        'target_id': task.target_id,
        'status': task.status,
        'priority': task.priority,
        'reason_code': task.reason_code,
        'reason_label': REASON_LABELS.get(task.reason_code or '', task.reason_code),
        'moderator_comment': task.moderator_comment,
        'moderator_id': task.moderator_id,
        'author_id': task.author_id,
        'auto_flags': flags_from_json(task.auto_flags),
        'created_at': _to_iso(task.created_at),
        'resolved_at': _to_iso(task.resolved_at),
    }


def _recipe_preview(recipe: Recipe, author: Optional[User]) -> Dict[str, Any]:
    """Превью рецепта для модератора: не только заголовок, но и состав, и шаги.

    Модерация проверяет данные: ингредиенты, количества, цены, фото шагов.
    """
    return {
        'title': recipe.title,
        'description': (recipe.description or '')[:280],
        'photo_url': recipe.photo_url,
        'username': author.username if author else None,
        'avatar_url': author.avatar_url if author else None,
        'recipe_status': recipe.status,
        'created_at': _to_iso(recipe.created_at),
        'ingredients': [
            {
                'name': item.name,
                'quantity': item.quantity,
                'price': item.price,
                'photo_url': item.photo_url,
            }
            for item in (recipe.ingredients or [])
        ],
        'steps': [
            {'text': step.text, 'photo_url': step.photo_url}
            for step in (recipe.steps or [])
        ],
        'cook_time_min': recipe.cook_time_min,
        'servings': recipe.servings,
        'difficulty': recipe.difficulty,
        'category': recipe.category,
    }


def _basket_preview(basket: Basket, author: Optional[User]) -> Dict[str, Any]:
    """Превью набора для модератора: позиции, цены и итог."""
    items = basket.items or []
    return {
        'title': basket.title,
        'description': (basket.description or '')[:280],
        'photo_url': basket.photo_url,
        'receipt_photo_url': basket.receipt_photo_url,
        'username': author.username if author else None,
        'avatar_url': author.avatar_url if author else None,
        'basket_status': basket.status,
        'created_at': _to_iso(basket.created_at),
        'total_price': basket.total_price,
        'items_count': len(items),
        'prices_date': _to_iso(basket.prices_date),
        'items': [
            {
                'name': item.name,
                'quantity': item.quantity,
                'unit': item.unit,
                'price': item.price,
                'photo_url': item.photo_url,
            }
            for item in items
        ],
    }


def _price_preview(quote: PriceQuote, product: Optional[Product], shop: Optional[Shop]) -> Dict[str, Any]:
    return {
        'title': product.name if product else f'Цена #{quote.id}',
        'product': product.name if product else None,
        'shop': shop.name if shop else None,
        'price': quote.price,
        'unit': product.unit if product else None,
        'photo_url': quote.photo_url,
        'quote_status': quote.status,
        'created_at': _to_iso(quote.created_at),
    }


def _target_title(db: Session, target_type: Optional[str], target_id: Optional[int]) -> Optional[str]:
    """Название объекта модерации — чтобы в уведомлении был не «#123», а заголовок."""
    if target_id is None:
        return None
    try:
        if target_type == 'recipe':
            recipe = db.query(Recipe).filter(Recipe.id == target_id).first()
            return recipe.title if recipe else None
        if target_type == 'price':
            quote = db.query(PriceQuote).filter(PriceQuote.id == target_id).first()
            if quote is None:
                return None
            product = db.query(Product).filter(Product.id == quote.product_id).first()
            return product.name if product else None
        if target_type in ('cart', 'basket'):
            basket = db.query(Basket).filter(Basket.id == target_id).first()
            return basket.title if basket else None
        if target_type == 'review':
            review = db.query(Review).filter(Review.id == target_id).first()
            return review.title if review else None
        if target_type == 'promo':
            promo = db.query(Promo).filter(Promo.id == target_id).first()
            return promo.title if promo else None
    except Exception as e:  # noqa: BLE001 — заголовок не важнее самого решения
        logger.warning('Не удалось получить заголовок объекта модерации: %s', e)
    return None


def _notify_author_about_decision(
        db: Session,
        task: ModerationTask,
        decision: str,
        moderator_id: Optional[int],
        reason: Optional[str] = None,
        comment: Optional[str] = None,
) -> None:
    """Уведомляет автора контента о решении модератора.

    Решение к этому моменту уже сохранено, поэтому уведомление коммитим отдельно
    и глушим любые ошибки: сбой уведомления не должен ломать модерацию.
    """
    try:
        notify_moderation_decision(
            db,
            user_id=task.author_id,
            decision=decision,
            target_type=task.target_type,
            target_id=task.target_id,
            target_title=_target_title(db, task.target_type, task.target_id),
            reason=reason,
            comment=comment,
            moderator_id=moderator_id,
            task_id=task.id,
        )
        db.commit()
    except Exception as e:  # noqa: BLE001 — уведомление не важнее решения модератора
        db.rollback()
        logger.exception('Не удалось создать уведомление о решении модератора: %s', e)


def _build_previews(
        db: Session,
        targets: List[Any],
) -> Dict[tuple, Dict[str, Any]]:
    """Пакетно подгружает объекты задач, чтобы не устраивать N+1 запросов.

    Принимает список объектов с полями ``target_type``/``target_id``
    (``ModerationTask`` или ``Report``).
    """
    ids_by_type: Dict[str, set] = {}
    for target in targets:
        if target.target_id is None:
            continue
        ids_by_type.setdefault(target.target_type, set()).add(target.target_id)

    previews: Dict[tuple, Dict[str, Any]] = {}

    # Рецепты
    recipe_ids = ids_by_type.get('recipe', set())
    if recipe_ids:
        recipes = db.query(Recipe).filter(Recipe.id.in_(recipe_ids)).all()
        author_ids = {r.user_id for r in recipes}
        authors = {}
        if author_ids:
            authors = {
                u.id: u for u in db.query(User).filter(User.id.in_(author_ids)).all()
            }
        for recipe in recipes:
            previews[('recipe', recipe.id)] = _recipe_preview(recipe, authors.get(recipe.user_id))

    # Цены (проверка цен в магазинах)
    price_ids = ids_by_type.get('price', set())
    if price_ids:
        quotes = db.query(PriceQuote).filter(PriceQuote.id.in_(price_ids)).all()
        product_ids = {q.product_id for q in quotes}
        shop_ids = {q.shop_id for q in quotes}
        products = {}
        shops = {}
        if product_ids:
            products = {
                p.id: p for p in db.query(Product).filter(Product.id.in_(product_ids)).all()
            }
        if shop_ids:
            shops = {
                s.id: s for s in db.query(Shop).filter(Shop.id.in_(shop_ids)).all()
            }
        for quote in quotes:
            previews[('price', quote.id)] = _price_preview(
                quote, products.get(quote.product_id), shops.get(quote.shop_id)
            )

    # Наборы (раньше — «корзины сообщества»): состав и цены нужны модератору
    basket_ids = ids_by_type.get('basket', set()) | ids_by_type.get('cart', set())
    if basket_ids:
        baskets = db.query(Basket).filter(Basket.id.in_(basket_ids)).all()
        author_ids = {b.user_id for b in baskets if b.user_id}
        authors = {}
        if author_ids:
            authors = {
                u.id: u for u in db.query(User).filter(User.id.in_(author_ids)).all()
            }
        for basket in baskets:
            previews[('basket', basket.id)] = _basket_preview(
                basket, authors.get(basket.user_id)
            )

    # Акции от пользователей
    promo_ids = ids_by_type.get('promo', set())
    if promo_ids:
        promos = db.query(Promo).filter(Promo.id.in_(promo_ids)).all()
        promo_shop_ids = {p.shop_id for p in promos if p.shop_id}
        promo_product_ids = {p.product_id for p in promos if p.product_id}
        promo_author_ids = {p.user_id for p in promos}
        promo_shops = (
            {s.id: s for s in db.query(Shop).filter(Shop.id.in_(promo_shop_ids)).all()}
            if promo_shop_ids
            else {}
        )
        promo_products = (
            {p.id: p for p in db.query(Product).filter(Product.id.in_(promo_product_ids)).all()}
            if promo_product_ids
            else {}
        )
        promo_authors = (
            {u.id: u for u in db.query(User).filter(User.id.in_(promo_author_ids)).all()}
        )
        for promo in promos:
            shop = promo_shops.get(promo.shop_id)
            product = promo_products.get(promo.product_id)
            author = promo_authors.get(promo.user_id)
            previews[('promo', promo.id)] = {
                'title': promo.title,
                'description': (promo.description or '')[:280],
                'shop': shop.name if shop else None,
                'product': product.name if product else None,
                'old_price': promo.old_price,
                'new_price': promo.new_price,
                'unit': promo.unit,
                'photo_url': promo.photo_url,
                'promo_status': promo.status,
                'username': author.username if author else None,
                'avatar_url': author.avatar_url if author else None,
                'created_at': _to_iso(promo.created_at),
                'ends_at': _to_iso(promo.ends_at),
            }

    # Отзывы
    review_ids = ids_by_type.get('review', set())
    if review_ids:
        reviews = db.query(Review).filter(Review.id.in_(review_ids)).all()
        review_authors = {r.user_id for r in reviews}
        review_users = {}
        if review_authors:
            review_users = {
                u.id: u for u in db.query(User).filter(User.id.in_(review_authors)).all()
            }
        for review in reviews:
            author = review_users.get(review.user_id)
            previews[('review', review.id)] = {
                'title': review.title,
                'description': (review.content or '')[:280],
                'rating': review.rating,
                'username': author.username if author else None,
                'created_at': _to_iso(review.created_at),
            }

    return previews


# ---------- Эндпоинты ----------


@admin_router.get('/whoami')
def admin_whoami(
        current_user: User = Depends(get_current_user_required),
):
    """Роль текущего пользователя — фронтенд решает, показывать ли раздел."""
    return {
        'id': current_user.id,
        'username': current_user.username,
        'role': current_user.role,
        'trust_score': current_user.trust_score,
        'is_moderator': current_user.is_moderator,
        'is_admin': current_user.is_admin,
    }


@admin_router.get('/stats')
def admin_stats(
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_moderator),
):
    """Метрики модерации для шапки админки."""
    now = _now_utc()
    since = now - timedelta(hours=24)
    since_naive = since.replace(tzinfo=None)

    queue_size = db.query(ModerationTask).filter(ModerationTask.status == 'pending').count()

    approved_24h = db.query(ModerationTask).filter(
        ModerationTask.status == 'approved',
        ModerationTask.resolved_at.isnot(None),
        ModerationTask.resolved_at >= since_naive,
    ).count()

    rejected_24h = db.query(ModerationTask).filter(
        ModerationTask.status == 'rejected',
        ModerationTask.resolved_at.isnot(None),
        ModerationTask.resolved_at >= since_naive,
    ).count()

    needs_changes_24h = db.query(ModerationTask).filter(
        ModerationTask.status == 'needs_changes',
        ModerationTask.resolved_at.isnot(None),
        ModerationTask.resolved_at >= since_naive,
    ).count()

    open_reports = db.query(Report).filter(Report.status == 'open').count()

    # Среднее время модерации считаем по задачам, закрытым за сутки.
    resolved = db.query(ModerationTask).filter(
        ModerationTask.resolved_at.isnot(None),
        ModerationTask.resolved_at >= since_naive,
    ).all()

    durations = []
    for task in resolved:
        created = _as_utc_naive(task.created_at)
        finished = _as_utc_naive(task.resolved_at)
        if created is None or finished is None:
            continue
        durations.append((finished - created).total_seconds())

    avg_minutes = round(sum(durations) / len(durations) / 60, 1) if durations else 0.0

    return {
        'queue': queue_size,
        'pending': queue_size,
        'approved_24h': approved_24h,
        'rejected_24h': rejected_24h,
        'needs_changes_24h': needs_changes_24h,
        'avg_moderation_minutes': avg_minutes,
        'open_reports': open_reports,
        'resolved_24h': len(resolved),
    }


@admin_router.get('/queue')
def admin_queue(
        status: str = Query(default='pending'),
        target_type: Optional[str] = Query(default=None),
        limit: int = Query(default=20, ge=1, le=100),
        skip: int = Query(default=0, ge=0),
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_moderator),
):
    """Очередь задач модерации с превью объектов."""
    query = db.query(ModerationTask)

    if status and status != 'all':
        query = query.filter(ModerationTask.status == status)
    if target_type:
        query = query.filter(ModerationTask.target_type == target_type)

    total = query.count()
    tasks = query.order_by(
        ModerationTask.priority.desc(),
        ModerationTask.created_at.desc(),
    ).offset(skip).limit(limit).all()

    previews = _build_previews(db, tasks)

    items = []
    for task in tasks:
        payload = _serialize_task_base(task)
        payload['preview'] = previews.get((task.target_type, task.target_id))
        items.append(payload)

    return {
        'total': total,
        'skip': skip,
        'limit': limit,
        'items': items,
    }


@admin_router.post('/tasks/{task_id}/approve')
def admin_approve_task(
        task_id: int,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_moderator),
):
    """Одобрить задачу: опубликовать объект, поднять доверие автора."""
    task = db.query(ModerationTask).filter(ModerationTask.id == task_id).first()
    if task is None:
        raise HTTPException(status_code=404, detail='Задача не найдена')
    if task.status == 'needs_changes':
        raise HTTPException(status_code=400, detail='Задача уже обработана')
    if task.status == 'approved':
        raise HTTPException(status_code=400, detail='Задача уже обработана')
    if task.status == 'rejected':
        raise HTTPException(status_code=400, detail='Задача уже обработана')

    apply_decision(
        db,
        task.target_type,
        task.target_id,
        'publish',
        moderator_id=current_user.id,
    )

    task.status = 'approved'
    task.resolved_at = _now_utc()
    task.moderator_id = current_user.id
    db.commit()
    db.refresh(task)

    # Рейтинг автора больше не меняется: решение модератора — только про контент.

    log_action(
        db,
        actor_id=current_user.id,
        action='approve',
        target_type=task.target_type,
        target_id=task.target_id,
        payload={
            'task_id': task.id,
            'author_id': task.author_id,
            'auto_flags': flags_from_json(task.auto_flags),
        },
    )

    # Автору — уведомление об одобрении (после решения; сбой не ломает модерацию).
    _notify_author_about_decision(
        db,
        task,
        'publish',
        moderator_id=current_user.id,
    )

    return {
        'message': 'Задача одобрена',
        'task_id': task.id,
        'status': task.status,
    }


@admin_router.post('/tasks/{task_id}/reject')
def admin_reject_task(
        task_id: int,
        payload: RejectRequest,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_moderator),
):
    """Отклонить задачу: объект получает статус rejected и причину."""
    task = db.query(ModerationTask).filter(ModerationTask.id == task_id).first()
    if task is None:
        raise HTTPException(status_code=404, detail='Задача не найдена')
    is_rejected = task.status == 'rejected'
    if is_rejected:
        raise HTTPException(status_code=400, detail='Задача уже отклонена')
    if task.status == 'approved':
        raise HTTPException(status_code=400, detail='Задача уже одобрена')
    if task.status == 'needs_changes':
        raise HTTPException(status_code=400, detail='Задача отправлена на доработку')

    reason_code = (payload.reason_code or '').strip()
    if not reason_code:
        raise HTTPException(status_code=400, detail='Причина отклонения обязательна')

    apply_decision(
        db,
        task.target_type,
        task.target_id,
        'reject',
        moderator_id=current_user.id,
        reason=reason_code,
    )

    task.status = 'rejected'
    task.reason_code = reason_code
    task.moderator_comment = payload.comment
    task.resolved_at = _now_utc()
    task.moderator_id = current_user.id
    db.commit()
    db.refresh(task)

    # Рейтинг автора больше не меняется: отклонение — только про контент.

    log_action(
        db,
        actor_id=current_user.id,
        action='reject',
        target_type=task.target_type,
        target_id=task.target_id,
        payload={
            'task_id': task.id,
            'reason_code': reason_code,
            'comment': payload.comment,
            'author_id': task.author_id,
        },
    )

    # Автору — уведомление с причиной отклонения.
    _notify_author_about_decision(
        db,
        task,
        'reject',
        moderator_id=current_user.id,
        reason=REASON_LABELS.get(reason_code, reason_code),
        comment=payload.comment,
    )

    return {
        'message': 'Задача отклонена',
        'task_id': task.id,
        'status': task.status,
        'reason_code': reason_code,
    }


@admin_router.post('/tasks/{task_id}/needs-changes')
def admin_needs_changes_task(
        task_id: int,
        payload: Optional[NeedsChangesRequest] = None,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_moderator),
):
    """Отправить объект на доработку с комментарием модератора."""
    task = db.query(ModerationTask).filter(ModerationTask.id == task_id).first()
    if task is None:
        raise HTTPException(status_code=404, detail='Задача не найдена')
    if task.status == 'approved':
        raise HTTPException(status_code=400, detail='Задача уже обработана')
    if task.status == 'rejected':
        raise HTTPException(status_code=400, detail='Задача уже обработана')

    comment = payload.comment if payload else None
    reason_code = payload.reason_code if payload else None

    apply_decision(
        db,
        task.target_type,
        task.target_id,
        'needs_changes',
        moderator_id=current_user.id,
    )

    task.status = 'needs_changes'
    task.moderator_comment = comment
    if reason_code:
        task.reason_code = reason_code
    task.resolved_at = _now_utc()
    task.moderator_id = current_user.id
    db.commit()
    db.refresh(task)

    log_action(
        db,
        actor_id=current_user.id,
        action='needs_changes',
        target_type=task.target_type,
        target_id=task.target_id,
        payload={'task_id': task.id, 'comment': comment},
    )

    # Автору — уведомление о доработке с комментарием модератора.
    _notify_author_about_decision(
        db,
        task,
        'needs_changes',
        moderator_id=current_user.id,
        reason=REASON_LABELS.get(reason_code, reason_code) if reason_code else None,
        comment=comment,
    )

    return {
        'message': 'Отправлено на доработку',
        'task_id': task.id,
        'status': task.status,
        'comment': comment,
    }


@admin_router.get('/reports')
def admin_reports(
        status: str = Query(default='open'),
        limit: int = Query(default=50, ge=1, le=200),
        skip: int = Query(default=0, ge=0),
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_moderator),
):
    """Список жалоб пользователей."""
    query = db.query(Report)
    if status and status != 'all':
        query = query.filter(Report.status == status)

    total = query.count()
    reports = query.order_by(Report.created_at.desc()).offset(skip).limit(limit).all()

    # Подтягиваем заявителей и превью объектов одним проходом.
    reporter_ids = {r.reporter_id for r in reports if r.reporter_id}
    reporters = {}
    if reporter_ids:
        reporters = {
            u.id: u for u in db.query(User).filter(User.id.in_(reporter_ids)).all()
        }

    previews = _build_previews(db, reports)

    items = []
    for report in reports:
        reporter = reporters.get(report.reporter_id)
        items.append({
            'id': report.id,
            'target_type': report.target_type,
            'target_type_label': TARGET_TYPE_LABELS.get(report.target_type, report.target_type),
            'target_id': report.target_id,
            'reporter_id': report.reporter_id,
            'reporter_username': reporter.username if reporter else None,
            'reason_code': report.reason_code,
            'reason_label': REASON_LABELS.get(report.reason_code, report.reason_code),
            'comment': report.comment,
            'status': report.status,
            'moderator_id': report.moderator_id,
            'resolution': report.resolution,
            'created_at': _to_iso(report.created_at),
            'resolved_at': _to_iso(report.resolved_at),
            'preview': previews.get((report.target_type, report.target_id)),
        })

    return {
        'total': total,
        'skip': skip,
        'limit': limit,
        'items': items,
    }


@admin_router.post('/reports/{report_id}/resolve')
def admin_resolve_report(
        report_id: int,
        payload: ReportResolveRequest,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_moderator),
):
    """Закрыть жалобу: 'resolved' или 'rejected'."""
    report = db.query(Report).filter(Report.id == report_id).first()
    if report is None:
        raise HTTPException(status_code=404, detail='Жалоба не найдена')

    if payload.status not in ('resolved', 'rejected'):
        raise HTTPException(status_code=400, detail="status должен быть 'resolved' или 'rejected'")

    report.status = payload.status
    report.resolution = payload.resolution
    report.moderator_id = current_user.id
    report.resolved_at = _now_utc()
    db.commit()
    db.refresh(report)

    log_action(
        db,
        actor_id=current_user.id,
        action='report_resolve',
        target_type=report.target_type,
        target_id=report.target_id,
        payload={
            'report_id': report.id,
            'status': report.status,
            'resolution': report.resolution,
        },
    )

    return {
        'message': 'Жалоба обработана',
        'report_id': report.id,
        'status': report.status,
    }


@admin_router.post('/sanctions')
def admin_create_sanction(
        payload: SanctionRequest,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_moderator),
):
    """Выдать санкцию: предупреждение, мут, бан или теневой бан."""
    kind = (payload.kind or '').strip()
    if kind not in SANCTION_KINDS:
        raise HTTPException(
            status_code=400,
            detail="kind должен быть одним из: " + ', '.join(SANCTION_KINDS),
        )

    user = db.query(User).filter(User.id == payload.user_id).first()
    if user is None:
        raise HTTPException(status_code=404, detail='Пользователь не найден')

    default_hours = {'warning': 0, 'mute': 24 * 7, 'ban': 0, 'shadowban': 0}
    expires_at = payload.expires_at
    if expires_at is None and default_hours.get(kind):
        expires_at = _now_utc() + timedelta(hours=default_hours[kind])

    sanction = UserSanction(
        user_id=user.id,
        kind=kind,
        reason=payload.reason,
        issued_by=current_user.id,
        expires_at=expires_at,
        is_active=True,
    )
    db.add(sanction)

    if kind == 'ban':
        user.is_banned = True
    elif kind == 'mute':
        user.muted_until = expires_at or (_now_utc() + timedelta(hours=24))

    db.commit()
    db.refresh(sanction)

    log_action(
        db,
        actor_id=current_user.id,
        action=f'sanction_{kind}',
        target_type='user',
        target_id=user.id,
        payload={
            'sanction_id': sanction.id,
            'kind': kind,
            'reason': payload.reason,
            'expires_at': _to_iso(expires_at),
        },
    )

    return {
        'message': 'Санкция применена',
        'sanction_id': sanction.id,
        'user_id': user.id,
        'kind': kind,
        'expires_at': _to_iso(expires_at),
    }


@admin_router.get('/audit')
def admin_audit(
        limit: int = Query(default=50, ge=1, le=200),
        skip: int = Query(default=0, ge=0),
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_moderator),
):
    """Последние записи журнала действий с именем актора."""
    total = db.query(AuditLog).count()
    entries = db.query(AuditLog).order_by(AuditLog.created_at.desc()).offset(skip).limit(limit).all()

    actor_ids = {e.actor_id for e in entries if e.actor_id}
    actors = {}
    if actor_ids:
        actors = {u.id: u for u in db.query(User).filter(User.id.in_(actor_ids)).all()}

    items = []
    for entry in entries:
        actor = actors.get(entry.actor_id)
        items.append({
            'id': entry.id,
            'actor_id': entry.actor_id,
            'actor_username': actor.username if actor else None,
            'action': entry.action,
            'target_type': entry.target_type,
            'target_type_label': TARGET_TYPE_LABELS.get(entry.target_type or '', entry.target_type),
            'target_id': entry.target_id,
            'payload': entry.payload,
            'created_at': _to_iso(entry.created_at),
        })

    return {
        'total': total,
        'skip': skip,
        'limit': limit,
        'items': items,
    }
