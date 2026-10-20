"""План питания в рамках бюджета: «7 ужинов на 3000 ₽» с КБЖУ и ПП-режимами."""

from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user_required
from app.core.database import get_db
from app.models.geo import City
from app.models.mealplan import MealPlan, MealPlanItem
from app.models.recipe import Recipe
from app.models.user import User
from app.schemas.mealplan import (
    MealPlanDayOut,
    MealPlanGenerateIn,
    MealPlanItemOut,
    MealPlanOut,
)
from app.services import mealplan_service

mealplans_router = APIRouter(prefix="/mealplans", tags=["План питания"])


def _recipes_map(db: Session, recipe_ids: set) -> Dict[int, Recipe]:
    if not recipe_ids:
        return {}
    return {r.id: r for r in db.query(Recipe).filter(Recipe.id.in_(recipe_ids)).all()}


def _serialize_plan(
    db: Session,
    plan: MealPlan,
    items: List[dict],
    summary: dict,
) -> MealPlanOut:
    recipes = _recipes_map(db, {item['recipe_id'] for item in items if item.get('recipe_id')})

    items_out: List[MealPlanItemOut] = []
    for item in items:
        recipe = recipes.get(item.get('recipe_id'))
        items_out.append(
            MealPlanItemOut(
                id=item.get('id'),
                recipe_id=item.get('recipe_id'),
                title=recipe.title if recipe else None,
                photo_url=recipe.photo_url if recipe else None,
                category=recipe.category if recipe else None,
                cook_time_min=recipe.cook_time_min if recipe else None,
                day_index=item.get('day_index', 0),
                meal_type=item.get('meal_type', 'dinner'),
                price=item.get('price'),
                kcal=item.get('kcal'),
                protein=item.get('protein'),
                fat=item.get('fat'),
                carbs=item.get('carbs'),
            )
        )

    items_out.sort(key=lambda row: (row.day_index, row.meal_type))

    fits = None
    left = None
    if plan.budget:
        fits = summary['total_price'] <= plan.budget
        left = round(plan.budget - summary['total_price'], 2)

    return MealPlanOut(
        id=plan.id,
        title=plan.title,
        city_id=plan.city_id,
        days=plan.days,
        budget=plan.budget,
        diet=plan.diet,
        servings=plan.servings,
        kcal_target=plan.kcal_target,
        protein_target=plan.protein_target,
        total_price=summary['total_price'],
        price_per_day=summary['price_per_day'],
        kcal_per_day=summary['kcal_per_day'],
        protein_per_day=summary['protein_per_day'],
        fat_per_day=summary['fat_per_day'],
        carbs_per_day=summary['carbs_per_day'],
        fits_budget=fits,
        budget_left=left,
        created_at=plan.created_at,
        items=items_out,
        per_day=[MealPlanDayOut(**day) for day in summary['days']],
    )


def _generate(db: Session, payload: MealPlanGenerateIn) -> tuple:
    """Общая логика генерации — используется и предпросмотром, и сохранением."""
    city_id = payload.city_id
    if city_id is None:
        city = db.query(City).order_by(City.id).first()
        city_id = city.id if city else None

    candidates = mealplan_service.build_candidates(
        db, city_id, payload.servings, payload.diet
    )
    items = mealplan_service.generate_plan_items(
        candidates,
        payload.days,
        payload.meals_per_day,
        payload.budget,
        payload.kcal_target,
        payload.protein_target,
    )
    summary = mealplan_service.summarize_plan(items, payload.days)
    return city_id, items, summary


@mealplans_router.post('/preview', response_model=MealPlanOut)
def preview_plan(
    payload: MealPlanGenerateIn,
    db: Session = Depends(get_db),
):
    """Предпросмотр плана без сохранения — быстро подобрать меню под бюджет."""
    city_id, items, summary = _generate(db, payload)

    plan = MealPlan(
        user_id=0,
        city_id=city_id,
        title=payload.title or 'Предпросмотр плана',
        days=payload.days,
        budget=payload.budget,
        diet=payload.diet,
        servings=payload.servings,
        kcal_target=payload.kcal_target,
        protein_target=payload.protein_target,
        total_price=summary['total_price'],
    )
    return _serialize_plan(db, plan, items, summary)


