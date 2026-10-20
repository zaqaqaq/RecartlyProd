"""Pydantic-схемы «Сметы»: города, магазины, бюджетный подбор, сметы и партнёрские ссылки."""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


# ---------- География и магазины ----------


class CityOut(BaseModel):
    id: int
    name: str
    slug: str
    region: Optional[str] = None
    population: Optional[int] = None

    class Config:
        from_attributes = True


class CityCreateIn(BaseModel):
    """Город, которого нет в справочнике: пользователь вводит его сам."""

    name: str = Field(min_length=2, max_length=120)
    region: Optional[str] = Field(default=None, max_length=160)
    population: Optional[int] = Field(default=None, ge=0)


class ShopOut(BaseModel):
    id: int
    name: str
    slug: str
    emoji: Optional[str] = None
    brand_color: Optional[str] = None
    is_online: bool = False
    is_partner: bool = False
    has_affiliate: bool = False
    # Магазин, добавленный самим пользователем («магазин у дома»)
    is_custom: bool = False
    user_shop_id: Optional[int] = None

    class Config:
        from_attributes = True


class ShopCreateIn(BaseModel):
    """Свой магазин: название вводит пользователь, оно сохраняется в его профиле."""

    name: str = Field(min_length=2, max_length=120)
    city_id: Optional[int] = None


# ---------- Смета рецепта ----------


class BasketLineOut(BaseModel):
    product_id: Optional[int] = None
    name: str
    quantity: Optional[float] = None
    unit: Optional[str] = None
    shop_id: Optional[int] = None
    shop_name: Optional[str] = None
    price: Optional[float] = None
    line_total: Optional[float] = None
    matched: bool = True
    missing: bool = False


class BasketShopOut(BaseModel):
    id: int
    name: str
    emoji: Optional[str] = None
    slug: Optional[str] = None
    is_online: bool = False
    subtotal: Optional[float] = None


class BasketOptionOut(BaseModel):
    strategy: str                        # single | split
    shops: List[BasketShopOut] = []
    lines: List[BasketLineOut] = []
    total: float = 0
    coverage: int = 0
    total_positions: int = 0
    missing_positions: int = 0
    savings: float = 0


class NutritionOut(BaseModel):
    kcal: float = 0
    protein: float = 0
    fat: float = 0
    carbs: float = 0
    matched_grams: float = 0


class RecipeCostOut(BaseModel):
    """Полная смета рецепта для карточки и страницы рецепта."""

    recipe_id: int
    title: str
    description: Optional[str] = None
    photo_url: Optional[str] = None
    category: Optional[str] = None
    servings: int = 2
    cook_time_min: Optional[int] = None
    difficulty: Optional[int] = None
    username: Optional[str] = None
    avatar_url: Optional[str] = None
    ri_score: Optional[float] = None
    is_verified: bool = False
    status: str = 'published'

    single: Optional[BasketOptionOut] = None
    split: Optional[BasketOptionOut] = None
    best_total: float = 0
    price_per_serving: Optional[float] = None
    savings: float = 0
    nutrition: NutritionOut = NutritionOut()
    matched_positions: int = 0
    positions: int = 0

    # Насколько рецепт укладывается в бюджет пользователя
    fits_budget: Optional[bool] = None
    budget_left: Optional[float] = None
    # True, если для города пользователя цен пока нет и смета посчитана по эталонному городу
    prices_estimated: bool = False


class ShelfOut(BaseModel):
    """Полка бюджета: «до 300 ₽», «300–600 ₽» и так далее."""

    key: str
    title: str
    min_price: Optional[float] = None
    max_price: Optional[float] = None
    count: int = 0
    items: List[RecipeCostOut] = []


class BudgetSelectionOut(BaseModel):
    """Ответ главного экрана «У меня есть N ₽»."""

    budget: Optional[float] = None
    city: Optional[CityOut] = None
    servings: int = 2
    max_shops: int = 3
    total_found: int = 0
    fits_count: int = 0
    items: List[RecipeCostOut] = []
    shelves: List[ShelfOut] = []
    # True, если цены для выбранного города ещё не собраны и взяты из эталонного города
    prices_estimated: bool = False
    # Что реально применилось из фильтров запроса (пустые параметры не попадают)
    applied_filters: dict = {}


