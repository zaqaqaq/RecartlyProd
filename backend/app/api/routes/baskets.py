"""Наборы — центральная сущность продукта.

Набор (раньше «смета» и «публичная корзина») — это публичный контент: состав,
магазины, цены и **дата покупки**. Из набора готовятся блюда, поэтому цена живёт
здесь, а не в рецепте.

Основные сценарии:
- лента наборов с фильтром «влезает в бюджет» и «на сколько человек»;
- карточка набора: состав, деньги, свежесть цен, «что из него приготовить»;
- обновление цен с обязательной датой (и зачёркиванием старой);
- обсуждение и лайки.
"""

import secrets
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_current_user_required
from app.core.database import get_db
from app.models.basket import (
    Basket,
    BasketComment,
    BasketCommentReaction,
    BasketItem,
    BasketLike,
)
from app.models.geo import City, Shop
from app.models.recipe import Recipe
from app.models.user import User
from app.schemas.smeta import (
    BasketCommentIn,
    BasketCommentOut,
    BasketCommentReactionIn,
    BasketCreateIn,
    BasketFeedOut,
    BasketItemOut,
    BasketItemPatch,
    BasketOut,
    BasketPreviewLineOut,
    BasketPreviewOut,
    BasketPricesIn,
    BasketRecipeFeedOut,
    BasketRecipeOut,
)
from app.services import pricing_service
from app.services.moderation_service import auto_flags_for, enqueue_if_needed

baskets_router = APIRouter(prefix="/baskets", tags=["Наборы"])

# Порог свежести цен: до 7 дней — свежие, до 30 — «может устареть», дальше — устарели
FRESH_DAYS = 7
RECENT_DAYS = 30


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _freshness(prices_date: Optional[datetime]) -> str:
    """Насколько свежие цены: fresh | recent | stale | unknown."""
    if prices_date is None:
        return 'unknown'
    if prices_date.tzinfo is None:
        prices_date = prices_date.replace(tzinfo=timezone.utc)
    age = _now() - prices_date
    if age <= timedelta(days=FRESH_DAYS):
        return 'fresh'
    if age <= timedelta(days=RECENT_DAYS):
        return 'recent'
    return 'stale'


def _shop_info(db: Session, shop_ids: set) -> Dict[int, Shop]:
    if not shop_ids:
        return {}
    shops = db.query(Shop).filter(Shop.id.in_(shop_ids)).all()
    return {shop.id: shop for shop in shops}


def _recipes_count(db: Session, basket: Basket, product_ids: set, index=None) -> int:
    """Сколько блюд можно приготовить из набора (покрытие ингредиентов ≥ 60 %)."""
    if not product_ids:
        return 0

    recipes = (
        db.query(Recipe)
        .filter(Recipe.status == 'published')
        .limit(300)
        .all()
    )
    if index is None:
        index = pricing_service.build_product_index(db)
    count = 0
    for recipe in recipes:
        if recipe.basket_id == basket.id:
            count += 1
            continue
        positions = pricing_service.recipe_positions(recipe, index)
        matched = [p for p in positions if p.product and p.product.id in product_ids]
        if positions and len(matched) / len(positions) >= 0.6:
            count += 1
    return count


