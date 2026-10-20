from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class Reaction(Base):
    """Балльная реакция на рецепт вместо «горячо/холодно».

    Три независимые оси (1–5): насколько вкусно, насколько выгодно по цене
    и насколько просто приготовить. Отдельный флаг `cooked` — «я это приготовил»;
    такие голоса весят больше при расчёте Индекса Recartly.
    """

    __tablename__ = 'reactions'
    __table_args__ = (UniqueConstraint('recipe_id', 'user_id', name='uq_reaction_user_recipe'),)

    id = Column(Integer, primary_key=True, index=True)
    recipe_id = Column(Integer, ForeignKey('recipes.id', ondelete='CASCADE'), nullable=False)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)

    taste = Column(Integer, nullable=True)        # 1..5 — вкусно
    value = Column(Integer, nullable=True)        # 1..5 — выгодно
    simplicity = Column(Integer, nullable=True)   # 1..5 — просто
    cooked = Column(Boolean, nullable=False, default=False, server_default='false')

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    recipe = relationship('Recipe', back_populates='reactions')
    user = relationship('User')

    def __repr__(self) -> str:  # pragma: no cover - отладочное
        return f'<Reaction recipe={self.recipe_id} user={self.user_id}>'


class CookedPhoto(Base):
    """Фото «что получилось» — доказательство, что рецепт реально приготовили."""

    __tablename__ = 'cooked_photos'

    id = Column(Integer, primary_key=True, index=True)
    recipe_id = Column(Integer, ForeignKey('recipes.id', ondelete='CASCADE'), nullable=False)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    photo_url = Column(String, nullable=False)
    status = Column(String, nullable=False, default='pending', server_default='pending')
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    recipe = relationship('Recipe')
    user = relationship('User')
