"""Бюджетный подбор «Сметы» — ядро продукта.

Главный сценарий: пользователь говорит «у меня есть 1000 ₽ на ужин в Казани на 4 порции»,
а сервис отдаёт рецепты, которые реально укладываются в эту сумму с учётом цен
конкретных магазинов города, и показывает, как сэкономить, разложив закупку по магазинам.
"""

from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.geo import City
from app.models.price import PriceQuote
from app.models.recipe import Recipe
from app.models.user import User
from app.schemas.smeta import (
    BudgetSelectionOut,
    CityOut,
    NutritionOut,
    RecipeCostOut,
    ShelfOut,
    TrendsOut,
)
from app.services import pricing_service, trends_service
from app.services.pricing_service import RecipePosition

catalog_router = APIRouter(prefix="/catalog", tags=["Бюджетный подбор"])

# Полки бюджета: (ключ, заголовок, минимум, максимум)
SHELF_RANGES = [
    ('up_to_300', 'до 300 ₽', None, 300.0),
    ('300_600', '300–600 ₽', 300.0, 600.0),
    ('600_1000', '600–1000 ₽', 600.0, 1000.0),
    ('1000_1500', '1000–1500 ₽', 1000.0, 1500.0),
    ('over_1500', 'от 1500 ₽', 1500.0, None),
]


def _scaled_positions(positions: List[RecipePosition], scale: float) -> List[RecipePosition]:
    """Масштабирует количества под нужное число порций.

    Важно: цена пересчитывается заново (а не умножается), потому что продукты
    покупаются упаковками, и стоимость растёт нелинейно.
    """
    if abs(scale - 1.0) < 1e-9:
        return positions
    result: List[RecipePosition] = []
    for position in positions:
        result.append(
            RecipePosition(
                name=position.name,
                quantity=position.quantity * scale if position.quantity is not None else None,
                unit=position.unit,
                product=position.product,
                grams=position.grams * scale if position.grams is not None else None,
            )
        )
    return result


def _build_costs(
    db: Session,
    recipes: List[Recipe],
    city_id: Optional[int],
    servings: Optional[int],
    max_shops: int,
    product_index: dict,
) -> Dict[int, dict]:
    """Считает сметы для списка рецептов, загружая цены одним запросом.

    Это ключевая оптимизация: цены на все продукты всех рецептов берутся разом,
    а не по запросу на рецепт.
    """
    positions_by_recipe: Dict[int, List[RecipePosition]] = {}
    product_ids = set()

    for recipe in recipes:
        positions = pricing_service.recipe_positions(recipe, product_index)
        target_servings = servings or recipe.servings or 2
        scale = target_servings / max(1, recipe.servings or 2)
        positions = _scaled_positions(positions, scale)
        positions_by_recipe[recipe.id] = positions
        for position in positions:
            if position.product is not None:
                product_ids.add(position.product.id)

    prices, shops = pricing_service.load_price_map(db, city_id, product_ids)

    result: Dict[int, dict] = {}
    for recipe in recipes:
        positions = positions_by_recipe[recipe.id]
        target_servings = servings or recipe.servings or 2
        options = pricing_service.build_options(positions, prices, shops, max_shops=max_shops)

        single = options.get('single')
        split = options.get('split')
        totals = [opt.total for opt in (single, split) if opt is not None and opt.total > 0]
        best_total = min(totals) if totals else 0.0
        matched = len([p for p in positions if p.product is not None])

        result[recipe.id] = {
            'servings': target_servings,
            'single': single,
            'split': split,
            'best_total': best_total,
            'price_per_serving': round(best_total / target_servings, 2) if best_total else None,
            'savings': round((single.total - split.total), 2) if single and split else 0.0,
            'nutrition': pricing_service.nutrition(positions, target_servings),
            'positions': len(positions),
            'matched_positions': matched,
        }
    return result