# ---------- Тренды цен («Цены в вашем городе») ----------


class ProductTrendOut(BaseModel):
    """Динамика цены продукта: текущая цена против цены в начале окна."""

    product_id: int
    name: str
    category: Optional[str] = None
    unit: Optional[str] = None
    price: float
    old_price: float
    change_percent: float
    change_abs: float
    shop_id: Optional[int] = None
    shop_name: Optional[str] = None
    kcal_per_100: Optional[float] = None
    in_season: bool = False

    class Config:
        from_attributes = True


class SeasonalProductOut(BaseModel):
    """Продукт, который сейчас в сезон, с лучшей ценой в городе."""

    product_id: int
    name: str
    category: Optional[str] = None
    unit: Optional[str] = None
    price: float
    shop_name: Optional[str] = None
    in_season: bool = True

    class Config:
        from_attributes = True


class TrendAveragesOut(BaseModel):
    """Сводка по отслеживаемым ценам города."""

    basket_estimate: Optional[float] = None
    products_tracked: int = 0
    quotes_tracked: int = 0


class TrendsOut(BaseModel):
    """Ответ экрана «Цены в вашем городе»."""

    city: Optional[CityOut] = None
    period_days: int = 30
    dropped: List[ProductTrendOut] = []
    risen: List[ProductTrendOut] = []
    seasonal: List[SeasonalProductOut] = []
    averages: TrendAveragesOut = TrendAveragesOut()


# ---------- Смета покупок (личная корзина) ----------


class BasketItemIn(BaseModel):
    name: str
    quantity: Optional[float] = None
    unit: Optional[str] = None
    product_id: Optional[int] = None
    shop_id: Optional[int] = None
    price: Optional[float] = None


class BasketItemIn(BaseModel):
    """Позиция набора, введённая автором вручную."""

    name: str = Field(min_length=1, max_length=160)
    quantity: Optional[float] = None
    unit: Optional[str] = Field(default=None, max_length=16)
    shop_id: Optional[int] = None
    price: Optional[float] = Field(default=None, ge=0)
    # Фото покупки — необязательно
    photo_url: Optional[str] = None


class BasketCreateIn(BaseModel):
    """Создание набора. `prices_date` — дата покупки, без неё набор не публикуется."""

    title: Optional[str] = None
    description: Optional[str] = Field(default=None, max_length=2000)
    recipe_id: Optional[int] = None
    city_id: Optional[int] = None
    strategy: str = Field(default='single', pattern='^(single|split)$')
    budget: Optional[float] = None
    servings: int = Field(default=2, ge=1, le=50)
    prices_date: Optional[datetime] = None
    photo_url: Optional[str] = None
    receipt_photo_url: Optional[str] = None
    is_family: bool = False
    is_public: bool = True
    # Позиции можно задать вручную (набор без рецепта)
    items: List[BasketItemIn] = []


class BasketItemOut(BaseModel):
    id: int
    name: str
    quantity: Optional[float] = None
    unit: Optional[str] = None
    product_id: Optional[int] = None
    shop_id: Optional[int] = None
    shop_name: Optional[str] = None
    shop_emoji: Optional[str] = None
    price: Optional[float] = None
    # Цена до последнего обновления: из неё получается «было 55 ₽, стало 48 ₽»
    prev_price: Optional[float] = None
    # Фото покупки
    photo_url: Optional[str] = None
    is_checked: bool = False
    position: int = 0

    class Config:
        from_attributes = True