def serialize_basket(
    db: Session,
    basket: Basket,
    current_user: Optional[User] = None,
    with_items: bool = True,
    with_stats: bool = True,
) -> BasketOut:
    items = sorted(basket.items, key=lambda item: (item.shop_id or 0, item.position))
    shops = _shop_info(db, {item.shop_id for item in items if item.shop_id})
    author = db.query(User).filter(User.id == basket.user_id).first()
    city = db.query(City).filter(City.id == basket.city_id).first() if basket.city_id else None

    product_ids = {item.product_id for item in items if item.product_id}

    is_liked = False
    if current_user is not None:
        is_liked = (
            db.query(BasketLike.id)
            .filter(BasketLike.basket_id == basket.id, BasketLike.user_id == current_user.id)
            .first()
            is not None
        )

    items_out = [
        BasketItemOut(
            id=item.id,
            name=item.name,
            quantity=item.quantity,
            unit=item.unit,
            product_id=item.product_id,
            shop_id=item.shop_id,
            shop_name=shops[item.shop_id].name if item.shop_id in shops else None,
            shop_emoji=shops[item.shop_id].emoji if item.shop_id in shops else None,
            price=item.price,
            prev_price=item.prev_price,
            photo_url=item.photo_url,
            is_checked=bool(item.is_checked),
            position=item.position or 0,
        )
        for item in items
    ]

    return BasketOut(
        id=basket.id,
        title=basket.title,
        description=basket.description,
        strategy=basket.strategy,
        recipe_id=basket.recipe_id,
        city_id=basket.city_id,
        city_name=city.name if city else None,
        budget=basket.budget,
        total_price=round(basket.total_price or 0, 2),
        savings=round(basket.savings or 0, 2),
        servings=basket.servings or 2,
        prices_date=basket.prices_date,
        prices_freshness=_freshness(basket.prices_date),
        photo_url=basket.photo_url,
        receipt_photo_url=basket.receipt_photo_url,
        status=basket.status,
        is_public=bool(basket.is_public),
        is_family=bool(basket.is_family),
        share_token=basket.share_token,
        likes_count=int(basket.likes_count or 0),
        views_count=int(basket.views_count or 0),
        is_liked=is_liked,
        user_id=basket.user_id,
        username=author.username if author else None,
        avatar_url=author.avatar_url if author else None,
        checked_count=len([item for item in items if item.is_checked]),
        items_count=len(items),
        # Пересчёт блюд по составу — дорогая операция, в ленте она не нужна
        recipes_count=_recipes_count(db, basket, product_ids) if with_stats else 0,
        created_at=basket.created_at,
        items=items_out if with_items else [],
    )


def _apply_item_photos(db: Session, basket: Basket, items_in) -> None:
    """Переносит фото покупок из присланных позиций в собранный состав.

    Когда набор собирается по рецепту, сервер сам подбирает продукты и цены,
    но фотографии, которые автор приложил к позициям, должны сохраниться —
    иначе снимок «творог на полке» терялся бы при выборе рецепта.
    Сопоставляем по нормализованному названию.

    Позиции берём запросом, а не через `basket.items`: после пересборки состава
    коллекция в сессии ещё не обновилась.
    """
    from app.services.product_service import normalize_product_name

    photos = {}
    for item in items_in or []:
        photo = getattr(item, 'photo_url', None)
        if photo:
            photos[normalize_product_name(item.name).lower()] = photo

    if not photos:
        return

    for item in db.query(BasketItem).filter(BasketItem.basket_id == basket.id).all():
        key = normalize_product_name(item.name).lower()
        if key in photos:
            item.photo_url = photos[key]


def _fill_from_recipe(
    db: Session,
    basket: Basket,
    recipe: Recipe,
    city_id: Optional[int],
    strategy: str = 'single',
) -> None:
    """Наполняет набор позициями по ценам магазинов города."""
    product_index = pricing_service.build_product_index(db)
    positions = pricing_service.recipe_positions(recipe, product_index)
    product_ids = [p.product.id for p in positions if p.product]
    prices, shops = pricing_service.load_price_map(db, city_id, product_ids)
    options = pricing_service.build_options(positions, prices, shops, max_shops=3)

    option = options.get(strategy) or options.get('single') or options.get('split')
    if option is None:
        return

    for item in list(basket.items):
        db.delete(item)
    db.flush()

    for index, line in enumerate(option.lines):
        # Храним стоимость позиции с учётом фасовки, иначе сумма не сойдётся с итогом
        position_price = line.line_total if line.line_total is not None else line.price
        db.add(
            BasketItem(
                basket_id=basket.id,
                product_id=line.product_id,
                name=line.name,
                quantity=line.quantity,
                unit=line.unit,
                shop_id=line.shop_id,
                price=position_price,
                position=index,
            )
        )

    basket.total_price = round(option.total, 2)
    single = options.get('single')
    split = options.get('split')
    basket.savings = round((single.total - split.total), 2) if single and split else 0.0
    db.flush()


