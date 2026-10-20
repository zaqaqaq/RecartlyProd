"""«Собери из того, что есть»: остатки дома → рецепты с минимальной докупкой.

Смысл фичи — анти-фуд-вейст: пользователь вводит, что у него уже лежит,
а сервис показывает блюда, которые почти целиком собираются из этого,
и отдельно считает стоимость докупки.
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user_required
from app.core.database import get_db
from app.models.geo import City
from app.models.mealplan import PantryItem
from app.models.product import Product
from app.models.recipe import Recipe
from app.models.user import User
from app.schemas.mealplan import PantryItemIn, PantryItemOut, PantrySuggestionOut
from app.services import pricing_service

pantry_router = APIRouter(prefix="/pantry", tags=["Остатки дома"])


def _serialize_item(db: Session, item: PantryItem) -> PantryItemOut:
    product = None
    if item.product_id:
        product = db.query(Product).filter(Product.id == item.product_id).first()
    return PantryItemOut(
        id=item.id,
        name=item.name,
        quantity=item.quantity,
        unit=item.unit,
        product_id=item.product_id,
        product_name=product.name if product else None,
        created_at=item.created_at,
    )


@pantry_router.get('/', response_model=List[PantryItemOut])
def list_pantry(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_required),
):
    items = (
        db.query(PantryItem)
        .filter(PantryItem.user_id == current_user.id)
        .order_by(PantryItem.created_at.desc())
        .all()
    )
    return [_serialize_item(db, item) for item in items]


@pantry_router.post('/', response_model=PantryItemOut)
def add_pantry_item(
    payload: PantryItemIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_required),
):
    """Добавляет продукт в остатки. Если название совпало со справочником — связываем."""
    product_id = payload.product_id
    if product_id is None:
        product_index = pricing_service.build_product_index(db)
        product = pricing_service.match_product(product_index, payload.name)
        product_id = product.id if product else None

    item = PantryItem(
        user_id=current_user.id,
        name=payload.name,
        quantity=payload.quantity,
        unit=payload.unit,
        product_id=product_id,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _serialize_item(db, item)


@pantry_router.delete('/{item_id}')
def delete_pantry_item(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_required),
):
    item = db.query(PantryItem).filter(
        PantryItem.id == item_id, PantryItem.user_id == current_user.id
    ).first()
    if item is None:
        raise HTTPException(status_code=404, detail='Продукт не найден')
    db.delete(item)
    db.commit()
    return {'message': 'Продукт убран из остатков'}


@pantry_router.post('/suggest', response_model=List[PantrySuggestionOut])
def suggest_recipes(
    city_id: Optional[int] = Query(None),
    limit: int = Query(12, ge=1, le=50),
    min_covered: float = Query(0.4, ge=0, le=1, description='Минимальная доля покрытия'),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_required),
):
    """Рецепты, которые почти целиком собираются из имеющихся дома продуктов."""
    pantry = db.query(PantryItem).filter(PantryItem.user_id == current_user.id).all()
    if not pantry:
        return []

    if city_id is None:
        city = db.query(City).order_by(City.id).first()
        city_id = city.id if city else None

    product_index = pricing_service.build_product_index(db)

    # Продукты, которые уже есть дома
    pantry_product_ids = set()
    for item in pantry:
        if item.product_id:
            pantry_product_ids.add(item.product_id)
            continue
        matched = pricing_service.match_product(product_index, item.name)
        if matched:
            pantry_product_ids.add(matched.id)

    if not pantry_product_ids:
        return []

    recipes = db.query(Recipe).filter(Recipe.status == 'published').all()

    suggestions: List[PantrySuggestionOut] = []
    for recipe in recipes:
        positions = pricing_service.recipe_positions(recipe, product_index)
        matched = [p for p in positions if p.product is not None]
        if not matched:
            continue

        covered = [p for p in matched if p.product.id in pantry_product_ids]
        missing = [p for p in matched if p.product.id not in pantry_product_ids]
        ratio = len(covered) / len(matched)

        # Стоимость всей сметы и стоимость только недостающего
        product_ids = [p.product.id for p in matched]
        prices, shops = pricing_service.load_price_map(db, city_id, product_ids)

        full_total = 0.0
        options = pricing_service.build_options(positions, prices, shops, max_shops=3)
        totals = [
            option.total for option in (options.get('single'), options.get('split'))
            if option is not None and option.total > 0
        ]
        if totals:
            full_total = min(totals)

        missing_total = 0.0
        if missing:
            missing_options = pricing_service.build_options(missing, prices, shops, max_shops=3)
            missing_totals = [
                option.total
                for option in (missing_options.get('single'), missing_options.get('split'))
                if option is not None and option.total > 0
            ]
            if missing_totals:
                missing_total = min(missing_totals)

        suggestions.append(
            PantrySuggestionOut(
                recipe_id=recipe.id,
                title=recipe.title,
                photo_url=recipe.photo_url,
                category=recipe.category,
                servings=max(1, recipe.servings or 2),
                covered_positions=len(covered),
                total_positions=len(matched),
                covered_ratio=round(ratio, 2),
                full_price=round(full_total, 2),
                missing_price=round(missing_total, 2),
                missing_items=[p.name for p in missing][:8],
                kcal_per_serving=recipe.kcal_per_serving,
                ri_score=recipe.ri_score,
            )
        )

    # Сначала то, что покрыто лучше всего и требует меньше докупок
    suggestions.sort(key=lambda s: (-s.covered_ratio, s.missing_price))

    filtered = [item for item in suggestions if item.covered_ratio >= min_covered]
    if filtered:
        return filtered[:limit]

    # Если под порог ничего не подошло, показываем лучшие варианты всё равно:
    # пользователю полезнее увидеть «докупить всего 3 позиции», чем пустой экран.
    return suggestions[: min(limit, 5)]