def _to_cost_out(
    recipe: Recipe,
    data: dict,
    authors: Dict[int, User],
    budget: Optional[float] = None,
) -> RecipeCostOut:
    author = authors.get(recipe.user_id)
    best_total = data['best_total']
    return RecipeCostOut(
        recipe_id=recipe.id,
        title=recipe.title,
        description=recipe.description,
        photo_url=recipe.photo_url,
        category=recipe.category,
        servings=data['servings'],
        cook_time_min=recipe.cook_time_min,
        difficulty=recipe.difficulty,
        username=author.username if author else None,
        avatar_url=author.avatar_url if author else None,
        ri_score=recipe.ri_score,
        is_verified=bool(recipe.is_verified),
        status=recipe.status,
        single=data['single'].as_dict() if data['single'] else None,
        split=data['split'].as_dict() if data['split'] else None,
        best_total=round(best_total, 2),
        price_per_serving=data['price_per_serving'],
        savings=data['savings'],
        nutrition=NutritionOut(**data['nutrition']),
        matched_positions=data['matched_positions'],
        positions=data['positions'],
        fits_budget=(best_total <= budget) if (budget and best_total) else None,
        budget_left=round(budget - best_total, 2) if (budget and best_total) else None,
    )


def _resolve_city(db: Session, city_id: Optional[int]) -> Optional[City]:
    if city_id is not None:
        city = db.query(City).filter(City.id == city_id).first()
        if city is None:
            raise HTTPException(status_code=404, detail='Город не найден')
        return city
    return db.query(City).order_by(City.id).first()


def _pricing_city(db: Session, city: Optional[City]) -> tuple:
    """Город, по ценам которого считаем смету, и признак «цены ориентировочные».

    В справочнике больше тысячи городов, а цены собраны пока не для всех.
    Если для выбранного города цен нет, считаем по городу с наибольшим объёмом
    данных и честно помечаем это в ответе — иначе витрина была бы пустой.
    """
    if city is None:
        return None, False

    has_prices = (
        db.query(PriceQuote.id)
        .filter(PriceQuote.city_id == city.id, PriceQuote.status == 'confirmed')
        .first()
    )
    if has_prices is not None:
        return city.id, False

    reference = (
        db.query(PriceQuote.city_id, func.count(PriceQuote.id).label('quotes'))
        .filter(PriceQuote.status == 'confirmed')
        .group_by(PriceQuote.city_id)
        .order_by(func.count(PriceQuote.id).desc())
        .first()
    )
    if reference is None:
        return city.id, False
    return reference[0], True


def _published_recipes(
    db: Session,
    category: Optional[str] = None,
    max_time_min: Optional[int] = None,
    difficulty: Optional[int] = None,
    max_kcal: Optional[float] = None,
    min_protein: Optional[float] = None,
) -> List[Recipe]:
    """Опубликованные рецепты, отфильтрованные в SQL.

    Фильтры применяются до расчёта смет: считать стоимость отброшенных рецептов
    бессмысленно и дорого.
    """
    query = db.query(Recipe).filter(Recipe.status == 'published')
    if category:
        query = query.filter(Recipe.category == category)
    if max_time_min is not None:
        query = query.filter(
            Recipe.cook_time_min.isnot(None), Recipe.cook_time_min <= max_time_min
        )
    if difficulty is not None:
        query = query.filter(Recipe.difficulty == difficulty)
    if max_kcal is not None:
        query = query.filter(
            Recipe.kcal_per_serving.isnot(None), Recipe.kcal_per_serving <= max_kcal
        )
    if min_protein is not None:
        query = query.filter(
            Recipe.protein_per_serving.isnot(None), Recipe.protein_per_serving >= min_protein
        )
    return query.order_by(Recipe.created_at.desc()).all()


