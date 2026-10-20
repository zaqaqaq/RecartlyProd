from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class MealPlan(Base):
    """План питания на несколько дней в рамках бюджета («7 ужинов на 3000 ₽»)."""

    __tablename__ = 'meal_plans'

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    city_id = Column(Integer, ForeignKey('cities.id', ondelete='SET NULL'), nullable=True)

    title = Column(String, nullable=False)
    budget = Column(Float, nullable=True)
    days = Column(Integer, nullable=False, default=7, server_default='7')
    servings = Column(Integer, nullable=False, default=2, server_default='2')
    # any | pp (правильное питание) | vegetarian | high_protein
    diet = Column(String, nullable=False, default='any', server_default='any')

    kcal_target = Column(Integer, nullable=True)     # цель по калориям в день
    protein_target = Column(Integer, nullable=True)  # цель по белку в день, г

    total_price = Column(Float, nullable=False, default=0, server_default='0')
    is_active = Column(Boolean, nullable=False, default=True, server_default='true')
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    items = relationship('MealPlanItem', back_populates='plan', cascade='all, delete-orphan')

    def __repr__(self) -> str:  # pragma: no cover - отладочное
        return f'<MealPlan {self.title} days={self.days}>'


class MealPlanItem(Base):
    """Приём пищи в плане: рецепт, день, тип приёма и посчитанные КБЖУ со стоимостью."""

    __tablename__ = 'meal_plan_items'

    id = Column(Integer, primary_key=True, index=True)
    plan_id = Column(Integer, ForeignKey('meal_plans.id', ondelete='CASCADE'), nullable=False)
    recipe_id = Column(Integer, ForeignKey('recipes.id', ondelete='SET NULL'), nullable=True)

    day_index = Column(Integer, nullable=False, default=0, server_default='0')  # 0..days-1
    # breakfast | lunch | dinner | snack
    meal_type = Column(String, nullable=False, default='dinner', server_default='dinner')
    servings = Column(Integer, nullable=False, default=2, server_default='2')

    price = Column(Float, nullable=True)
    kcal = Column(Float, nullable=True)
    protein = Column(Float, nullable=True)
    fat = Column(Float, nullable=True)
    carbs = Column(Float, nullable=True)
    position = Column(Integer, nullable=False, default=0, server_default='0')

    plan = relationship('MealPlan', back_populates='items')
    recipe = relationship('Recipe')


class PantryItem(Base):
    """Остатки дома — вход для подбора «собери из того, что есть»."""

    __tablename__ = 'pantry_items'

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey('products.id', ondelete='SET NULL'), nullable=True)

    name = Column(String, nullable=False)
    quantity = Column(Float, nullable=True)
    unit = Column(String, nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
