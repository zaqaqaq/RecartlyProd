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


class Promo(Base):
    """Акция от пользователя: товар в конкретном магазине по сниженной цене.

    По духу это то, за чем люди ходят на pepper: «увидел ценник — поделился».
    Отличие от `PriceQuote`: цена — разовая акция со сроком и старой ценой,
    а не справочная стоимость товара, поэтому живёт отдельной сущностью
    и обязательно проходит модерацию.
    """

    __tablename__ = 'promos'

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    shop_id = Column(Integer, ForeignKey('shops.id', ondelete='SET NULL'), nullable=True, index=True)
    city_id = Column(Integer, ForeignKey('cities.id', ondelete='SET NULL'), nullable=True, index=True)
    product_id = Column(Integer, ForeignKey('products.id', ondelete='SET NULL'), nullable=True)

    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)

    old_price = Column(Float, nullable=True)
    new_price = Column(Float, nullable=False)
    unit = Column(String, nullable=True)          # за что цена: кг, шт, упак
    photo_url = Column(String, nullable=True)

    starts_at = Column(DateTime(timezone=True), nullable=True)
    ends_at = Column(DateTime(timezone=True), nullable=True, index=True)

    # draft | pending | published | rejected | needs_changes
    status = Column(String, nullable=False, default='pending', server_default='pending', index=True)
    reject_reason = Column(String, nullable=True)
    moderated_by = Column(Integer, ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    moderated_at = Column(DateTime(timezone=True), nullable=True)
    is_verified = Column(Boolean, nullable=False, default=False, server_default='false')

    likes_count = Column(Integer, nullable=False, default=0, server_default='0')
    views_count = Column(Integer, nullable=False, default=0, server_default='0')

    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    user = relationship('User', foreign_keys=[user_id])
    shop = relationship('Shop')
    city = relationship('City')
    product = relationship('Product')


class PromoLike(Base):
    """Лайк акции — база для сортировки «горячие акции»."""

    __tablename__ = 'promo_likes'

    id = Column(Integer, primary_key=True, index=True)
    promo_id = Column(Integer, ForeignKey('promos.id', ondelete='CASCADE'), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    promo = relationship('Promo')
    user = relationship('User')
