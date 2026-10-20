"""Генератор меню «7 ужинов на 3000 ₽» с расчётом КБЖУ и ПП-режимами.

Алгоритм жадный, но осмысленный: сначала считаем себестоимость и КБЖУ всех рецептов
для города, затем раскладываем их по дням и приёмам пищи, укладываясь в бюджет
и целясь в калорийность/белок, если они заданы.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from app.models.recipe import Recipe
from app.services import pricing_service

# Режимы питания
DIETS = ('any', 'pp', 'vegetarian', 'high_protein')

# Слова-маркеры мяса, птицы и рыбы — для вегетарианского режима
MEAT_MARKERS = (
    'кур', 'мяс', 'свин', 'говяд', 'фарш', 'колбас', 'сосиск', 'бекон', 'индейк',
    'рыб', 'лосос', 'треск', 'сельд', 'кревет', 'тунец', 'семг', 'форель', 'минтай',
    'окорок', 'ветчин', 'шашлык', 'печен', 'утк', 'гус',
)

# Соответствие категории рецепта приёму пищи
MEAL_BY_CATEGORY = {
    'завтрак': 'breakfast',
    'салат': 'lunch',
    'суп': 'lunch',
    'ужин': 'dinner',
    'десерт': 'snack',
    'напиток': 'snack',
}


@dataclass
class PlanCandidate:
    recipe_id: int
    title: str
    photo_url: Optional[str]
    category: Optional[str]
    meal_type: str
    price: float
    price_per_serving: float
    kcal: float
    protein: float
    fat: float
    carbs: float
    cook_time: Optional[int]


def is_vegetarian(recipe: Recipe) -> bool:
    text = ' '.join(
        [recipe.title or '', recipe.description or ''] +
        [ingredient.name or '' for ingredient in recipe.ingredients]
    ).lower()
    return not any(marker in text for marker in MEAT_MARKERS)


def meal_type_for(recipe: Recipe) -> str:
    category = (recipe.category or '').strip().lower()
    if category in MEAL_BY_CATEGORY:
        return MEAL_BY_CATEGORY[category]
    return 'dinner'


def build_candidates(
    db: Session,
    city_id: Optional[int],
    servings: int,
    diet: str = 'any',
) -> List[PlanCandidate]:
    """Считает стоимость и КБЖУ всех опубликованных рецептов, отбирая по режиму питания."""
    recipes = db.query(Recipe).filter(Recipe.status == 'published').all()
    product_index = pricing_service.build_product_index(db)

    candidates: List[PlanCandidate] = []
    for recipe in recipes:
        positions = pricing_service.recipe_positions(recipe, product_index)
        matched = [p for p in positions if p.product is not None]
        if not matched:
            continue

        product_ids = [p.product.id for p in matched]
        prices, shops = pricing_service.load_price_map(db, city_id, product_ids)
        options = pricing_service.build_options(positions, prices, shops, max_shops=3)

        totals = [
            option.total for option in (options.get('single'), options.get('split'))
            if option is not None and option.total > 0
        ]
        if not totals:
            continue
        best_total = min(totals)

        # Масштабируем под нужное число порций (закупка упаковками — считаем заново)
        base_servings = max(1, recipe.servings or 2)
        scale = servings / base_servings
        if abs(scale - 1.0) > 1e-9:
            scaled = [
                pricing_service.RecipePosition(
                    name=p.name,
                    quantity=p.quantity * scale if p.quantity is not None else None,
                    unit=p.unit,
                    product=p.product,
                    grams=p.grams * scale if p.grams is not None else None,
                )
                for p in positions
            ]
            scaled_options = pricing_service.build_options(scaled, prices, shops, max_shops=3)
            scaled_totals = [
                option.total
                for option in (scaled_options.get('single'), scaled_options.get('split'))
                if option is not None and option.total > 0
            ]
            best_total = min(scaled_totals) if scaled_totals else best_total
            nutrition = pricing_service.nutrition(scaled, servings)
        else:
            nutrition = pricing_service.nutrition(positions, servings)

        candidate = PlanCandidate(
            recipe_id=recipe.id,
            title=recipe.title,
            photo_url=recipe.photo_url,
            category=recipe.category,
            meal_type=meal_type_for(recipe),
            price=round(best_total, 2),
            price_per_serving=round(best_total / max(1, servings), 2),
            kcal=nutrition['kcal'],
            protein=nutrition['protein'],
            fat=nutrition['fat'],
            carbs=nutrition['carbs'],
            cook_time=recipe.cook_time_min,
        )

        # Фильтры режимов питания
        if diet == 'vegetarian' and not is_vegetarian(recipe):
            continue
        if diet == 'pp' and (candidate.kcal > 550 or candidate.protein < 12):
            continue
        if diet == 'high_protein' and candidate.protein < 25:
            continue

        candidates.append(candidate)

    candidates.sort(key=lambda item: item.price_per_serving)
    return candidates


def generate_plan_items(
    candidates: List[PlanCandidate],
    days: int,
    meals_per_day: int,
    budget: Optional[float],
    kcal_target: Optional[int],
    protein_target: Optional[int],
) -> List[dict]:
    """Раскладывает блюда по дням, укладываясь в бюджет и цели по КБЖУ."""
    if not candidates:
        return []

    # Сколько приёмов пищи в день и какие
    if meals_per_day <= 1:
        meal_slots = ['dinner']
    elif meals_per_day == 2:
        meal_slots = ['breakfast', 'dinner']
    elif meals_per_day == 3:
        meal_slots = ['breakfast', 'lunch', 'dinner']
    else:
        meal_slots = ['breakfast', 'lunch', 'dinner', 'snack']

    pools: Dict[str, List[PlanCandidate]] = {slot: [] for slot in meal_slots}
    for candidate in candidates:
        slot = candidate.meal_type if candidate.meal_type in pools else meal_slots[-1]
        pools[slot].append(candidate)

    # Пустые пулы заполняем общим списком, чтобы план не ломался
    for slot in meal_slots:
        if not pools[slot]:
            pools[slot] = list(candidates)

    items: List[dict] = []
    spent = 0.0
    pointers = {slot: 0 for slot in meal_slots}

    for day in range(days):
        day_kcal = 0.0
        day_protein = 0.0
        used_today = set()

        for slot in meal_slots:
            pool = pools[slot]
            choice = None

            # Ищем вариант: не повторять блюдо в один день и держать бюджет
            for offset in range(len(pool)):
                pointer = (pointers[slot] + offset) % len(pool)
                candidate = pool[pointer]
                if candidate.recipe_id in used_today:
                    continue

                over_budget = budget is not None and (spent + candidate.price) > budget
                # Если бюджет уже превышен, берём самое дешёвое, что есть
                if over_budget and candidate is not pool[0]:
                    continue

                kcal_ok = True
                if kcal_target:
                    projected = day_kcal + candidate.kcal
                    kcal_ok = projected <= kcal_target * 1.25 or day_kcal < kcal_target * 0.6
                if not kcal_ok:
                    continue

                choice = (candidate, pointer)
                break

            if choice is None:
                continue

            candidate, pointer = choice
            pointers[slot] = (pointer + 1) % len(pool)
            used_today.add(candidate.recipe_id)
            spent += candidate.price
            day_kcal += candidate.kcal
            day_protein += candidate.protein

            items.append(
                {
                    'recipe_id': candidate.recipe_id,
                    'day_index': day,
                    'meal_type': slot,
                    'price': candidate.price,
                    'kcal': candidate.kcal,
                    'protein': candidate.protein,
                    'fat': candidate.fat,
                    'carbs': candidate.carbs,
                }
            )

        # Если целимся в белок и день не добрал — добавляем белковый перекус
        if protein_target and day_protein < protein_target * 0.7 and 'snack' in pools and pools['snack']:
            extra = max(pools['snack'], key=lambda c: c.protein, default=None)
            if extra is not None and (budget is None or spent + extra.price <= budget * 1.05):
                spent += extra.price
                items.append(
                    {
                        'recipe_id': extra.recipe_id,
                        'day_index': day,
                        'meal_type': 'snack',
                        'price': extra.price,
                        'kcal': extra.kcal,
                        'protein': extra.protein,
                        'fat': extra.fat,
                        'carbs': extra.carbs,
                    }
                )

    return items


def summarize_plan(items: List[dict], days: int) -> dict:
    """Итоги плана: стоимость, средние КБЖУ в день и разбивка по дням."""
    total = round(sum(item['price'] for item in items), 2)
    days = max(1, days)

    per_day: List[dict] = []
    for day in range(days):
        day_items = [item for item in items if item['day_index'] == day]
        per_day.append(
            {
                'day_index': day,
                'items_count': len(day_items),
                'price': round(sum(item['price'] for item in day_items), 2),
                'kcal': round(sum(item['kcal'] for item in day_items), 1),
                'protein': round(sum(item['protein'] for item in day_items), 1),
                'fat': round(sum(item['fat'] for item in day_items), 1),
                'carbs': round(sum(item['carbs'] for item in day_items), 1),
            }
        )

    return {
        'total_price': total,
        'price_per_day': round(total / days, 2),
        'kcal_per_day': round(sum(item['kcal'] for item in items) / days, 1),
        'protein_per_day': round(sum(item['protein'] for item in items) / days, 1),
        'fat_per_day': round(sum(item['fat'] for item in items) / days, 1),
        'carbs_per_day': round(sum(item['carbs'] for item in items) / days, 1),
        'days': per_day,
    }
