"""Ачивки и баллы: награда за полезные действия, а не за «хайп».

Правила простые и проверяемые: считаем факты из БД и выдаём недостающие ачивки.
Баллы копятся, уровень растёт каждые 100 баллов.
"""

from __future__ import annotations

import logging
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from app.models.achievement import Achievement
from app.models.basket import Basket, PurchaseClick
from app.models.challenge import ChallengeEntry
from app.models.mealplan import MealPlan
from app.models.price import PriceQuote
from app.models.reaction import Reaction
from app.models.recipe import Recipe
from app.models.user import User
from app.services.notification_service import notify_achievement

logger = logging.getLogger(__name__)

# Код → (название, описание, эмодзи, баллы)
ACHIEVEMENTS: Dict[str, tuple] = {
    'first_recipe': ('Первая публикация', 'Опубликован первый рецепт', '🥇', 10),
    'five_recipes': ('Повар', 'Опубликовано 5 рецептов', '👨‍🍳', 30),
    'ten_recipes': ('Гуру рецептов', 'Опубликовано 10 рецептов', '🏆', 80),
    'first_reaction': ('Дегустатор', 'Первая балльная оценка рецепта', '⭐', 5),
    'cooked_five': ('Практик', 'Отмечено «приготовил» 5 раз', '🍳', 25),
    'budget_master': ('Сметчик', 'Собрано 3 сметы покупок', '🧾', 20),
    'frugal': ('Экономный', 'Рецепт дешевле 100 ₽ за порцию', '💸', 15),
    'price_hunter': ('Охотник за ценами', 'Добавлено 5 цен в справочник', '📸', 40),
    'challenger': ('Участник челленджа', 'Участие в челлендже бюджета', '🎯', 20),
    'meal_planner': ('Планировщик', 'Собран план питания на неделю', '🗓', 25),
    'partner': ('Помощник', 'Переход в магазин по смете', '🛒', 5),
}


def _points_for(code: str) -> Optional[int]:
    """Сколько баллов даёт ачивка (для текста уведомления)."""
    rule = ACHIEVEMENTS.get(code)
    return int(rule[3]) if rule else None


def _earned_codes(db: Session, user: User) -> set:
    rows = db.query(Achievement).filter(Achievement.user_id == user.id).all()
    return {row.type for row in rows}


def _facts(db: Session, user: User) -> dict:
    """Считает факты, на которых основаны правила."""
    recipes_count = db.query(Recipe).filter(Recipe.user_id == user.id).count()
    reactions_count = db.query(Reaction).filter(Reaction.user_id == user.id).count()
    cooked_count = db.query(Reaction).filter(
        Reaction.user_id == user.id, Reaction.cooked.is_(True)
    ).count()
    baskets_count = db.query(Basket).filter(Basket.user_id == user.id).count()
    plans_count = db.query(MealPlan).filter(MealPlan.user_id == user.id).count()
    challenges_count = db.query(ChallengeEntry).filter(ChallengeEntry.user_id == user.id).count()
    clicks_count = db.query(PurchaseClick).filter(PurchaseClick.user_id == user.id).count()
    confirmed_prices = db.query(PriceQuote).filter(
        PriceQuote.reported_by == user.id,
        PriceQuote.status == 'confirmed',
    ).count()

    # Есть ли рецепт дешевле 100 ₽ за порцию (по посчитанной смете)
    cheap_recipe = (
        db.query(Recipe)
        .filter(Recipe.user_id == user.id)
        .all()
    )
    frugal = False
    for recipe in cheap_recipe:
        total = sum(float(ing.price or 0) for ing in recipe.ingredients)
        if total and recipe.servings and total / max(1, recipe.servings) < 100:
            frugal = True
            break

    return {
        'recipes': recipes_count,
        'reactions': reactions_count,
        'cooked': cooked_count,
        'baskets': baskets_count,
        'plans': plans_count,
        'challenges': challenges_count,
        'clicks': clicks_count,
        'confirmed_prices': confirmed_prices,
        'frugal': frugal,
    }


def _is_earned(code: str, facts: dict) -> bool:
    rules = {
        'first_recipe': facts['recipes'] >= 1,
        'five_recipes': facts['recipes'] >= 5,
        'ten_recipes': facts['recipes'] >= 10,
        'first_reaction': facts['reactions'] >= 1,
        'cooked_five': facts['cooked'] >= 5,
        'budget_master': facts['baskets'] >= 3,
        'frugal': facts['frugal'],
        'price_hunter': facts['confirmed_prices'] >= 5,
        'challenger': facts['challenges'] >= 1,
        'meal_planner': facts['plans'] >= 1,
        'partner': facts['clicks'] >= 1,
    }
    return bool(rules.get(code))


def check_achievements(db: Session, user: User) -> List[Achievement]:
    """Выдаёт все заслуженные, но ещё не выданные ачивки. Возвращает новые."""
    earned = _earned_codes(db, user)
    facts = _facts(db, user)

    new_achievements: List[Achievement] = []
    gained_points = 0

    for code, (name, description, icon, points) in ACHIEVEMENTS.items():
        if code in earned:
            continue
        if not _is_earned(code, facts):
            continue

        achievement = Achievement(
            user_id=user.id,
            type=code,
            name=name,
            description=description,
            icon=icon,
        )
        db.add(achievement)
        new_achievements.append(achievement)
        gained_points += points

    if gained_points:
        user.points = int(user.points or 0) + gained_points
        user.level = 1 + user.points // 100
        # За достижения немного растёт доверие: меньше поводов держать на модерации
        user.trust_score = min(100.0, float(user.trust_score or 50) + len(new_achievements))

    if new_achievements or gained_points:
        db.commit()
        for achievement in new_achievements:
            db.refresh(achievement)

    # По каждой новой ачивке — уведомление. Ачивки уже сохранены, поэтому сбой
    # уведомления только логируем: награда важнее письма о награде.
    for achievement in new_achievements:
        try:
            notify_achievement(
                db,
                user.id,
                name=achievement.name,
                description=achievement.description,
                icon=achievement.icon,
                code=achievement.type,
                points=_points_for(achievement.type),
            )
            db.commit()
        except Exception as e:  # noqa: BLE001 — уведомление не должно ломать выдачу ачивок
            db.rollback()
            logger.exception("Не удалось создать уведомление о достижении: %s", e)

    return new_achievements


def catalog() -> List[dict]:
    """Полный список ачивок с описанием — для экрана «что можно получить»."""
    return [
        {
            'code': code,
            'name': name,
            'description': description,
            'icon': icon,
            'points': points,
        }
        for code, (name, description, icon, points) in ACHIEVEMENTS.items()
    ]


def user_level(points: Optional[int]) -> dict:
    points = int(points or 0)
    level = 1 + points // 100
    return {
        'points': points,
        'level': level,
        'next_level_points': level * 100,
        'progress': (points % 100) / 100,
    }
