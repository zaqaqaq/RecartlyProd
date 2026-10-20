"""Лента уведомлений: список, счётчик непрочитанных, отметки и удаление.

Регистрация роутера — в ``app.api.routes.__init__`` и ``app.main``
(её делает отдельный исполнитель: ``notifications_router``).
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user_required
from app.core.database import get_db
from app.models.notification import Notification
from app.models.user import User
from app.services.notification_service import mark_all_read, unread_count

logger = logging.getLogger(__name__)

notifications_router = APIRouter(prefix='/notifications', tags=['Уведомления'])


def _parse_payload(raw: Optional[str]) -> Optional[Any]:
    """Разбирает JSON-строку payload; мусор не роняет ленту, а становится None."""
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except (ValueError, TypeError):
        logger.warning('Битый payload уведомления: %r', raw)
        return None
    # Уведомление с payload-строкой отдаём как {'value': ...} — фронтенду нужен объект.
    if not isinstance(parsed, (dict, list)):
        return {'value': parsed}
    return parsed


def _iso(value: Any) -> Optional[str]:
    return value.isoformat() if value is not None else None


def _serialize(notification: Notification, actor: Optional[User]) -> Dict[str, Any]:
    return {
        'id': notification.id,
        'type': notification.type,
        'title': notification.title,
        'body': notification.body,
        'actor_username': actor.username if actor else None,
        'actor_avatar_url': actor.avatar_url if actor else None,
        'target_type': notification.target_type,
        'target_id': notification.target_id,
        'is_read': bool(notification.is_read),
        'created_at': _iso(notification.created_at),
        'payload': _parse_payload(notification.payload),
    }


def _get_own_or_404(db: Session, notification_id: int, user_id: int) -> Notification:
    """Уведомление только своё: чужое неотличимо от несуществующего (404)."""
    notification = (
        db.query(Notification)
        .filter(Notification.id == notification_id, Notification.user_id == user_id)
        .first()
    )
    if notification is None:
        raise HTTPException(status_code=404, detail='Уведомление не найдено')
    return notification


@notifications_router.get('/unread-count')
def get_unread_count(
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user_required),
):
    """Счётчик непрочитанных — для бейджа в шапке."""
    return {'unread': unread_count(db, current_user.id)}


@notifications_router.post('/read-all')
def read_all(
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user_required),
):
    """Отметить все свои уведомления прочитанными."""
    updated = mark_all_read(db, current_user.id)
    return {'updated': updated, 'unread': unread_count(db, current_user.id)}


@notifications_router.get('')
def list_notifications(
        unread_only: bool = Query(default=False, description='Только непрочитанные'),
        limit: int = Query(default=30, ge=1, le=100),
        skip: int = Query(default=0, ge=0),
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user_required),
):
    """Лента уведомлений текущего пользователя: ``{total, unread, items}``."""
    query = db.query(Notification).filter(Notification.user_id == current_user.id)
    if unread_only:
        query = query.filter(Notification.is_read.is_(False))

    total = query.count()
    notifications: List[Notification] = (
        query.order_by(Notification.created_at.desc(), Notification.id.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )

    # Акторов подтягиваем одним запросом — без N+1 на каждую карточку.
    actor_ids = {n.actor_id for n in notifications if n.actor_id}
    actors = {}
    if actor_ids:
        actors = {
            user.id: user for user in db.query(User).filter(User.id.in_(actor_ids)).all()
        }

    return {
        'total': total,
        'unread': unread_count(db, current_user.id),
        'items': [_serialize(n, actors.get(n.actor_id)) for n in notifications],
    }


@notifications_router.post('/{notification_id}/read')
def read_notification(
        notification_id: int,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user_required),
):
    """Отметить одно уведомление прочитанным (только своё)."""
    notification = _get_own_or_404(db, notification_id, current_user.id)

    notification.is_read = True
    db.commit()
    db.refresh(notification)

    return {
        'id': notification.id,
        'is_read': bool(notification.is_read),
        'unread': unread_count(db, current_user.id),
    }


@notifications_router.delete('/{notification_id}')
def delete_notification(
        notification_id: int,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user_required),
):
    """Удалить своё уведомление."""
    notification = _get_own_or_404(db, notification_id, current_user.id)

    db.delete(notification)
    db.commit()

    return {
        'message': 'Уведомление удалено',
        'id': notification_id,
        'unread': unread_count(db, current_user.id),
    }
