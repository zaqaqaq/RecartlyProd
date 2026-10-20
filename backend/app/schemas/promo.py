"""Схемы акций от пользователей (promo)."""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class PromoCreateIn(BaseModel):
    title: str = Field(min_length=3, max_length=160)
    description: Optional[str] = Field(default=None, max_length=1000)
    shop_id: int
    city_id: Optional[int] = None
    product_id: Optional[int] = None
    old_price: Optional[float] = Field(default=None, gt=0)
    new_price: float = Field(gt=0)
    unit: Optional[str] = Field(default=None, max_length=20)
    photo_url: Optional[str] = None
    ends_at: Optional[datetime] = None


class PromoOut(BaseModel):
    id: int
    title: str
    description: Optional[str] = None

    shop_id: Optional[int] = None
    shop_name: Optional[str] = None
    shop_emoji: Optional[str] = None
    city_id: Optional[int] = None
    city_name: Optional[str] = None
    product_id: Optional[int] = None
    product_name: Optional[str] = None

    old_price: Optional[float] = None
    new_price: float
    unit: Optional[str] = None
    discount_percent: Optional[float] = None
    photo_url: Optional[str] = None

    status: str = 'pending'
    reject_reason: Optional[str] = None
    is_verified: bool = False
    likes_count: int = 0
    views_count: int = 0
    is_liked: bool = False

    author_id: Optional[int] = None
    author_username: Optional[str] = None
    author_avatar_url: Optional[str] = None

    ends_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    is_expired: bool = False

    class Config:
        from_attributes = True


class PromoListOut(BaseModel):
    total: int = 0
    items: List[PromoOut] = []
