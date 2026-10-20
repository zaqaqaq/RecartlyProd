from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class Challenge(Base):
    """Челлендж, например «Ужин за 300 ₽»: уложись в бюджет и попади в лидерборд."""

    __tablename__ = 'challenges'

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    slug = Column(String, nullable=False, unique=True, index=True)
    description = Column(Text, nullable=True)
    emoji = Column(String, nullable=True)

    budget = Column(Float, nullable=False)          # лимит в рублях
    servings = Column(Integer, nullable=False, default=2, server_default='2')
    city_id = Column(Integer, ForeignKey('cities.id', ondelete='SET NULL'), nullable=True)

    starts_at = Column(DateTime(timezone=True), nullable=True)
    ends_at = Column(DateTime(timezone=True), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True, server_default='true')
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    entries = relationship('ChallengeEntry', back_populates='challenge', cascade='all, delete-orphan')


class ChallengeEntry(Base):
    """Участие пользователя в челлендже с итоговой ценой и начисленными баллами."""

    __tablename__ = 'challenge_entries'
    __table_args__ = (UniqueConstraint('challenge_id', 'user_id', name='uq_challenge_user'),)

    id = Column(Integer, primary_key=True, index=True)
    challenge_id = Column(Integer, ForeignKey('challenges.id', ondelete='CASCADE'), nullable=False)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    recipe_id = Column(Integer, ForeignKey('recipes.id', ondelete='SET NULL'), nullable=True)
    basket_id = Column(Integer, ForeignKey('baskets.id', ondelete='SET NULL'), nullable=True)

    total_price = Column(Float, nullable=False, default=0, server_default='0')
    score = Column(Float, nullable=False, default=0, server_default='0')
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    challenge = relationship('Challenge', back_populates='entries')
    user = relationship('User')
