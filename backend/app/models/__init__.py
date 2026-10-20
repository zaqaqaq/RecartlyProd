"""Регистрация всех моделей — нужна, чтобы Base.metadata знал о таблицах
(create_all, миграции и autogenerate Alembic).

Модели `ShoppingCart`/`CartItem`/`CartComment`/`CartLike` удалены: их заменил
`Basket` (набор) — раньше это были две сущности об одном и том же.
"""

from app.models.user import User
from app.models.recipe import Recipe, RecipeStep
from app.models.ingredient import Ingredient
from app.models.comment import Comment
from app.models.favorite import Favorite
from app.models.achievement import Achievement
from app.models.review import Review, ReviewLike, ReviewComment

# «Смета»: география, каталог, цены, реакции, наборы, модерация, планы и челленджи
from app.models.geo import City, Shop, ShopCity, UserShop
from app.models.product import Product, ProductNutrition
from app.models.price import PriceQuote
from app.models.reaction import Reaction, CookedPhoto
from app.models.basket import (
    Basket,
    BasketItem,
    BasketLike,
    BasketComment,
    BasketCommentReaction,
    PurchaseClick,
)
from app.models.moderation import ModerationTask, Report, AuditLog, UserSanction
from app.models.mealplan import MealPlan, MealPlanItem, PantryItem
from app.models.challenge import Challenge, ChallengeEntry
from app.models.notification import Notification
from app.models.promo import Promo, PromoLike

__all__ = [
    'User',
    'Recipe',
    'RecipeStep',
    'Ingredient',
    'Comment',
    'Favorite',
    'Achievement',
    'Review',
    'ReviewLike',
    'ReviewComment',
    'City',
    'Shop',
    'ShopCity',
    'UserShop',
    'Product',
    'ProductNutrition',
    'PriceQuote',
    'Reaction',
    'CookedPhoto',
    'Basket',
    'BasketItem',
    'BasketLike',
    'BasketComment',
    'BasketCommentReaction',
    'PurchaseClick',
    'ModerationTask',
    'Report',
    'AuditLog',
    'UserSanction',
    'MealPlan',
    'MealPlanItem',
    'PantryItem',
    'Challenge',
    'ChallengeEntry',
    'Notification',
    'Promo',
    'PromoLike',
]