def _sort_costs(
    items: List[RecipeCostOut],
    sort: str,
    created: Dict[int, object],
) -> List[RecipeCostOut]:
    """Сортирует готовую выдачу бюджетного подбора.

    Для `price_asc` и `price_desc` сортировка стабильная: при равной цене порядок
    остаётся прежним (как в ленте — от новых к старым).
    """
    if sort == 'price_desc':
        return sorted(items, key=lambda item: -item.best_total)
    if sort == 'ri_desc':
        # Рецепты без Индекса Recartly — в конце списка
        return sorted(
            items,
            key=lambda item: (item.ri_score is None, -(item.ri_score or 0.0), item.best_total),
        )
    if sort == 'new':
        return sorted(
            items,
            key=lambda item: _timestamp(created.get(item.recipe_id)),
            reverse=True,
        )
    return sorted(items, key=lambda item: item.best_total)


def _timestamp(value) -> float:
    """Метка времени в секундах; для отсутствующей даты — 0."""
    if value is None:
        return 0.0
    try:
        return value.timestamp()
    except AttributeError:  # pragma: no cover - защита от нестроковой даты
        return 0.0


@catalog_router.get('/budget', response_model=BudgetSelectionOut)
def budget_selection(
    budget: Optional[float] = Query(None, ge=0, description='Сколько денег есть на блюдо'),
    city_id: Optional[int] = Query(None, description='Город, для которого считаются цены'),
    servings: Optional[int] = Query(None, ge=1, le=50),
    category: Optional[str] = Query(None, description='Категория блюда: Ужин, Завтрак, Суп…'),
    max_shops: int = Query(3, ge=1, le=6, description='Сколько магазинов допустимо в сплите'),
    limit: int = Query(24, ge=1, le=60),
    max_time_min: Optional[int] = Query(
        None, ge=1, le=600, description='Максимальное время готовки, минут'
    ),
    difficulty: Optional[int] = Query(
        None, ge=1, le=3, description='Сложность: 1 — просто, 2 — средне, 3 — сложно'
    ),
    max_kcal: Optional[float] = Query(None, gt=0, description='Максимум ккал на порцию'),
    min_protein: Optional[float] = Query(None, ge=0, description='Минимум белков на порцию, г'),
    sort: str = Query(
        'price_asc',
        pattern='^(price_asc|price_desc|ri_desc|new)$',
        description='Сортировка: цена ↑/↓, Индекс Recartly, новизна',
    ),
    db: Session = Depends(get_db),
):
    """Подбор рецептов под бюджет: что можно приготовить на N рублей в конкретном городе.

    Фильтры по времени, сложности и КБЖУ применяются к выборке рецептов до расчёта
    смет — так подбор остаётся быстрым даже на большом каталоге.
    """
    city = _resolve_city(db, city_id)
    pricing_city_id, prices_estimated = _pricing_city(db, city)
    recipes = _published_recipes(
        db,
        category,
        max_time_min=max_time_min,
        difficulty=difficulty,
        max_kcal=max_kcal,
        min_protein=min_protein,
    )
    product_index = pricing_service.build_product_index(db)

    costs = _build_costs(db, recipes, pricing_city_id, servings, max_shops, product_index)

    authors: Dict[int, User] = {}
    author_ids = {r.user_id for r in recipes}
    if author_ids:
        authors = {u.id: u for u in db.query(User).filter(User.id.in_(author_ids)).all()}

    items: List[RecipeCostOut] = []
    for recipe in recipes:
        data = costs[recipe.id]
        # Показываем только рецепты, которые удалось оценить по реальным ценам
        if data['matched_positions'] == 0:
            continue
        items.append(_to_cost_out(recipe, data, authors, budget))

    fits = [item for item in items if item.best_total > 0]

    if budget:
        fitting = [item for item in fits if item.best_total <= budget]
        # Если в бюджет ничего не влезает — показываем самые дешёвые варианты
        selected = fitting if fitting else fits
    else:
        selected = list(fits)

    created = {recipe.id: recipe.created_at for recipe in recipes}
    selected = _sort_costs(selected, sort, created)[:limit]

    # Полки бюджета формируем по полному набору, а не по урезанной выдаче
    shelves: List[ShelfOut] = []
    for key, title, min_price, max_price in SHELF_RANGES:
        shelf_items = [
            item
            for item in fits
            if (min_price is None or item.best_total >= min_price)
            and (max_price is None or item.best_total < max_price)
        ]
        shelf_items.sort(key=lambda i: i.best_total)
        shelves.append(
            ShelfOut(
                key=key,
                title=title,
                min_price=min_price,
                max_price=max_price,
                count=len(shelf_items),
                items=shelf_items[:12],
            )
        )

    applied_filters = {
        'budget': budget,
        'city_id': city.id if city else None,
        'servings': servings,
        'category': category,
        'max_shops': max_shops,
        'max_time_min': max_time_min,
        'difficulty': difficulty,
        'max_kcal': max_kcal,
        'min_protein': min_protein,
        'sort': sort,
        'limit': limit,
    }

    return BudgetSelectionOut(
        budget=budget,
        city=CityOut.model_validate(city) if city else None,
        servings=servings or 2,
        max_shops=max_shops,
        total_found=len(items),
        fits_count=len([i for i in fits if not budget or i.best_total <= budget]),
        items=selected,
        shelves=shelves,
        prices_estimated=prices_estimated,
        applied_filters={key: value for key, value in applied_filters.items() if value is not None},
    )


