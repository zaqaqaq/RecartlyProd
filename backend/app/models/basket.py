"""Набор — центральная сущность Recartly.

Набор (раньше «смета» и «корзина») — это публичный контент: список продуктов
с магазинами, ценами и **датой покупки**. Из набора готовятся блюда, поэтому
цена в продукте живёт именно здесь, а не в рецепте.

Историю заменил два старых дубля: `Basket` (личная смета) и `ShoppingCart`
(UGC-корзина). Теперь это одна сущность.
"""

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class Basket(Base):
    """Набор продуктов: состав, цены, магазин, дата покупки, на сколько человек."""

    __tablename__ = 'baskets'
    __table_args__ = (
        Index('ix_baskets_public_status', 'is_public', 'status'),
        Index('ix_baskets_total', 'total_price'),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    recipe_id = Column(Integer, ForeignKey('recipes.id', ondelete='SET NULL'), nullable=True)
    # Город больше не обязателен: цены даёт автор, география — необязательная подсказка
    city_id = Column(Integer, ForeignKey('cities.id', ondelete='SET NULL'), nullable=True)

    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    # Картинка набора: показывается в ленте и на главной
    photo_url = Column(String, nullable=True)
    # Фото чека — подтверждение цен, отдельно от картинки
    receipt_photo_url = Column(String, nullable=True)

    # single — всё в одном магазине, split — по нескольким (сплит выведен из интерфейса)
    strategy = Column(String, nullable=False, default='single', server_default='single')

    # На сколько человек собирал автор: цена набора привязана к этому числу
    servings = Column(Integer, nullable=False, default=2, server_default='2')

    budget = Column(Float, nullable=True)
    total_price = Column(Float, nullable=False, default=0, server_default='0')
    savings = Column(Float, nullable=False, default=0, server_default='0')

    # Дата, на которую актуальны цены. Обязательна при публикации набора:
    # без неё нельзя понять, свежие это цены или нет
    prices_date = Column(DateTime(timezone=True), nullable=True, index=True)

    is_public = Column(Boolean, nullable=False, default=False, server_default='false')
    is_family = Column(Boolean, nullable=False, default=False, server_default='false')
    share_token = Column(String, nullable=True, unique=True, index=True)

    # Модерация подключается отдельным этапом, поэтому по умолчанию — published
    status = Column(String, nullable=False, default='published', server_default='published', index=True)
    reject_reason = Column(String, nullable=True)

    likes_count = Column(Integer, nullable=False, default=0, server_default='0')
    views_count = Column(Integer, nullable=False, default=0, server_default='0')

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    items = relationship('BasketItem', back_populates='basket', cascade='all, delete-orphan')
    comments = relationship('BasketComment', back_populates='basket', cascade='all, delete-orphan')
    likes = relationship('BasketLike', back_populates='basket', cascade='all, delete-orphan')
    user = relationship('User')
    # Связь с рецептом указываем явно: между таблицами два внешних ключа
    # (baskets.recipe_id и recipes.basket_id)
    recipe = relationship('Recipe', foreign_keys=[recipe_id])

    def __repr__(self) -> str:  # pragma: no cover - отладочное
        return f'<Basket {self.title} {self.total_price}>'


class BasketItem(Base):
    """Позиция набора: продукт, количество, магазин и стоимость позиции."""

    __tablename__ = 'basket_items'

    id = Column(Integer, primary_key=True, index=True)
    basket_id = Column(Integer, ForeignKey('baskets.id', ondelete='CASCADE'), nullable=False)
    product_id = Column(Integer, ForeignKey('products.id', ondelete='SET NULL'), nullable=True)

    name = Column(String, nullable=False)          # текстовая позиция, если продукт не сопоставлен
    quantity = Column(Float, nullable=True)
    unit = Column(String, nullable=True)

    shop_id = Column(Integer, ForeignKey('shops.id', ondelete='SET NULL'), nullable=True)
    # Стоимость позиции целиком (упаковки), а не цена за единицу
    price = Column(Float, nullable=True)
    # Цена до последнего обновления — из неё получается «было 55 ₽, стало 48 ₽»
    prev_price = Column(Float, nullable=True)
    # Фото покупки: как выглядит продукт на полке (необязательно)
    photo_url = Column(String, nullable=True)

    is_checked = Column(Boolean, nullable=False, default=False, server_default='false')
    checked_by = Column(Integer, ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    position = Column(Integer, nullable=False, default=0, server_default='0')

    basket = relationship('Basket', back_populates='items')
    product = relationship('Product')
    shop = relationship('Shop')


class BasketLike(Base):
    """Лайк набора — основа сортировки «сначала популярные»."""

    __tablename__ = 'basket_likes'

    id = Column(Integer, primary_key=True, index=True)
    basket_id = Column(Integer, ForeignKey('baskets.id', ondelete='CASCADE'), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    basket = relationship('Basket', back_populates='likes')
    user = relationship('User')


class BasketComment(Base):
    """Комментарий к набору с поддержкой ответов (parent_id)."""

    __tablename__ = 'basket_comments'

    id = Column(Integer, primary_key=True, index=True)
    basket_id = Column(Integer, ForeignKey('baskets.id', ondelete='CASCADE'), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    parent_id = Column(Integer, ForeignKey('basket_comments.id', ondelete='CASCADE'), nullable=True)
    text = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    basket = relationship('Basket', back_populates='comments')
    user = relationship('User')
    replies = relationship('BasketComment', cascade='all, delete-orphan')
    reactions = relationship('BasketCommentReaction', back_populates='comment', cascade='all, delete-orphan')


class BasketCommentReaction(Base):
    """Реакция на комментарий: эмодзи от пользователя (по одному на пару)."""

    __tablename__ = 'basket_comment_reactions'

    id = Column(Integer, primary_key=True, index=True)
    comment_id = Column(
        Integer, ForeignKey('basket_comments.id', ondelete='CASCADE'), nullable=False, index=True
    )
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    # 👍 ❤️ 🔥 😋 — набор ограничен, чтобы не превратилось в свалку
    emoji = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    comment = relationship('BasketComment', back_populates='reactions')


class PurchaseClick(Base):
    """Клик по партнёрской ссылке — основа учёта монетизации (CPA)."""

    __tablename__ = 'purchase_clicks'

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    shop_id = Column(Integer, ForeignKey('shops.id', ondelete='SET NULL'), nullable=True)
    basket_id = Column(Integer, ForeignKey('baskets.id', ondelete='SET NULL'), nullable=True)
    recipe_id = Column(Integer, ForeignKey('recipes.id', ondelete='SET NULL'), nullable=True)

    url = Column(Text, nullable=False)
    referer = Column(String, nullable=True)
    user_agent = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