@baskets_router.get('/feed', response_model=BasketFeedOut)
def baskets_feed(
    budget: Optional[float] = Query(None, description='Показать наборы не дороже суммы'),
    servings: Optional[List[int]] = Query(None, description='На сколько человек (можно несколько)'),
    sort: str = Query('popular', pattern='^(popular|cheap|expensive|fresh)$'),
    limit: int = Query(20, ge=1, le=100),
    skip: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    """Лента публичных наборов.

    Если бюджет указан — показываем то, что в него влезает. Если не указан,
    выдаём всё: пустого экрана быть не должно. «На сколько человек» — мультивыбор.
    """
    query = db.query(Basket).filter(
        Basket.is_public.is_(True),
        Basket.status == 'published',
    )

    if budget is not None:
        query = query.filter(Basket.total_price <= budget)
    if servings:
        query = query.filter(Basket.servings.in_(servings))

    if sort == 'cheap':
        query = query.order_by(Basket.total_price.asc(), Basket.created_at.desc())
    elif sort == 'expensive':
        query = query.order_by(Basket.total_price.desc(), Basket.created_at.desc())
    elif sort == 'fresh':
        query = query.order_by(Basket.prices_date.desc().nullslast(), Basket.created_at.desc())
    else:
        query = query.order_by(Basket.likes_count.desc(), Basket.created_at.desc())

    total = query.count()
    baskets = query.offset(skip).limit(limit).all()
    return BasketFeedOut(
        total=total,
        items=[
            serialize_basket(db, basket, current_user, with_items=False, with_stats=False)
            for basket in baskets
        ],
    )


@baskets_router.get('/dishes', response_model=BasketRecipeFeedOut)
def dishes_feed(
    budget: Optional[float] = Query(None, description='Показать блюда с набором не дороже суммы'),
    servings: Optional[List[int]] = Query(None, description='На сколько человек (можно несколько)'),
    sort: str = Query('popular', pattern='^(popular|cheap|expensive|fresh)$'),
    max_kcal: Optional[float] = Query(None, description='Калорий на порцию не больше'),
    min_protein: Optional[float] = Query(None, description='Белка на порцию не меньше'),
    limit: int = Query(20, ge=1, le=100),
    skip: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """Блюда, которые готовятся из наборов — вкладка «Блюда» на главной.

    Блюдо без набора сюда не попадает: оно живёт в разделе «Рецепты».
    Фильтры по КБЖУ обслуживают раздел правильного питания.
    """
    query = (
        db.query(Recipe, Basket)
        .join(Basket, Recipe.basket_id == Basket.id)
        .filter(
            Recipe.status == 'published',
            Basket.is_public.is_(True),
            Basket.status == 'published',
        )
    )

    if budget is not None:
        query = query.filter(Basket.total_price <= budget)
    if servings:
        query = query.filter(Basket.servings.in_(servings))
    if max_kcal is not None:
        query = query.filter(Recipe.kcal_per_serving <= max_kcal)
    if min_protein is not None:
        query = query.filter(Recipe.protein_per_serving >= min_protein)

    if sort == 'cheap':
        query = query.order_by(Basket.total_price.asc(), Recipe.id)
    elif sort == 'expensive':
        query = query.order_by(Basket.total_price.desc(), Recipe.id)
    elif sort == 'fresh':
        query = query.order_by(Basket.prices_date.desc().nullslast(), Recipe.id)
    else:
        query = query.order_by(Recipe.ri_score.desc().nullslast(), Basket.likes_count.desc())

    total = query.count()
    rows = query.offset(skip).limit(limit).all()

    items: List[BasketRecipeOut] = []
    for recipe, basket in rows:
        items.append(
            BasketRecipeOut(
                recipe_id=recipe.id,
                title=recipe.title,
                photo_url=recipe.photo_url,
                category=recipe.category,
                cook_time_min=recipe.cook_time_min,
                difficulty=recipe.difficulty,
                servings=basket.servings or recipe.servings or 2,
                ri_score=recipe.ri_score,
                kcal_per_serving=recipe.kcal_per_serving,
                protein_per_serving=recipe.protein_per_serving,
                fat_per_serving=recipe.fat_per_serving,
                carbs_per_serving=recipe.carbs_per_serving,
                coverage=len(basket.items),
                total_positions=len(basket.items),
                basket_id=basket.id,
                basket_title=basket.title,
                basket_total=round(basket.total_price or 0, 2),
                prices_date=basket.prices_date,
                prices_freshness=_freshness(basket.prices_date),
            )
        )

    return BasketRecipeFeedOut(total=total, items=items)


@baskets_router.post('/', response_model=BasketOut)
def create_basket(
    payload: BasketCreateIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_required),
):
    """Создаёт набор: из рецепта или вручную (список продуктов с ценами).

    Дата покупки обязательна — иначе непонятно, свежие это цены или нет.
    """
    recipe = None
    if payload.recipe_id:
        recipe = db.query(Recipe).filter(Recipe.id == payload.recipe_id).first()
        if recipe is None:
            raise HTTPException(status_code=404, detail='Рецепт не найден')

    if payload.prices_date is None and not payload.items:
        raise HTTPException(
            status_code=400,
            detail='Укажите дату покупки — без неё цены нельзя считать актуальными',
        )

    basket = Basket(
        user_id=current_user.id,
        recipe_id=payload.recipe_id,
        city_id=payload.city_id,
        title=payload.title or (f'Набор: {recipe.title}' if recipe else 'Набор продуктов'),
        description=payload.description,
        strategy=payload.strategy,
        budget=payload.budget,
        servings=payload.servings or (recipe.servings if recipe else 2),
        prices_date=payload.prices_date or _now(),
        photo_url=payload.photo_url,
        receipt_photo_url=payload.receipt_photo_url,
        is_family=payload.is_family,
        is_public=payload.is_public,
    )
    db.add(basket)
    db.flush()

    if recipe is not None:
        _fill_from_recipe(db, basket, recipe, payload.city_id, payload.strategy)
        # Состав пересобран по ценам, но авторские фото покупок сохраняем
        _apply_item_photos(db, basket, payload.items)
    elif payload.items:
        total = 0.0
        for index, item in enumerate(payload.items):
            db.add(
                BasketItem(
                    basket_id=basket.id,
                    name=item.name,
                    quantity=item.quantity,
                    unit=item.unit,
                    shop_id=item.shop_id,
                    price=item.price,
                    photo_url=item.photo_url,
                    position=index,
                )
            )
            total += item.price or 0
        basket.total_price = round(total, 2)

    if recipe is not None:
        # Блюдо и набор связываем: рецепт «повышается» в бюджетный раздел
        recipe.basket_id = basket.id

    # Модерация: все новые наборы проходят ручную проверку, как и рецепты.
    # Модератор и админ публикуют сразу — они и есть проверяющие.
    is_privileged = (getattr(current_user, 'role', 'user') or 'user') in ('moderator', 'admin')
    basket.status = 'published' if is_privileged else 'pending'
    if not is_privileged:
        item_names = [
            item.name for item in
            db.query(BasketItem).filter(BasketItem.basket_id == basket.id).all()
        ]
        flags_text = "\n".join(filter(None, [
            basket.title,
            basket.description,
            " ".join(item_names),
        ]))
        enqueue_if_needed(
            db,
            target_type='basket',
            target_id=basket.id,
            author_id=current_user.id,
            auto_flags=auto_flags_for(flags_text, basket.photo_url),
        )

    db.commit()
    db.refresh(basket)
    return serialize_basket(db, basket, current_user)


@baskets_router.get('/', response_model=List[BasketOut])
def my_baskets(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_required),
):
    """Мои наборы (включая черновики и приватные)."""
    baskets = (
        db.query(Basket)
        .filter(Basket.user_id == current_user.id)
        .order_by(Basket.created_at.desc())
        .all()
    )
    return [serialize_basket(db, basket, current_user) for basket in baskets]


