"""«Моя неделя» — сводка для пользователя: что готовлю, что купил, сколько потратил.

Собирает в одном месте активный план питания, сметы покупок с отметками и траты,
чтобы меню не «терялось» после генерации, а вело человека по неделе.
"""

from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user_required
from app.core.database import get_db
from app.models.basket import Basket
from app.models.mealplan import MealPlan
from app.models.recipe import Recipe
from app.models.user import User

dashboard_router = APIRouter(prefix='/dashboard', tags=['Моя неделя'])

# Ориентир стоимости готовой еды на порцию — для сравнения «домашнее против доставки».
# Значение усреднённое по рынку доставки и используется только как ориентир в интерфейсе.
DELIVERY_PRICE_PER_SERVING = 450.0


def _basket_stats(basket: Basket) -> dict:
    items = basket.items or []
    checked = [item for item in items if item.is_checked]
    # У позиции сметы хранится только цена (без line_total) — считаем по ней
    spent = round(sum((item.price or 0) for item in checked), 2)
    remaining = round(
        sum((item.price or 0) for item in items if not item.is_checked),
        2,
    )
    return {
        'id': basket.id,
        'title': basket.title,
        'strategy': basket.strategy,
        'recipe_id': basket.recipe_id,
        'total_price': round(basket.total_price or 0, 2),
        'savings': round(basket.savings or 0, 2),
        'items_count': len(items),
        'checked_count': len(checked),
        'spent': spent,
        'remaining': remaining,
        'updated_at': basket.updated_at or basket.created_at,
    }


@dashboard_router.get('/week')
def week_summary(
    days: int = Query(7, ge=1, le=31, description='За сколько дней считать траты'),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_required),
):
    """Сводка недели: план питания, сметы, траты и экономия."""
    since = datetime.utcnow() - timedelta(days=days)

    # 1. Активный план питания (последний созданный)
    plan = (
        db.query(MealPlan)
        .filter(MealPlan.user_id == current_user.id)
        .order_by(MealPlan.created_at.desc())
        .first()
    )

    plan_summary = None
    if plan is not None:
        plan_items = plan.items or []
        plan_summary = {
            'id': plan.id,
            'title': plan.title,
            'days': plan.days,
            'diet': plan.diet,
            'servings': plan.servings,
            'total_price': round(plan.total_price or 0, 2),
            'items_count': len(plan_items),
            'kcal_per_day': round(
                sum(item.kcal or 0 for item in plan_items) / max(1, plan.days), 1
            ),
            'protein_per_day': round(
                sum(item.protein or 0 for item in plan_items) / max(1, plan.days), 1
            ),
            'next_items': [
                {
                    'recipe_id': item.recipe_id,
                    'day_index': item.day_index,
                    'meal_type': item.meal_type,
                    'title': item.recipe.title if item.recipe else None,
                }
                for item in sorted(plan_items, key=lambda row: (row.day_index, row.position))[:5]
            ],
        }

    # 2. Сметы покупок: активные и недавние
    baskets = (
        db.query(Basket)
        .filter(Basket.user_id == current_user.id)
        .order_by(Basket.created_at.desc())
        .limit(10)
        .all()
    )
    basket_stats = [_basket_stats(basket) for basket in baskets]
    active_baskets = [row for row in basket_stats if row['checked_count'] < row['items_count']]

    # 3. Траты и экономия за период
    spent = round(sum(row['spent'] for row in basket_stats), 2)
    savings = round(sum(row['savings'] for row in basket_stats), 2)
    to_buy = round(sum(row['remaining'] for row in active_baskets), 2)

    # 4. Мои рецепты: сколько опубликовано и как их оценивают
    recipes = db.query(Recipe).filter(Recipe.user_id == current_user.id).all()
    published = [recipe for recipe in recipes if recipe.status == 'published']
    rated = [recipe for recipe in published if recipe.ri_score is not None]
    avg_ri = round(sum(recipe.ri_score for recipe in rated) / len(rated), 1) if rated else None

    # 5. Сравнение с доставкой: сколько порций закрыто домашней едой.
    # Порции берём из рецепта, к которому привязана смета, и считаем долю
    # отмеченных позиций — смета может быть куплена частично.
    servings_cooked = 0.0
    for basket in baskets:
        items = basket.items or []
        if not items:
            continue
        checked = len([item for item in items if item.is_checked])
        if not checked:
            continue
        servings = int(basket.recipe.servings or 2) if basket.recipe is not None else 2
        servings_cooked += servings * (checked / len(items))
    servings_cooked = int(round(servings_cooked))
    delivery_estimate = round(servings_cooked * DELIVERY_PRICE_PER_SERVING, 2)

    return {
        'period_days': days,
        'plan': plan_summary,
        'baskets': basket_stats,
        'active_baskets': active_baskets,
        'spent': spent,
        'savings': savings,
        'to_buy': to_buy,
        'recipes': {
            'total': len(recipes),
            'published': len(published),
            'pending': len([recipe for recipe in recipes if recipe.status in ('pending', 'needs_changes')]),
            'avg_ri': avg_ri,
        },
        'delivery': {
            'servings_cooked': servings_cooked,
            'price_per_serving': DELIVERY_PRICE_PER_SERVING,
            'delivery_estimate': delivery_estimate,
            'homemade_spent': spent,
            'saved': round(max(0.0, delivery_estimate - spent), 2),
        },
        'level': {
            'points': int(current_user.points or 0),
            'level': int(current_user.level or 1),
            'trust_score': float(current_user.trust_score or 50),
        },
    }
