"""Схемы жалоб на контент."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

# Справочник причин: код -> понятное пользователю название
REPORT_REASONS = {
    'spam': 'Спам или реклама',
    'abuse': 'Оскорбления и агрессия',
    'fake_price': 'Неверная цена',
    'copyright': 'Чужой контент без указания автора',
    'off_topic': 'Не по теме',
    'dangerous': 'Опасный или вредный совет',
    'other': 'Другое',
}


class ReportCreateIn(BaseModel):
    target_type: str = Field(pattern='^(recipe|cart|review|comment|price|user|promo)$')
    target_id: int
    reason_code: str
    comment: Optional[str] = Field(default=None, max_length=1000)


class ReportOut(BaseModel):
    id: int
    target_type: str
    target_id: int
    reason_code: str
    reason_label: Optional[str] = None
    comment: Optional[str] = None
    status: str
    resolution: Optional[str] = None
    created_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None

    class Config:
        from_attributes = True
