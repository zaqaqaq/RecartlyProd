"""Уведомления пользователя: комментарии, реакции, модерация, ачивки, цены.

Модель намеренно «плоская»: тип события строкой + необязательная ссылка на объект
(``target_type``/``target_id``) и произвольный JSON-``payload``. Так фронтенд может
рисовать любые карточки, не заводя по таблице на каждый вид события.
"""

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base

# Допустимые типы событий (для справки и валидации в сервисе).
NOTIFICATION_TYPES = (
    'comment',
    'reply',
    'reaction',
    'moderation',
    'achievement',
    'price_drop',
    'basket_checked',
    'challenge',
    'system',
)


class Notification(Base):
    """Одно уведомление для одного получателя.

    ``actor_id`` — тот, кто событие вызвал (для «Иван оценил ваш рецепт»);
    при ``actor_id == user_id`` уведомление не создаётся (см. ``notification_service``).
    ``payload`` — JSON-строка, чтобы не тянуть в модель диалект-специфичный JSONB.
    """

    __tablename__ = 'notifications'
    __table_args__ = (
        # Основной запрос — «мои уведомления, сначала непрочитанные и свежие».
        Index('ix_notifications_user_read_created', 'user_id', 'is_read', 'created_at'),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        Integer,
        ForeignKey('users.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )
    # comment | reply | reaction | moderation | achievement | price_drop |
    # basket_checked | challenge | system
    type = Column(String, nullable=False, index=True)
    title = Column(String, nullable=False)
    body = Column(Text, nullable=True)
    actor_id = Column(
        Integer,
        ForeignKey('users.id', ondelete='SET NULL'),
        nullable=True,
    )
    target_type = Column(String, nullable=True)   # recipe | basket | price | challenge …
    target_id = Column(Integer, nullable=True)
    payload = Column(Text, nullable=True)         # JSON-строка с деталями события
    is_read = Column(Boolean, nullable=False, default=False, server_default='false', index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    # Две ссылки на users — какие именно, указываем явно.
    user = relationship('User', foreign_keys=[user_id])
    actor = relationship('User', foreign_keys=[actor_id])

    def __repr__(self) -> str:  # pragma: no cover - отладочное
        return f'<Notification {self.id} user={self.user_id} type={self.type}>'
