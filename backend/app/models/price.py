from sqlalchemy import (
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class PriceQuote(Base):
    """Цена продукта в конкретном магазине конкретного города на дату.

    Это ключевая сущность «Сметы»: цена — факт о магазине, а не свойство рецепта.
    Несколько записей по одному продукту образуют историю цен.
    """

    __tablename__ = 'price_quotes'
    __table_args__ = (
        Index('ix_price_lookup', 'product_id', 'city_id', 'shop_id', 'checked_at'),
    )

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey('products.id', ondelete='CASCADE'), nullable=False)
    shop_id = Column(Integer, ForeignKey('shops.id', ondelete='CASCADE'), nullable=False)
    city_id = Column(Integer, ForeignKey('cities.id', ondelete='CASCADE'), nullable=False)

    price = Column(Float, nullable=False)
    # За какой объём указана цена: 1 кг, 1 л, 1 шт (по умолчанию — базовая единица продукта)
    unit_amount = Column(Float, nullable=False, default=1.0, server_default='1')

    # Источник данных: user (краудсорсинг), parser, moderator
    source = Column(String, nullable=False, default='user', server_default='user')
    # Модерация цены: pending | confirmed | rejected
    status = Column(String, nullable=False, default='pending', server_default='pending')
    photo_url = Column(String, nullable=True)
    reported_by = Column(Integer, ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    checked_at = Column(DateTime(timezone=True), server_default=func.now())
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    product = relationship('Product')
    shop = relationship('Shop', back_populates='quotes')
    city = relationship('City', back_populates='quotes')

    def __repr__(self) -> str:  # pragma: no cover - отладочное
        return f'<PriceQuote product={self.product_id} shop={self.shop_id} {self.price}>'
