from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class Product(Base):
    """Нормализованный продукт — то, что лежит в корзине и имеет цену в магазине.

    Ингредиент рецепта (свободный текст пользователя) сопоставляется с продуктом
    через `aliases`, чтобы считать стоимость и КБЖУ по реальным ценам магазинов.
    """

    __tablename__ = 'products'

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, index=True)
    # Нормализованное название для поиска и защиты от дублей:
    # «творог 9%» и «Творог9 процентов» дают одно и то же значение
    normalized_name = Column(String, nullable=True, index=True)
    # Категория: овощи, фрукты, мясо, рыба, молочное, бакалея, напитки, прочее
    category = Column(String, nullable=True, index=True)
    # Базовая единица измерения: кг, л, шт, г, мл, упак
    unit = Column(String, nullable=False, default='шт', server_default='шт')

    # Фасовка: сколько граммов в упаковке и сколько штук в упаковке.
    # Нужна, чтобы «400 г макарон» не превращались в «400 упаковок».
    pack_size = Column(Float, nullable=True)
    pack_units = Column(Float, nullable=True)

    # Пищевая ценность на 100 г/мл
    kcal_per_100 = Column(Float, nullable=True)
    protein_per_100 = Column(Float, nullable=True)
    fat_per_100 = Column(Float, nullable=True)
    carbs_per_100 = Column(Float, nullable=True)

    # Сезонность: месяцы через запятую, например '6,7,8' (июнь–август)
    season_months = Column(String, nullable=True)
    # Альтернативные названия для сопоставления: 'картофель,картошка'
    aliases = Column(String, nullable=True)
    is_verified = Column(Boolean, nullable=False, default=False, server_default='false')
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    def __repr__(self) -> str:  # pragma: no cover - отладочное
        return f'<Product {self.name}>'


class ProductNutrition(Base):
    """Пищевая ценность продукта, введённая автором (на 100 г / 100 мл).

    Пользователи вводят данные со упаковки. Если записей несколько — берётся
    медиана, поэтому одна опечатка не портит расчёт. Если записей нет — используются
    справочные значения из `Product.kcal_per_100` и соседних полей.
    """

    __tablename__ = 'product_nutrition'

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey('products.id', ondelete='CASCADE'), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='SET NULL'), nullable=True)

    kcal = Column(Float, nullable=True)
    protein = Column(Float, nullable=True)
    fat = Column(Float, nullable=True)
    carbs = Column(Float, nullable=True)

    # Источник: user (с упаковки) | moderator | import
    source = Column(String, nullable=False, default='user', server_default='user')
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    product = relationship('Product')
