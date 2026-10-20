"""Пересчёт Индекса Recartly для рецепта.

Формула индекса живёт в `app.services.pricing_service.compute_ri` — здесь только
сбор реакций, оценка ₽/порция и запись агрегатов в кэш-поля рецепта
(`ri_score`, `reactions_count`, `cooked_count`), чтобы логика не расползалась по роутам.
"""

from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from app.models.reaction import Reaction
from app.models.recipe import Recipe
from app.services.pricing_service import compute_ri, recipe_cost_summary
from app.services.recipe_service import RecipeService


def recipe_price_per_serving(db: Session, recipe: Recipe) -> Optional[float]:
    """₽ за порцию для оценки выгоды.

    Сначала пробуем настоящую смету по ценам магазинов (`best_total / servings`),
    а если цен в базе нет — падаем на приближение по ценам ингредиентов.
    Ноль означает «цены неизвестны», тогда возвращаем None (индекс не штрафует).
    """
    servings = max(1, int(recipe.servings or 1))

    best_total = 0.0
    try:
        summary = recipe_cost_summary(db, recipe, getattr(recipe, 'city_id', None))
        best_total = float(summary.get('best_total') or 0.0)
    except Exception:  # noqa: BLE001 — смета не должна ломать сохранение реакции
        best_total = 0.0

    if not best_total:
        best_total = float(RecipeService.calculate_total_price(recipe) or 0.0)

    if not best_total:
        return None
    return round(best_total / servings, 2)


def compute_recipe_ri(db: Session, recipe: Recipe) -> dict:
    """Считает Индекс Recartly по текущим реакциям, ничего не записывая."""
    reactions = db.query(Reaction).filter(Reaction.recipe_id == recipe.id).all()
    return compute_ri(reactions, recipe_price_per_serving(db, recipe))


def recalculate_recipe_ri(db: Session, recipe: Recipe) -> dict:
    """Пересчитывает индекс и обновляет кэш-поля рецепта. Возвращает агрегаты."""
    result = compute_recipe_ri(db, recipe)

    recipe.reactions_count = result['reactions_count']
    recipe.cooked_count = result['cooked_count']
    recipe.ri_score = result['ri']

    db.commit()
    db.refresh(recipe)
    return result
