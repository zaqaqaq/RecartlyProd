"""Схемы плана питания и остатков дома."""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class MealPlanGenerateIn(BaseModel):
    city_id: Optional[int] = None
    days: int = Field(default=7, ge=1, le=31)
    meals_per_day: int = Field(default=3, ge=1, le=4)
    servings: int = Field(default=2, ge=1, le=20)
    budget: Optional[float] = Field(default=None, ge=0)
    diet: str = Field(default='any', pattern='^(any|pp|vegetarian|high_protein)$')
    kcal_target: Optional[int] = Field(default=None, ge=500, le=6000)
    protein_target: Optional[int] = Field(default=None, ge=0, le=400)
    title: Optional[str] = None
    save: bool = True


class MealPlanItemOut(BaseModel):
    id: Optional[int] = None
    recipe_id: Optional[int] = None
    title: Optional[str] = None
    photo_url: Optional[str] = None
    category: Optional[str] = None
    cook_time_min: Optional[int] = None
    day_index: int = 0
    meal_type: str = 'dinner'
    price: Optional[float] = None
    kcal: Optional[float] = None
    protein: Optional[float] = None
    fat: Optional[float] = None
    carbs: Optional[float] = None


class MealPlanDayOut(BaseModel):
    day_index: int
    items_count: int = 0
    price: float = 0
    kcal: float = 0
    protein: float = 0
    fat: float = 0
    carbs: float = 0


class MealPlanOut(BaseModel):
    id: Optional[int] = None
    title: str
    city_id: Optional[int] = None
    days: int = 7
    budget: Optional[float] = None
    diet: str = 'any'
    servings: int = 2
    kcal_target: Optional[int] = None
    protein_target: Optional[int] = None
    total_price: float = 0
    price_per_day: Optional[float] = None
    kcal_per_day: Optional[float] = None
    protein_per_day: Optional[float] = None
    fat_per_day: Optional[float] = None
    carbs_per_day: Optional[float] = None
    fits_budget: Optional[bool] = None
    budget_left: Optional[float] = None
    created_at: Optional[datetime] = None
    items: List[MealPlanItemOut] = []
    per_day: List[MealPlanDayOut] = []


class PantryItemIn(BaseModel):
    name: str
    quantity: Optional[float] = None
    unit: Optional[str] = None
    product_id: Optional[int] = None


class PantryItemOut(BaseModel):
    id: int
    name: str
    quantity: Optional[float] = None
    unit: Optional[str] = None
    product_id: Optional[int] = None
    product_name: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class PantrySuggestionOut(BaseModel):
    """Рецепт, который почти целиком собирается из того, что уже есть дома."""

    recipe_id: int
    title: str
    photo_url: Optional[str] = None
    category: Optional[str] = None
    servings: int = 2
    covered_positions: int = 0
    total_positions: int = 0
    covered_ratio: float = 0
    full_price: float = 0
    missing_price: float = 0
    missing_items: List[str] = []
    kcal_per_serving: Optional[float] = None
    ri_score: Optional[float] = None