@baskets_router.get('/preview', response_model=BasketPreviewOut)
def preview_basket(
    recipe_id: int = Query(..., description='Рецепт, из которого собираем набор'),
    city_id: Optional[int] = Query(None),
    servings: Optional[int] = Query(None, ge=1, le=50),
    db: Session = Depends(get_db),
):
    """Что именно подставится в набор по рецепту — до сохранения.

    Нужен форме создания: человек выбирает рецепт и сразу видит состав,
    магазины и итоговую стоимость, а не пустой список позиций.
    """
    recipe = db.query(Recipe).filter(Recipe.id == recipe_id).first()
    if recipe is None:
        raise HTTPException(status_code=404, detail='Рецепт не найден')

    index = pricing_service.build_product_index(db)
    positions = pricing_service.recipe_positions(recipe, index)
    product_ids = [position.product.id for position in positions if position.product]
    prices, shops = pricing_service.load_price_map(db, city_id, product_ids)
    options = pricing_service.build_options(positions, prices, shops, max_shops=3)
    option = options.get('single') or options.get('split')

    if option is None:
        return BasketPreviewOut(
            recipe_id=recipe.id,
            title=recipe.title,
            servings=servings or recipe.servings or 2,
            total=0,
            lines=[],
            matched_positions=0,
            total_positions=len(positions),
        )

    shop_names = _shop_info(db, {line.shop_id for line in option.lines if line.shop_id})
    lines = [
        BasketPreviewLineOut(
            name=line.name,
            quantity=line.quantity,
            unit=line.unit,
            product_id=line.product_id,
            shop_id=line.shop_id,
            shop_name=shop_names[line.shop_id].name if line.shop_id in shop_names else None,
            price=round(line.line_total if line.line_total is not None else (line.price or 0), 2),
        )
        for line in option.lines
    ]

    return BasketPreviewOut(
        recipe_id=recipe.id,
        title=recipe.title,
        servings=servings or recipe.servings or 2,
        total=round(option.total, 2),
        lines=lines,
        matched_positions=len(lines),
        total_positions=len(positions),
    )


