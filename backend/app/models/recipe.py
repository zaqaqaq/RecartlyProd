from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class Recipe(Base):
    __tablename__ = "recipes"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, index=True, nullable=False)
    description = Column(Text, nullable=True)
    instructions = Column(Text, nullable=False)
    photo_url = Column(String, nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # ---------- «Смета»: бюджетные и потребительские атрибуты ----------
    servings = Column(Integer, nullable=False, default=2, server_default='2')
    cook_time_min = Column(Integer, nullable=True)
    difficulty = Column(Integer, nullable=True)          # 1 — просто, 2 — средне, 3 — сложно
    category = Column(String, nullable=True, index=True)  # ужин, завтрак, салат, суп, десерт…
    city_id = Column(Integer, ForeignKey('cities.id', ondelete='SET NULL'), nullable=True)
    season_months = Column(String, nullable=True)        # '6,7,8'

    # Блюдо готовится из набора. Пока набора нет — блюдо живёт в разделе «Рецепты»
    # и в бюджетном подборе не участвует (там нужна цена)
    basket_id = Column(Integer, ForeignKey('baskets.id', ondelete='SET NULL'), nullable=True, index=True)

    # КБЖУ на одну порцию
    kcal_per_serving = Column(Float, nullable=True)
    protein_per_serving = Column(Float, nullable=True)
    fat_per_serving = Column(Float, nullable=True)
    carbs_per_serving = Column(Float, nullable=True)

    # Кэш Индекса Recartly (0–100) и агрегаты реакций
    ri_score = Column(Float, nullable=True, index=True)
    reactions_count = Column(Integer, nullable=False, default=0, server_default='0')
    cooked_count = Column(Integer, nullable=False, default=0, server_default='0')

    # ---------- Модерация ----------
    # draft | pending | published | rejected | needs_changes
    status = Column(String, nullable=False, default='published', server_default='published', index=True)
    reject_reason = Column(String, nullable=True)
    moderated_by = Column(Integer, ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    moderated_at = Column(DateTime(timezone=True), nullable=True)
    is_verified = Column(Boolean, nullable=False, default=False, server_default='false')

    # Связи
    user = relationship("User", back_populates="recipes", foreign_keys=[user_id])
    ingredients = relationship("Ingredient", back_populates="recipe", cascade="all, delete-orphan")
    comments = relationship("Comment", back_populates="recipe", cascade="all, delete-orphan")
    favorited_by = relationship("Favorite", back_populates="recipe", cascade="all, delete-orphan")
    reactions = relationship("Reaction", back_populates="recipe", cascade="all, delete-orphan")
    steps = relationship(
        "RecipeStep",
        back_populates="recipe",
        cascade="all, delete-orphan",
        order_by="RecipeStep.position",
    )


class RecipeStep(Base):
    """Шаг приготовления: текст и необязательное фото «как должно выглядеть».

    Раньше шаги были одной строкой текста (`recipes.instructions`). Теперь каждый
    шаг — отдельная запись со своей картинкой, а `instructions` остаётся как
    текстовая выжимка (для поиска и совместимости).
    """

    __tablename__ = 'recipe_steps'

    id = Column(Integer, primary_key=True, index=True)
    recipe_id = Column(Integer, ForeignKey('recipes.id', ondelete='CASCADE'), nullable=False, index=True)
    position = Column(Integer, nullable=False, default=0, server_default='0')
    text = Column(Text, nullable=False)
    photo_url = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    recipe = relationship('Recipe', back_populates='steps')
