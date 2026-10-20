from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class ModerationTask(Base):
    """Задача модерации: единая очередь для рецептов, корзин, отзывов, цен и фото."""

    __tablename__ = 'moderation_tasks'

    id = Column(Integer, primary_key=True, index=True)
    # recipe | cart | review | comment | price | avatar | photo
    target_type = Column(String, nullable=False, index=True)
    target_id = Column(Integer, nullable=False, index=True)

    # pending | approved | rejected | needs_changes
    status = Column(String, nullable=False, default='pending', server_default='pending', index=True)
    priority = Column(Integer, nullable=False, default=0, server_default='0')

    reason_code = Column(String, nullable=True)      # спам, запрещёнка, фейковая цена, дубликат…
    moderator_comment = Column(Text, nullable=True)
    moderator_id = Column(Integer, ForeignKey('users.id', ondelete='SET NULL'), nullable=True)

    # Автоматические сигналы (JSON-строка): стоп-слова, NSFW-скор, дубликаты
    auto_flags = Column(Text, nullable=True)
    author_id = Column(Integer, ForeignKey('users.id', ondelete='SET NULL'), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)

    moderator = relationship('User', foreign_keys=[moderator_id])


class Report(Base):
    """Жалоба пользователя на контент."""

    __tablename__ = 'reports'

    id = Column(Integer, primary_key=True, index=True)
    target_type = Column(String, nullable=False, index=True)
    target_id = Column(Integer, nullable=False, index=True)
    reporter_id = Column(Integer, ForeignKey('users.id', ondelete='SET NULL'), nullable=True)

    reason_code = Column(String, nullable=False)   # spam, abuse, fake_price, copyright, other
    comment = Column(Text, nullable=True)
    # open | resolved | rejected
    status = Column(String, nullable=False, default='open', server_default='open', index=True)
    moderator_id = Column(Integer, ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    resolution = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)


class AuditLog(Base):
    """Неизменяемый журнал действий модераторов и администраторов."""

    __tablename__ = 'audit_log'

    id = Column(Integer, primary_key=True, index=True)
    actor_id = Column(Integer, ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    action = Column(String, nullable=False)          # approve, reject, ban, verify_price…
    target_type = Column(String, nullable=True)
    target_id = Column(Integer, nullable=True)
    payload = Column(Text, nullable=True)            # JSON с деталями
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    actor = relationship('User')


class UserSanction(Base):
    """Санкции: предупреждение, мут, бан, теневой бан — с историей и апелляцией."""

    __tablename__ = 'user_sanctions'

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    # warning | mute | ban | shadowban
    kind = Column(String, nullable=False)
    reason = Column(Text, nullable=True)
    issued_by = Column(Integer, ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True, server_default='true')
    appeal_text = Column(Text, nullable=True)
    appeal_status = Column(String, nullable=True)    # pending | accepted | declined
    created_at = Column(DateTime(timezone=True), server_default=func.now())