@baskets_router.get('/shared/{token}', response_model=BasketOut)
def shared_basket(token: str, db: Session = Depends(get_db)):
    """Набор по ссылке-токену — доступен без авторизации (семейная закупка)."""
    basket = db.query(Basket).filter(Basket.share_token == token).first()
    if basket is None or basket.status != 'published':
        raise HTTPException(status_code=404, detail='Набор не найден')
    return serialize_basket(db, basket)


@baskets_router.get('/{basket_id}', response_model=BasketOut)
def get_basket(
    basket_id: int,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    """Карточка набора. Непубличный видят только автор и модераторы."""
    basket = db.query(Basket).filter(Basket.id == basket_id).first()
    if basket is None:
        raise HTTPException(status_code=404, detail='Набор не найден')

    role = getattr(current_user, 'role', 'user') if current_user else None
    is_privileged = bool(
        current_user and (basket.user_id == current_user.id or role in ('moderator', 'admin'))
    )
    # Набор на модерации (pending) не виден посторонним даже по прямой ссылке:
    # автор и модераторы должны открыть его, чтобы проверить и одобрить.
    if basket.status != 'published' and not is_privileged:
        raise HTTPException(status_code=404, detail='Набор не найден')
    if not basket.is_public and not basket.share_token and not is_privileged:
        raise HTTPException(status_code=403, detail='Набор приватный')

    basket.views_count = int(basket.views_count or 0) + 1
    db.commit()
    db.refresh(basket)
    return serialize_basket(db, basket, current_user)


@baskets_router.get('/{basket_id}/recipes', response_model=List[BasketRecipeOut])
def basket_recipes(basket_id: int, db: Session = Depends(get_db)):
    """Блюда, которые готовятся из этого набора: авторские и по покрытию состава."""
    basket = db.query(Basket).filter(Basket.id == basket_id).first()
    if basket is None:
        raise HTTPException(status_code=404, detail='Набор не найден')

    product_ids = {item.product_id for item in basket.items if item.product_id}
    recipes = db.query(Recipe).filter(Recipe.status == 'published').limit(300).all()
    index = pricing_service.build_product_index(db)

    result: List[BasketRecipeOut] = []
    for recipe in recipes:
        if recipe.basket_id == basket.id:
            positions = pricing_service.recipe_positions(recipe, index)
            result.append(
                BasketRecipeOut(
                    recipe_id=recipe.id,
                    title=recipe.title,
                    photo_url=recipe.photo_url,
                    category=recipe.category,
                    cook_time_min=recipe.cook_time_min,
                    difficulty=recipe.difficulty,
                    servings=recipe.servings or 2,
                    ri_score=recipe.ri_score,
                    coverage=len(positions),
                    total_positions=len(positions),
                )
            )
            continue

        if not product_ids:
            continue
        positions = pricing_service.recipe_positions(recipe, index)
        matched = [p for p in positions if p.product and p.product.id in product_ids]
        if positions and len(matched) / len(positions) >= 0.6:
            result.append(
                BasketRecipeOut(
                    recipe_id=recipe.id,
                    title=recipe.title,
                    photo_url=recipe.photo_url,
                    category=recipe.category,
                    cook_time_min=recipe.cook_time_min,
                    difficulty=recipe.difficulty,
                    servings=recipe.servings or 2,
                    ri_score=recipe.ri_score,
                    coverage=len(matched),
                    total_positions=len(positions),
                )
            )

    result.sort(key=lambda item: (-item.coverage, -(item.ri_score or 0)))
    return result


@baskets_router.patch('/{basket_id}/prices', response_model=BasketOut)
def update_prices(
    basket_id: int,
    payload: BasketPricesIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_required),
):
    """Обновляет цены набора. Дата покупки обязательна, старая цена запоминается.

    Именно из `prev_price` получается «было 55 ₽, стало 48 ₽» — без обновлений
    цены надпись о снижении не появляется.
    """
    basket = db.query(Basket).filter(
        Basket.id == basket_id, Basket.user_id == current_user.id
    ).first()
    if basket is None:
        raise HTTPException(status_code=404, detail='Набор не найден')

    if payload.prices_date is None:
        raise HTTPException(status_code=400, detail='Укажите дату покупки')

    prices = {item.id: item.price for item in payload.items}
    total = 0.0
    for item in basket.items:
        if item.id in prices and prices[item.id] is not None:
            # Старая цена уходит в prev_price — она зачёркивается в интерфейсе
            item.prev_price = item.price
            item.price = prices[item.id]
        total += item.price or 0

    # Позиции, не переданные в запросе, уже учтены выше новыми ценами
    basket.total_price = round(total, 2)
    basket.prices_date = payload.prices_date
    if payload.photo_url:
        basket.receipt_photo_url = payload.photo_url

    db.commit()
    db.refresh(basket)
    return serialize_basket(db, basket, current_user)