class BasketOut(BaseModel):
    id: int
    title: str
    description: Optional[str] = None
    strategy: str = 'single'
    recipe_id: Optional[int] = None
    city_id: Optional[int] = None
    city_name: Optional[str] = None
    budget: Optional[float] = None
    total_price: float = 0
    savings: float = 0
    servings: int = 2
    prices_date: Optional[datetime] = None
    # fresh (≤7 дней) | recent (8–30) | stale (>30) | unknown
    prices_freshness: str = 'unknown'
    photo_url: Optional[str] = None
    receipt_photo_url: Optional[str] = None
    status: str = 'published'
    is_public: bool = False
    is_family: bool = False
    share_token: Optional[str] = None
    likes_count: int = 0
    views_count: int = 0
    is_liked: bool = False
    user_id: Optional[int] = None
    username: Optional[str] = None
    avatar_url: Optional[str] = None
    checked_count: int = 0
    items_count: int = 0
    # Сколько блюд можно приготовить из набора
    recipes_count: int = 0
    created_at: Optional[datetime] = None
    items: List[BasketItemOut] = []

    class Config:
        from_attributes = True


class BasketFeedOut(BaseModel):
    """Лента наборов: что подходит под бюджет и на сколько человек."""

    total: int = 0
    items: List[BasketOut] = []


class BasketPriceItemIn(BaseModel):
    id: int
    price: Optional[float] = Field(default=None, ge=0)


class BasketPreviewLineOut(BaseModel):
    """Позиция предпросмотра набора: что сервер подставит из рецепта."""

    name: str
    quantity: Optional[float] = None
    unit: Optional[str] = None
    product_id: Optional[int] = None
    shop_id: Optional[int] = None
    shop_name: Optional[str] = None
    price: Optional[float] = None


class BasketPreviewOut(BaseModel):
    """Предпросмотр состава набора по рецепту — до сохранения.

    Нужен, чтобы при создании набора было видно, что именно подставится:
    ингредиенты, магазины и цены, а не пустой список.
    """

    recipe_id: int
    title: str
    servings: int = 2
    total: float = 0
    lines: List[BasketPreviewLineOut] = []
    matched_positions: int = 0
    total_positions: int = 0


class BasketCommentReactionIn(BaseModel):
    emoji: str = Field(min_length=1, max_length=8)


class BasketCommentOut(BaseModel):
    id: int
    basket_id: int
    text: str
    parent_id: Optional[int] = None
    user_id: int
    username: Optional[str] = None
    avatar_url: Optional[str] = None
    created_at: Optional[datetime] = None
    # Реакции: {эмодзи: количество} и моя реакция
    reactions: dict = {}
    my_reaction: Optional[str] = None
    is_mine: bool = False


class BasketPricesIn(BaseModel):
    """Обновление цен набора: обязательна дата покупки, чек — по желанию."""

    prices_date: datetime
    photo_url: Optional[str] = None
    items: List[BasketPriceItemIn] = []


class BasketCommentIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    parent_id: Optional[int] = None


class BasketRecipeOut(BaseModel):
    """Блюдо, которое готовится из набора."""

    recipe_id: int
    title: str
    photo_url: Optional[str] = None
    category: Optional[str] = None
    cook_time_min: Optional[int] = None
    difficulty: Optional[int] = None
    servings: int = 2
    ri_score: Optional[float] = None
    # КБЖУ на порцию — нужны для фильтров правильного питания
    kcal_per_serving: Optional[float] = None
    protein_per_serving: Optional[float] = None
    fat_per_serving: Optional[float] = None
    carbs_per_serving: Optional[float] = None
    # Сколько ингредиентов блюда покрывает набор
    coverage: int = 0
    total_positions: int = 0
    # Набор, из которого готовится блюдо (для вкладки «Блюда»)
    basket_id: Optional[int] = None
    basket_title: Optional[str] = None
    basket_total: Optional[float] = None
    prices_date: Optional[datetime] = None
    prices_freshness: str = 'unknown'


class BasketRecipeFeedOut(BaseModel):
    """Лента блюд, которые готовятся из наборов."""

    total: int = 0
    items: List[BasketRecipeOut] = []


class BasketItemPatch(BaseModel):
    is_checked: Optional[bool] = None
    quantity: Optional[float] = None
    # Фото покупки можно дослать после создания набора
    photo_url: Optional[str] = None


class AffiliateLinkOut(BaseModel):
    """Партнёрская ссылка на магазин (учёт клика идёт через /go/{shop_id})."""

    shop_id: int
    shop_name: str
    url: str
    is_partner: bool = False