@catalog_router.get('/shelves', response_model=List[ShelfOut])
def budget_shelves(
    city_id: Optional[int] = Query(None),
    servings: Optional[int] = Query(None, ge=1, le=50),
    max_shops: int = Query(3, ge=1, le=6),
    db: Session = Depends(get_db),
):
    """Полки бюджета: лента группируется по стоимости блюда, а не по «горячести»."""
    city = _resolve_city(db, city_id)
    pricing_city_id, _ = _pricing_city(db, city)
    recipes = _published_recipes(db)
    product_index = pricing_service.build_product_index(db)
    costs = _build_costs(db, recipes, pricing_city_id, servings, max_shops, product_index)
    authors = {u.id: u for u in db.query(User).all()}

    costs_out = [
        _to_cost_out(recipe, costs[recipe.id], authors)
        for recipe in recipes
        if costs[recipe.id]['matched_positions'] > 0 and costs[recipe.id]['best_total'] > 0
    ]

    shelves: List[ShelfOut] = []
    for key, title, min_price, max_price in SHELF_RANGES:
        shelf_items = [
            item
            for item in costs_out
            if (min_price is None or item.best_total >= min_price)
            and (max_price is None or item.best_total < max_price)
        ]
        shelf_items.sort(key=lambda i: i.best_total)
        shelves.append(
            ShelfOut(
                key=key,
                title=title,
                min_price=min_price,
                max_price=max_price,
                count=len(shelf_items),
                items=shelf_items[:12],
            )
        )
    return shelves


@catalog_router.get('/recipes/{recipe_id}/cost', response_model=RecipeCostOut)
def recipe_cost(
    recipe_id: int,
    city_id: Optional[int] = Query(None),
    servings: Optional[int] = Query(None, ge=1, le=50),
    max_shops: int = Query(3, ge=1, le=6),
    budget: Optional[float] = Query(None, ge=0),
    db: Session = Depends(get_db),
):
    """Смета одного рецепта: варианты закупки, ₽/порция и КБЖУ."""
    recipe = db.query(Recipe).filter(Recipe.id == recipe_id).first()
    if recipe is None:
        raise HTTPException(status_code=404, detail='Рецепт не найден')

    city = _resolve_city(db, city_id)
    pricing_city_id, prices_estimated = _pricing_city(db, city)
    product_index = pricing_service.build_product_index(db)
    costs = _build_costs(db, [recipe], pricing_city_id, servings, max_shops, product_index)
    author = db.query(User).filter(User.id == recipe.user_id).first()
    result = _to_cost_out(recipe, costs[recipe.id], {recipe.user_id: author} if author else {}, budget)
    result.prices_estimated = prices_estimated
    return result