@baskets_router.post('/{basket_id}/like', response_model=BasketOut)
def like_basket(
    basket_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_required),
):
    basket = db.query(Basket).filter(Basket.id == basket_id).first()
    if basket is None:
        raise HTTPException(status_code=404, detail='Набор не найден')

    existing = (
        db.query(BasketLike)
        .filter(BasketLike.basket_id == basket_id, BasketLike.user_id == current_user.id)
        .first()
    )
    if existing is None:
        db.add(BasketLike(basket_id=basket_id, user_id=current_user.id))
        basket.likes_count = int(basket.likes_count or 0) + 1
        db.commit()
        db.refresh(basket)

    return serialize_basket(db, basket, current_user, with_items=False)


@baskets_router.delete('/{basket_id}/like', response_model=BasketOut)
def unlike_basket(
    basket_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_required),
):
    basket = db.query(Basket).filter(Basket.id == basket_id).first()
    if basket is None:
        raise HTTPException(status_code=404, detail='Набор не найден')

    existing = (
        db.query(BasketLike)
        .filter(BasketLike.basket_id == basket_id, BasketLike.user_id == current_user.id)
        .first()
    )
    if existing is not None:
        db.delete(existing)
        basket.likes_count = max(0, int(basket.likes_count or 0) - 1)
        db.commit()
        db.refresh(basket)

    return serialize_basket(db, basket, current_user, with_items=False)


def _serialize_comments(
    db: Session,
    comments: List[BasketComment],
    current_user: Optional[User] = None,
) -> List[BasketCommentOut]:
    """Комментарии с реакциями: счётчики по эмодзи + моя реакция + право удаления."""
    if not comments:
        return []

    ids = [comment.id for comment in comments]
    authors = {
        user.id: user
        for user in db.query(User)
        .filter(User.id.in_({comment.user_id for comment in comments}))
        .all()
    }
    reactions = (
        db.query(BasketCommentReaction)
        .filter(BasketCommentReaction.comment_id.in_(ids))
        .all()
    )

    counts: Dict[int, Dict[str, int]] = {}
    mine: Dict[int, str] = {}
    for reaction in reactions:
        bucket = counts.setdefault(reaction.comment_id, {})
        bucket[reaction.emoji] = bucket.get(reaction.emoji, 0) + 1
        if current_user is not None and reaction.user_id == current_user.id:
            mine[reaction.comment_id] = reaction.emoji

    role = getattr(current_user, 'role', 'user') if current_user else None
    result = []
    for comment in comments:
        author = authors.get(comment.user_id)
        is_mine = bool(current_user and comment.user_id == current_user.id)
        result.append(
            BasketCommentOut(
                id=comment.id,
                basket_id=comment.basket_id,
                text=comment.text,
                parent_id=comment.parent_id,
                user_id=comment.user_id,
                username=author.username if author else None,
                avatar_url=author.avatar_url if author else None,
                created_at=comment.created_at,
                reactions=counts.get(comment.id, {}),
                my_reaction=mine.get(comment.id),
                # Удалять может автор комментария и модератор
                is_mine=is_mine or role in ('moderator', 'admin'),
            )
        )
    return result


