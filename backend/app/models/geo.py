from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class City(Base):
    """Город — единица региональности: наличие магазинов и цены зависят от него."""

    __tablename__ = 'cities'

    id = Column(Integer, primary_key=True, index=True)
    # Название не уникально: в России есть одноимённые города (Киров, Благовещенск),
    # их различает регион, а уникальность обеспечивает slug
    name = Column(String, nullable=False, index=True)
    slug = Column(String, nullable=False, unique=True, index=True)
    region = Column(String, nullable=True)
    population = Column(Integer, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True, server_default='true')
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    shops = relationship('ShopCity', back_populates='city', cascade='all, delete-orphan')
    quotes = relationship('PriceQuote', back_populates='city', cascade='all, delete-orphan')

    def __repr__(self) -> str:  # pragma: no cover - отладочное
        return f'<City {self.name}>'


class Shop(Base):
    """Магазин (сеть). affiliate_template — шаблон партнёрской ссылки для монетизации."""

    __tablename__ = 'shops'

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True, index=True)
    slug = Column(String, nullable=False, unique=True, index=True)
    emoji = Column(String, nullable=True)
    brand_color = Column(String, nullable=True)
    is_online = Column(Boolean, nullable=False, default=False, server_default='false')
    website = Column(String, nullable=True)
    # Шаблон партнёрской ссылки, например: https://shop.ru/search?q={query}
    affiliate_template = Column(String, nullable=True)
    is_partner = Column(Boolean, nullable=False, default=False, server_default='false')
    # Магазин, добавленный пользователем («магазин у дома»): виден только автору
    is_custom = Column(Boolean, nullable=False, default=False, server_default='false')
    created_by = Column(Integer, ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    cities = relationship('ShopCity', back_populates='shop', cascade='all, delete-orphan')
    quotes = relationship('PriceQuote', back_populates='shop', cascade='all, delete-orphan')

    def __repr__(self) -> str:  # pragma: no cover - отладочное
        return f'<Shop {self.name}>'


class ShopCity(Base):
    """Присутствие магазина в конкретном городе."""

    __tablename__ = 'shop_cities'
    __table_args__ = (UniqueConstraint('shop_id', 'city_id', name='uq_shop_city'),)

    id = Column(Integer, primary_key=True, index=True)
    shop_id = Column(Integer, ForeignKey('shops.id', ondelete='CASCADE'), nullable=False)
    city_id = Column(Integer, ForeignKey('cities.id', ondelete='CASCADE'), nullable=False)
    address = Column(String, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True, server_default='true')
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    shop = relationship('Shop', back_populates='cities')
    city = relationship('City', back_populates='shops')


class UserShop(Base):
    """Личный магазин пользователя — «магазин у дома».

    Ссылается на запись в общем справочнике (`shops` с флагом `is_custom`),
    чтобы цены и позиции наборов работали через обычный shop_id.
    Здесь хранится только привязка к автору.
    """

    __tablename__ = 'user_shops'
    __table_args__ = (UniqueConstraint('user_id', 'shop_id', name='uq_user_shop'),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    shop_id = Column(Integer, ForeignKey('shops.id', ondelete='CASCADE'), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship('User')
    # Связь с Shop не объявляем: обратную сторону уже занимает Shop.cities (ShopCity)

