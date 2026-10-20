from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.core.database import get_db
from app.api.deps import get_current_user_required
from app.models.user import User
from app.models.recipe import Recipe
from app.models.favorite import Favorite
from app.models.comment import Comment
from app.schemas.recipe import RecipeResponse
from app.services.recipe_service import RecipeService

router = APIRouter(prefix="/favorites", tags=["Избранное"])


@router.post("/{recipe_id}")
def add_favorite(
        recipe_id: int,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user_required)
):
    """Добавить рецепт в избранное"""
    recipe = db.query(Recipe).filter(Recipe.id == recipe_id).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Рецепт не найден")

    existing = db.query(Favorite).filter(
        Favorite.user_id == current_user.id,
        Favorite.recipe_id == recipe_id
    ).first()

    if existing:
        raise HTTPException(status_code=400, detail="Рецепт уже в избранном")

    favorite = Favorite(user_id=current_user.id, recipe_id=recipe_id)
    db.add(favorite)
    db.commit()

    return {"message": "Рецепт добавлен в избранное"}


@router.delete("/{recipe_id}")
def remove_favorite(
        recipe_id: int,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user_required)
):
    """Удалить рецепт из избранного"""
    favorite = db.query(Favorite).filter(
        Favorite.user_id == current_user.id,
        Favorite.recipe_id == recipe_id
    ).first()

    if not favorite:
        raise HTTPException(status_code=404, detail="Рецепт не в избранном")

    db.delete(favorite)
    db.commit()

    return {"message": "Рецепт удалён из избранного"}


@router.get("/", response_model=List[RecipeResponse])
def get_favorites(
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user_required)
):
    """Получить все избранные рецепты"""
    favorites = db.query(Favorite).filter(Favorite.user_id == current_user.id).all()

    result = []
    for fav in favorites:
        recipe = fav.recipe
        response = RecipeResponse.model_validate(recipe)
        response.total_price = RecipeService.calculate_total_price(recipe)
        # Для избранного не показываем количество избранных, показываем только комментарии
        response.favorites_count = 0  # Убираем отображение
        response.comments_count = db.query(Comment).filter(Comment.recipe_id == recipe.id).count()

        user = db.query(User).filter(User.id == recipe.user_id).first()
        response.username = user.username if user else "Пользователь"
        response.avatar_url = user.avatar_url if user else None
        response.time_ago = "недавно"
        response.is_favorited = True
        result.append(response)

    return result