def _one_comment(db: Session, comment: BasketComment, current_user: Optional[User]) -> BasketCommentOut:
    return _serialize_comments(db, [comment], current_user)[0]


@baskets_router.get('/{basket_id}/comments', response_model=List[BasketCommentOut])
def basket_comments(
    basket_id: int,
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    """Обсуждение набора с реакциями."""
    comments = (
        db.query(BasketComment)
        .filter(BasketComment.basket_id == basket_id)
        .order_by(BasketComment.created_at.asc())
        .limit(limit)
        .all()
    )
    return _serialize_comments(db, comments, current_user)


@baskets_router.post('/{basket_id}/comments', response_model=BasketCommentOut)
def add_basket_comment(
    basket_id: int,
    payload: BasketCommentIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_required),
):
    basket = db.query(Basket).filter(Basket.id == basket_id).first()
    if basket is None:
        raise HTTPException(status_code=404, detail='Набор не найден')

    comment = BasketComment(
        basket_id=basket_id,
        user_id=current_user.id,
        text=payload.text.strip(),
        parent_id=payload.parent_id,
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)

    return _one_comment(db, comment, current_user)


@baskets_router.delete('/{basket_id}/comments/{comment_id}')
def delete_basket_comment(
    basket_id: int,
    comment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_required),
):
    """Удалить комментарий. Доступно автору комментария и модератору."""
    comment = (
        db.query(BasketComment)
        .filter(BasketComment.id == comment_id, BasketComment.basket_id == basket_id)
        .first()
    )
    if comment is None:
        raise HTTPException(status_code=404, detail='Комментарий не найден')

    role = getattr(current_user, 'role', 'user') or 'user'
    if comment.user_id != current_user.id and role not in ('moderator', 'admin'):
        raise HTTPException(status_code=403, detail='Можно удалять только свои комментарии')

    # Вместе с родителем убираем и ответы на него
    db.query(BasketComment).filter(BasketComment.parent_id == comment_id).delete()
    db.query(BasketCommentReaction).filter(
        BasketCommentReaction.comment_id == comment_id
    ).delete()
    db.delete(comment)
    db.commit()
    return {'message': 'Комментарий удалён'}


@baskets_router.post('/{basket_id}/comments/{comment_id}/reactions', response_model=BasketCommentOut)
def react_to_comment(
    basket_id: int,
    comment_id: int,
    payload: BasketCommentReactionIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_required),
):
    """Поставить реакцию на комментарий. Повторный клик тем же эмодзи заменяет прежнюю."""
    comment = (
        db.query(BasketComment)
        .filter(BasketComment.id == comment_id, BasketComment.basket_id == basket_id)
        .first()
    )
    if comment is None:
        raise HTTPException(status_code=404, detail='Комментарий не найден')

    existing = (
        db.query(BasketCommentReaction)
        .filter(
            BasketCommentReaction.comment_id == comment_id,
            BasketCommentReaction.user_id == current_user.id,
        )
        .all()
    )
    if existing and existing[0].emoji == payload.emoji:
        # Тот же эмодзи — снимаем реакцию
        for reaction in existing:
            db.delete(reaction)
    else:
        for reaction in existing:
            db.delete(reaction)
        db.add(
            BasketCommentReaction(
                comment_id=comment_id,
                user_id=current_user.id,
                emoji=payload.emoji,
            )
        )

    db.commit()
    db.refresh(comment)
    return _one_comment(db, comment, current_user)


