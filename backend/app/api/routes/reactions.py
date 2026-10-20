"""Балльные реакции на рецепт, фото «я приготовил» и Индекс Recartly.

Регистрация роутера — в `app.api.routes.__init__` (её делает отдельный исполнитель).
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_current_user_required
from app.core.database import get_db
from app.models.reaction import CookedPhoto, Reaction
from app.models.recipe import Recipe
from app.models.user import User
from app.schemas.reaction import ReactionIn, ReactionOut, RecipeReactionsOut, RiOut
from app.services.notification_service import notify_reaction
from app.services.reaction_service import compute_recipe_ri, recalculate_recipe_ri

logger = logging.getLogger(__name__)

reactions_router = APIRouter(tags=["Реакции"])

# Директория для загрузки фото (та же, что в recipes.py)
UPLOAD_DIR = 'uploads'
os.makedirs(UPLOAD_DIR, exist_ok=True)

AXES = ('taste', 'value', 'simplicity')


def _get_recipe_or_404(db: Session, recipe_id: int) -> Recipe:
    recipe = db.query(Recipe).filter(Recipe.id == recipe_id).first()
    if recipe is None:
        raise HTTPException(status_code=404, detail='Рецепт не найден')
    return recipe


def _get_my_reaction(db: Session, recipe_id: int, user_id: int) -> Optional[Reaction]:
    return (
        db.query(Reaction)
        .filter(Reaction.recipe_id == recipe_id, Reaction.user_id == user_id)
        .first()
    )


@reactions_router.post('/recipes/{recipe_id}/reactions', response_model=RiOut)
def upsert_reaction(
    recipe_id: int,
    payload: ReactionIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_required),
):
    """Поставить или обновить свою оценку (upsert по паре рецепт + пользователь).

    Частичное обновление: меняются только переданные оси, `cooked=true` помечает
    рецепт как реально приготовленный. В ответе — пересчитанный Индекс Recartly.

    Автор рецепта получает уведомление только о первой оценке от этого
    пользователя — переоценка своей же реакции его не беспокоит.
    """
    recipe = _get_recipe_or_404(db, recipe_id)

    reaction = _get_my_reaction(db, recipe_id, current_user.id)
    is_new_reaction = reaction is None
    data = payload.model_dump(exclude_unset=True)

    has_rating = any(data.get(axis) is not None for axis in AXES)
    has_mark = bool(data.get('cooked'))

    if reaction is None:
        if not has_rating and not has_mark:
            raise HTTPException(
                status_code=400,
                detail='Нужна хотя бы одна оценка или отметка «я приготовил(а)»',
            )
        reaction = Reaction(recipe_id=recipe_id, user_id=current_user.id, cooked=False)
        db.add(reaction)

    for axis in AXES:
        if axis in data:
            setattr(reaction, axis, data[axis])
    if 'cooked' in data:
        reaction.cooked = bool(data['cooked'])

    db.flush()
    result = recalculate_recipe_ri(db, recipe)

    # Уведомление автору рецепта — только для новой реакции. Реакция и агрегаты
    # уже сохранены, поэтому сбой уведомления не должен ломать ответ.
    if is_new_reaction:
        try:
            notify_reaction(db, recipe, reaction, current_user)
            db.commit()
        except Exception as e:
            db.rollback()
            logger.exception("Не удалось создать уведомление о реакции: %s", e)

    return result


@reactions_router.delete('/recipes/{recipe_id}/reactions', response_model=RiOut)
def delete_reaction(
    recipe_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_required),
):
    """Удалить свою оценку и пересчитать агрегаты рецепта (идемпотентно)."""
    recipe = _get_recipe_or_404(db, recipe_id)

    reaction = _get_my_reaction(db, recipe_id, current_user.id)
    if reaction is not None:
        db.delete(reaction)
        db.flush()

    return recalculate_recipe_ri(db, recipe)


@reactions_router.get('/recipes/{recipe_id}/reactions', response_model=RecipeReactionsOut)
def get_reactions(
    recipe_id: int,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    """Публичные агрегаты рецепта + моя реакция, если я авторизован. Без записи в БД."""
    recipe = _get_recipe_or_404(db, recipe_id)

    ri = compute_recipe_ri(db, recipe)

    my = None
    if current_user is not None:
        mine = _get_my_reaction(db, recipe_id, current_user.id)
        if mine is not None:
            my = ReactionOut.model_validate(mine)

    return {'ri': ri, 'my': my}


@reactions_router.post('/recipes/{recipe_id}/cooked-photo')
async def upload_cooked_photo(
    recipe_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_required),
):
    """Фото «что получилось» — доказательство, что рецепт приготовили.

    Файл кладём в `uploads/` под uuid-именем, запись создаём со статусом `pending`
    (модерация — на стороне админки).
    """
    _get_recipe_or_404(db, recipe_id)

    original_name = file.filename or ''
    raw_extension = original_name.rsplit('.', 1)[-1] if '.' in original_name else 'jpg'
    extension = re.sub(r'[^a-zA-Z0-9]', '', raw_extension)[:8] or 'jpg'

    new_filename = f'{uuid.uuid4()}.{extension}'
    file_path = os.path.join(UPLOAD_DIR, new_filename)

    with open(file_path, 'wb') as buffer:
        shutil.copyfileobj(file.file, buffer)

    photo = CookedPhoto(
        recipe_id=recipe_id,
        user_id=current_user.id,
        photo_url=f'/uploads/{new_filename}',
        status='pending',
    )
    db.add(photo)
    db.commit()
    db.refresh(photo)

    return {'photo_url': photo.photo_url, 'status': photo.status, 'id': photo.id}