@mealplans_router.post('/', response_model=MealPlanOut)
def create_plan(
    payload: MealPlanGenerateIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_required),
):
    """Генерирует и сохраняет план питания (в том числе ПП с целями по КБЖУ)."""
    city_id, items, summary = _generate(db, payload)

    if not items:
        raise HTTPException(
            status_code=400,
            detail='Не удалось собрать план: не хватает рецептов под выбранные условия',
        )

    diet_titles = {
        'any': 'План питания',
        'pp': 'ПП-план',
        'vegetarian': 'Вегетарианский план',
        'high_protein': 'Белковый план',
    }
    plan = MealPlan(
        user_id=current_user.id,
        city_id=city_id,
        title=payload.title
        or f'{diet_titles.get(payload.diet, "План")}: {payload.days} дн. на {int(summary["total_price"])} ₽',
        days=payload.days,
        budget=payload.budget,
        diet=payload.diet,
        servings=payload.servings,
        kcal_target=payload.kcal_target,
        protein_target=payload.protein_target,
        total_price=summary['total_price'],
    )
    db.add(plan)
    db.flush()

    stored: List[dict] = []
    for position, item in enumerate(items):
        row = MealPlanItem(
            plan_id=plan.id,
            recipe_id=item['recipe_id'],
            day_index=item['day_index'],
            meal_type=item['meal_type'],
            servings=payload.servings,
            price=item['price'],
            kcal=item['kcal'],
            protein=item['protein'],
            fat=item['fat'],
            carbs=item['carbs'],
            position=position,
        )
        db.add(row)
        stored.append({**item, 'id': None})

    db.commit()
    db.refresh(plan)

    # Подтягиваем id сохранённых позиций
    stored = [
        {
            'id': row.id,
            'recipe_id': row.recipe_id,
            'day_index': row.day_index,
            'meal_type': row.meal_type,
            'price': row.price,
            'kcal': row.kcal,
            'protein': row.protein,
            'fat': row.fat,
            'carbs': row.carbs,
        }
        for row in sorted(plan.items, key=lambda r: r.position)
    ]

    return _serialize_plan(db, plan, stored, summary)


@mealplans_router.get('/', response_model=List[MealPlanOut])
def my_plans(
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_required),
):
    plans = (
        db.query(MealPlan)
        .filter(MealPlan.user_id == current_user.id)
        .order_by(MealPlan.created_at.desc())
        .limit(limit)
        .all()
    )

    result: List[MealPlanOut] = []
    for plan in plans:
        stored = [
            {
                'id': row.id,
                'recipe_id': row.recipe_id,
                'day_index': row.day_index,
                'meal_type': row.meal_type,
                'price': row.price,
                'kcal': row.kcal,
                'protein': row.protein,
                'fat': row.fat,
                'carbs': row.carbs,
            }
            for row in plan.items
        ]
        summary = mealplan_service.summarize_plan(stored, plan.days)
        result.append(_serialize_plan(db, plan, stored, summary))
    return result


@mealplans_router.get('/{plan_id}', response_model=MealPlanOut)
def get_plan(
    plan_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_required),
):
    plan = db.query(MealPlan).filter(
        MealPlan.id == plan_id, MealPlan.user_id == current_user.id
    ).first()
    if plan is None:
        raise HTTPException(status_code=404, detail='План не найден')

    stored = [
        {
            'id': row.id,
            'recipe_id': row.recipe_id,
            'day_index': row.day_index,
            'meal_type': row.meal_type,
            'price': row.price,
            'kcal': row.kcal,
            'protein': row.protein,
            'fat': row.fat,
            'carbs': row.carbs,
        }
        for row in plan.items
    ]
    summary = mealplan_service.summarize_plan(stored, plan.days)
    return _serialize_plan(db, plan, stored, summary)


@mealplans_router.delete('/{plan_id}')
def delete_plan(
    plan_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_required),
):
    plan = db.query(MealPlan).filter(
        MealPlan.id == plan_id, MealPlan.user_id == current_user.id
    ).first()
    if plan is None:
        raise HTTPException(status_code=404, detail='План не найден')
    db.delete(plan)
    db.commit()
    return {'message': 'План удалён'}
