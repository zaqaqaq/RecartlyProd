"""Челленджи бюджета («Ужин за 300 ₽») и ачивки пользователя."""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_current_user_required
from app.core.database import get_db
from app.models.achievement import Achievement
from app.models.challenge import Challenge, ChallengeEntry
from app.models.recipe import Recipe
from app.models.user import User
from app.services import achievement_service, pricing_service
from app.services.recipe_service import RecipeService

challenges_router = APIRouter(prefix="/challenges", tags=["Челленджи"])
achievements_router = APIRouter(prefix="/achievements", tags=["Ачивки"])


class ChallengeEntryIn(BaseModel):
    recipe_id: int
    basket_id: Optional[int] = None


def _serialize_challenge(db: Session, challenge: Challenge, user: Optional[User]) -> dict:
    entries_count = db.query(ChallengeEntry).filter(
        ChallengeEntry.challenge_id == challenge.id
    ).count()

    my_entry = None
    if user is not None:
        entry = db.query(ChallengeEntry).filter(
            ChallengeEntry.challenge_id == challenge.id,
            ChallengeEntry.user_id == user.id,
        ).first()
        if entry is not None:
            my_entry = {
                'id': entry.id,
                'recipe_id': entry.recipe_id,
                'total_price': entry.total_price,
                'score': entry.score,
            }

    return {
        'id': challenge.id,
        'title': challenge.title,
        'slug': challenge.slug,
        'description': challenge.description,
        'emoji': challenge.emoji,
        'budget': challenge.budget,
        'servings': challenge.servings,
        'city_id': challenge.city_id,
        'is_active': challenge.is_active,
        'starts_at': challenge.starts_at,
        'ends_at': challenge.ends_at,
        'entries_count': entries_count,
        'my_entry': my_entry,
    }


def _score(total_price: float, budget: float, ri_score: Optional[float]) -> float:
    """Баллы: чем дешевле уложился и чем выше Индекс Recartly, тем больше очков."""
    if budget <= 0:
        return 0.0
    economy = max(0.0, (budget - total_price) / budget) * 100
    quality = (ri_score or 50) * 0.4
    return round(economy + quality, 2)


@challenges_router.get('/')
def list_challenges(
    active_only: bool = Query(True),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    """Активные челленджи с числом участников и моей заявкой."""
    query = db.query(Challenge)
    if active_only:
        query = query.filter(Challenge.is_active.is_(True))
    challenges = query.order_by(Challenge.budget).all()
    return [_serialize_challenge(db, challenge, current_user) for challenge in challenges]


@challenges_router.get('/{challenge_id}/leaderboard')
def leaderboard(
    challenge_id: int,
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """Лидерборд челленджа: лучшие по очкам (дешевле и качественнее — выше)."""
    challenge = db.query(Challenge).filter(Challenge.id == challenge_id).first()
    if challenge is None:
        raise HTTPException(status_code=404, detail='Челлендж не найден')

    entries = (
        db.query(ChallengeEntry)
        .filter(ChallengeEntry.challenge_id == challenge_id)
        .order_by(ChallengeEntry.score.desc())
        .limit(limit)
        .all()
    )

    rows = []
    for place, entry in enumerate(entries, start=1):
        user = db.query(User).filter(User.id == entry.user_id).first()
        recipe = db.query(Recipe).filter(Recipe.id == entry.recipe_id).first() if entry.recipe_id else None
        rows.append(
            {
                'place': place,
                'user_id': entry.user_id,
                'username': user.username if user else 'Участник',
                'avatar_url': user.avatar_url if user else None,
                'recipe_id': entry.recipe_id,
                'recipe_title': recipe.title if recipe else None,
                'total_price': entry.total_price,
                'score': entry.score,
            }
        )
    return {'challenge': _serialize_challenge(db, challenge, None), 'rows': rows}


@challenges_router.post('/{challenge_id}/join')
def join_challenge(
    challenge_id: int,
    payload: ChallengeEntryIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_required),
):
    """Участвовать рецептом: считаем смету и баллы, сохраняем заявку."""
    challenge = db.query(Challenge).filter(Challenge.id == challenge_id).first()
    if challenge is None:
        raise HTTPException(status_code=404, detail='Челлендж не найден')

    recipe = db.query(Recipe).filter(Recipe.id == payload.recipe_id).first()
    if recipe is None:
        raise HTTPException(status_code=404, detail='Рецепт не найден')

    if recipe.user_id != current_user.id:
        # Участвовать можно и чужим рецептом — это бюджетный челлендж, а не авторский
        pass

    product_index = pricing_service.build_product_index(db)
    summary = pricing_service.recipe_cost_summary(
        db, recipe, challenge.city_id, product_index=product_index
    )
    total_price = summary['best_total'] or RecipeService.calculate_total_price(recipe)
    score = _score(total_price, challenge.budget, recipe.ri_score)

    entry = db.query(ChallengeEntry).filter(
        ChallengeEntry.challenge_id == challenge.id,
        ChallengeEntry.user_id == current_user.id,
    ).first()

    if entry is None:
        entry = ChallengeEntry(
            challenge_id=challenge.id,
            user_id=current_user.id,
            recipe_id=recipe.id,
            basket_id=payload.basket_id,
            total_price=total_price,
            score=score,
        )
        db.add(entry)
    else:
        entry.recipe_id = recipe.id
        entry.basket_id = payload.basket_id
        entry.total_price = total_price
        entry.score = score

    db.commit()
    db.refresh(entry)

    # Ачивка за участие
    achievement_service.check_achievements(db, current_user)

    fits = total_price <= challenge.budget
    return {
        'id': entry.id,
        'challenge_id': challenge.id,
        'recipe_id': entry.recipe_id,
        'total_price': round(entry.total_price, 2),
        'budget': challenge.budget,
        'fits_budget': fits,
        'score': entry.score,
        'message': (
            'Уложились в бюджет!' if fits else f'Перебор {round(total_price - challenge.budget, 2)} ₽'
        ),
    }


@achievements_router.get('/')
def my_achievements(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_required),
):
    """Мои ачивки, баллы и уровень."""
    rows = (
        db.query(Achievement)
        .filter(Achievement.user_id == current_user.id)
        .order_by(Achievement.earned_at.desc())
        .all()
    )
    return {
        'level': achievement_service.user_level(current_user.points),
        'earned': [
            {
                'type': row.type,
                'name': row.name,
                'description': row.description,
                'icon': row.icon,
                'earned_at': row.earned_at,
            }
            for row in rows
        ],
        'total': len(achievement_service.catalog()),
    }


@achievements_router.get('/catalog')
def achievements_catalog():
    """Каталог всех ачивок: что можно получить и за что."""
    return achievement_service.catalog()


@achievements_router.post('/check')
def check_my_achievements(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_required),
):
    """Пересчитывает прогресс и выдаёт новые ачивки (в том числе баллы и уровень)."""
    new_rows: List[Achievement] = achievement_service.check_achievements(db, current_user)
    return {
        'new': [
            {
                'type': row.type,
                'name': row.name,
                'description': row.description,
                'icon': row.icon,
            }
            for row in new_rows
        ],
        'level': achievement_service.user_level(current_user.points),
    }
