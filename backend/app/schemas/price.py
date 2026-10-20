"""Pydantic-схемы краудсорсинга цен: заявка на цену, выдача и поиск продуктов.

Цена — факт о магазине в городе, поэтому заявка всегда привязана к паре
(продукт, магазин, город) и содержит фото ценника как доказательство.
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class PriceQuoteCreateIn(BaseModel):
    """Заявка пользователя «в этом магазине этот продукт стоит столько»."""

    product_id: int
    shop_id: int
    city_id: int
    # Цена за `unit_amount` базовых единиц продукта (обычно за 1 кг / 1 л / 1 шт)
    price: float = Field(..., gt=0)
    unit_amount: float = Field(default=1.0, gt=0)
    # Фото ценника: путь, полученный из POST /prices/upload-photo
    photo_url: Optional[str] = None
    # Короткое пояснение автора (уходит в текст для автофлагов модерации)
    comment: Optional[str] = Field(default=None, max_length=300)


class PriceQuoteOut(BaseModel):
    """Цена в справочнике: то, что видит автор заявки и лента «кто что видел»."""

    id: int
    product_id: int
    product_name: Optional[str] = None
    shop_id: int
    shop_name: Optional[str] = None
    city_id: int
    price: float
    unit_amount: float = 1.0
    source: str = 'user'
    status: str = 'pending'
    photo_url: Optional[str] = None
    created_at: Optional[datetime] = None
    checked_at: Optional[datetime] = None
    reported_by_username: Optional[str] = None

    class Config:
        from_attributes = True


class ProductSearchOut(BaseModel):
    """Продукт справочника для автодополнения в интерфейсе."""

    id: int
    name: str
    category: Optional[str] = None
    unit: Optional[str] = None
    aliases: Optional[str] = None

    class Config:
        from_attributes = True
