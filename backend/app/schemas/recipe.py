from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List

class IngredientBase(BaseModel):
    name: str
    quantity: str
    price: Optional[float] = None
    # Фото продукта: что именно куплено («творог» на фото)
    photo_url: Optional[str] = None

class IngredientCreate(IngredientBase):
    pass

class IngredientResponse(IngredientBase):
    id: int
    recipe_id: int
    position: int = 0

    class Config:
        from_attributes = True


class RecipeStepBase(BaseModel):
    """Шаг приготовления: текст и необязательное фото результата."""

    text: str
    photo_url: Optional[str] = None

class RecipeStepCreate(RecipeStepBase):
    pass

class RecipeStepResponse(RecipeStepBase):
    id: int
    recipe_id: int
    position: int = 0

    class Config:
        from_attributes = True

class RecipeBase(BaseModel):
    title: str
    description: Optional[str] = None
    instructions: str

class RecipeCreate(RecipeBase):
    ingredients: List[IngredientCreate]
    # Шаги с фото; если не переданы — разложим `instructions` по строкам
    steps: Optional[List[RecipeStepCreate]] = None
    photo_url: Optional[str] = None

class RecipeResponse(RecipeBase):
    id: int
    user_id: int
    created_at: datetime
    updated_at: Optional[datetime] = None
    ingredients: List[IngredientResponse] = []
    # Шаги с фото (новый формат); `instructions` остаётся текстовой выжимкой
    steps: List[RecipeStepResponse] = []
    total_price: Optional[float] = None
    favorites_count: int = 0
    comments_count: int = 0
    username: Optional[str] = None
    avatar_url: Optional[str] = None
    time_ago: Optional[str] = None
    tags: List[str] = []
    photo_url: Optional[str] = None
    is_favorited: bool = False

    # Модерация: draft | pending | published | rejected | needs_changes
    status: Optional[str] = None
    reject_reason: Optional[str] = None
    is_verified: bool = False

    # Бюджетные атрибуты «Сметы»: без набора блюдо живёт в разделе «Рецепты»
    basket_id: Optional[int] = None
    servings: Optional[int] = None
    cook_time_min: Optional[int] = None
    difficulty: Optional[int] = None
    category: Optional[str] = None
    ri_score: Optional[float] = None
    kcal_per_serving: Optional[float] = None
    protein_per_serving: Optional[float] = None
    fat_per_serving: Optional[float] = None
    carbs_per_serving: Optional[float] = None

    class Config:
        from_attributes = True