@catalog_router.get('/seasonal')
def seasonal_products(
    city_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    """Что сейчас в сезон: продукты, у которых текущий месяц в списке сезонных.

    Возвращает продукты с минимальной ценой по городу — основа для подборки «что дешевле сейчас».
    """
    from datetime import datetime

    from app.models.price import PriceQuote
    from app.models.product import Product

    month = str(datetime.now().month)
    products = db.query(Product).filter(Product.season_months.isnot(None)).all()

    result = []
    for product in products:
        months = [m.strip() for m in (product.season_months or '').split(',') if m.strip()]
        if month not in months:
            continue

        query = db.query(PriceQuote).filter(
            PriceQuote.product_id == product.id,
            PriceQuote.status != 'rejected',
        )
        if city_id:
            query = query.filter(PriceQuote.city_id == city_id)
        best = query.order_by(PriceQuote.price).first()
        if best is None:
            continue

        result.append(
            {
                'product_id': product.id,
                'name': product.name,
                'category': product.category,
                'unit': product.unit,
                'price': float(best.price),
                'shop_id': best.shop_id,
                'kcal_per_100': product.kcal_per_100,
            }
        )

    result.sort(key=lambda item: item['price'])
    return {'month': int(month), 'items': result}


@catalog_router.get('/price-history/{product_id}')
def price_history(
    product_id: int,
    city_id: Optional[int] = Query(None),
    shop_id: Optional[int] = Query(None),
    limit: int = Query(60, ge=1, le=365),
    db: Session = Depends(get_db),
):
    """История цен продукта — «когда покупать дешевле»."""
    from app.models.price import PriceQuote

    query = db.query(PriceQuote).filter(
        PriceQuote.product_id == product_id,
        PriceQuote.status != 'rejected',
    )
    if city_id:
        query = query.filter(PriceQuote.city_id == city_id)
    if shop_id:
        query = query.filter(PriceQuote.shop_id == shop_id)

    quotes = query.order_by(PriceQuote.checked_at.desc()).limit(limit).all()

    points = [
        {
            'price': float(quote.price),
            'shop_id': quote.shop_id,
            'city_id': quote.city_id,
            'checked_at': quote.checked_at.isoformat() if quote.checked_at else None,
            'source': quote.source,
            'status': quote.status,
        }
        for quote in quotes
    ]

    prices = [point['price'] for point in points]
    return {
        'product_id': product_id,
        'points': points,
        'min': min(prices) if prices else None,
        'max': max(prices) if prices else None,
        'avg': round(sum(prices) / len(prices), 2) if prices else None,
    }


@catalog_router.get('/trends', response_model=TrendsOut)
def price_trends(
    city_id: Optional[int] = Query(None, description='Город: по умолчанию первый в справочнике'),
    days: int = Query(30, ge=1, le=365, description='Окно сравнения, дней'),
    limit: int = Query(12, ge=1, le=60, description='Сколько продуктов в каждом списке'),
    db: Session = Depends(get_db),
):
    """«Цены в вашем городе»: что подешевело, что подорожало и что сейчас в сезон.

    Цена продукта на дату — минимальная по магазинам города: пользователь может
    выбрать магазин, поэтому «цена продукта» — это лучшая доступная цена.
    Продукты с одной точкой истории в ответ не попадают.
    """
    city = _resolve_city(db, city_id)
    if city is None:
        raise HTTPException(status_code=404, detail='В справочнике нет ни одного города')

    data = trends_service.build_trends(db, city.id, days=days, limit=limit)
    return TrendsOut(city=CityOut.model_validate(city), **data)
