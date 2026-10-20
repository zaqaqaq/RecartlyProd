"""Pydantic-схемы балльных реакций и Индекса Recartly.

Три независимые оси (1..5): вкусно / выгодно / просто, плюс флаг «я приготовил».
Расчёт самого индекса живёт в `app.services.pricing_service.compute_ri`.
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class ReactionIn(BaseModel):
    """Оценка рецепта. Все оси необязательные — можно менять по одной."""

    taste: Optional[int] = Field(default=None, ge=1, le=5)
    value: Optional[int] = Field(default=None, ge=1, le=5)
    simplicity: Optional[int] = Field(default=None, ge=1, le=5)
    cooked: bool = False


class ReactionOut(BaseModel):
    """Сохранённая реакция текущего пользователя."""

    taste: Optional[int] = None
    value: Optional[int] = None
    simplicity: Optional[int] = None
    cooked: bool = False
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class RiOut(BaseModel):
    """Индекс Recartly и агрегаты голосов по рецепту."""

    ri: float
    quality: float
    value_index: float
    reactions_count: int
    cooked_count: int
    avg_taste: Optional[float] = None
    avg_value: Optional[float] = None
    avg_simplicity: Optional[float] = None


class RecipeReactionsOut(BaseModel):
    """Публичный ответ: агрегаты рецепта + моя реакция, если я авторизован."""

    ri: RiOut
    my: Optional[ReactionOut] = None