@baskets_router.patch('/{basket_id}/visibility', response_model=BasketOut)
def set_visibility(
    basket_id: int,
    is_public: bool = Query(..., description='Показывать набор в лентах и поиске'),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_required),
):
    """Скрыть набор из ленты или вернуть обратно — решает автор."""
    basket = db.query(Basket).filter(
        Basket.id == basket_id, Basket.user_id == current_user.id
    ).first()
    if basket is None:
        raise HTTPException(status_code=404, detail='Набор не найден')

    basket.is_public = is_public
    db.commit()
    db.refresh(basket)
    return serialize_basket(db, basket, current_user)


@baskets_router.patch('/{basket_id}/items/{item_id}', response_model=BasketOut)
def patch_item(
    basket_id: int,
    item_id: int,
    payload: BasketItemPatch,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_required),
):
    """Отметить позицию купленной (в том числе в семейном наборе) или поправить количество."""
    basket = db.query(Basket).filter(Basket.id == basket_id).first()
    if basket is None:
        raise HTTPException(status_code=404, detail='Набор не найден')

    is_owner = basket.user_id == current_user.id
    is_family = basket.is_family and (basket.is_public or basket.share_token)
    if not is_owner and not is_family:
        raise HTTPException(status_code=403, detail='Нет доступа к набору')

    item = db.query(BasketItem).filter(
        BasketItem.id == item_id, BasketItem.basket_id == basket_id
    ).first()
    if item is None:
        raise HTTPException(status_code=404, detail='Позиция не найдена')

    if payload.is_checked is not None:
        item.is_checked = payload.is_checked
        item.checked_by = current_user.id if payload.is_checked else None
    if payload.quantity is not None:
        item.quantity = payload.quantity
    if payload.photo_url is not None:
        item.photo_url = payload.photo_url or None

    db.commit()
    db.refresh(basket)
    return serialize_basket(db, basket, current_user)


@baskets_router.post('/{basket_id}/optimize', response_model=BasketOut)
def optimize_basket(
    basket_id: int,
    city_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_required),
):
    """Пересобирает набор заново по ценам магазинов (обновление состава)."""
    basket = db.query(Basket).filter(
        Basket.id == basket_id, Basket.user_id == current_user.id
    ).first()
    if basket is None:
        raise HTTPException(status_code=404, detail='Набор не найден')
    if basket.recipe_id is None:
        raise HTTPException(status_code=400, detail='Набор не привязан к рецепту')

    recipe = db.query(Recipe).filter(Recipe.id == basket.recipe_id).first()
    if recipe is None:
        raise HTTPException(status_code=404, detail='Рецепт не найден')

    _fill_from_recipe(db, basket, recipe, city_id or basket.city_id, basket.strategy)
    if city_id:
        basket.city_id = city_id
    basket.prices_date = _now()
    db.commit()
    db.refresh(basket)
    return serialize_basket(db, basket, current_user)


@baskets_router.post('/{basket_id}/share', response_model=BasketOut)
def share_basket(
    basket_id: int,
    family: bool = Query(True, description='Семейный режим с чекбоксами'),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_required),
):
    """Публичная ссылка на набор и семейный режим."""
    basket = db.query(Basket).filter(
        Basket.id == basket_id, Basket.user_id == current_user.id
    ).first()
    if basket is None:
        raise HTTPException(status_code=404, detail='Набор не найден')

    if not basket.share_token:
        basket.share_token = secrets.token_urlsafe(12)
    basket.is_public = True
    basket.is_family = family
    db.commit()
    db.refresh(basket)
    return serialize_basket(db, basket, current_user)


@baskets_router.delete('/{basket_id}')
def delete_basket(
    basket_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_required),
):
    basket = db.query(Basket).filter(
        Basket.id == basket_id, Basket.user_id == current_user.id
    ).first()
    if basket is None:
        raise HTTPException(status_code=404, detail='Набор не найден')

    # Отвязываем рецепт: он остаётся, но уходит в раздел «Рецепты»
    db.query(Recipe).filter(Recipe.basket_id == basket.id).update({'basket_id': None})
    db.query(BasketLike).filter(BasketLike.basket_id == basket.id).delete()
    db.query(BasketComment).filter(BasketComment.basket_id == basket.id).delete()
    db.delete(basket)
    db.commit()
    return {'message': 'Набор удалён'}
