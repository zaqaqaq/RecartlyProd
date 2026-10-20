from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime
import logging
from app.core.database import get_db
from app.api.deps import get_current_user_required, get_current_user
from app.models.user import User
from app.models.recipe import Recipe
from app.models.comment import Comment
from app.schemas.comment import CommentCreate, CommentResponse
from app.services.notification_service import notify_comment, notify_reply

router = APIRouter(prefix="/comments", tags=["Комментарии"])

logger = logging.getLogger(__name__)


def get_time_ago(dt):
    """Возвращает строку 'X минут/часов/дней назад'"""
    if dt.tzinfo is not None:
        dt = dt.replace(tzinfo=None)

    now = datetime.utcnow()
    diff = now - dt

    if diff.days > 365:
        return f"{diff.days // 365} г. назад"
    if diff.days > 30:
        return f"{diff.days // 30} мес. назад"
    if diff.days > 0:
        if diff.days == 1:
            return "вчера"
        return f"{diff.days} дн. назад"
    if diff.seconds // 3600 > 0:
        hours = diff.seconds // 3600
        return f"{hours} ч. назад"
    if diff.seconds // 60 > 0:
        minutes = diff.seconds // 60
        return f"{minutes} мин. назад"
    return "только что"


@router.get("/latest")
def get_latest_comments(
        limit: int = 10,
        db: Session = Depends(get_db)
):
    """Получение последних комментариев (доступно без авторизации)"""
    try:
        comments = db.query(Comment).order_by(Comment.created_at.desc()).limit(limit).all()

        result = []
        for comment in comments:
            user = db.query(User).filter(User.id == comment.user_id).first()
            result.append({
                "id": comment.id,
                "text": comment.text,
                "username": user.username if user else "Пользователь",
                "avatar_url": user.avatar_url if user else None,
                "user_id": comment.user_id,
                "created_at": comment.created_at.isoformat() if comment.created_at else None,
                "time_ago": get_time_ago(comment.created_at) if comment.created_at else "недавно"
            })

        return result
    except Exception as e:
        print(f"Error in get_latest_comments: {e}")
        return []


def _can_discuss(recipe: Recipe, user: User) -> bool:
    """Можно ли обсуждать рецепт: опубликованный — всем, остальное — автору и модерации.

    Комментарии к рецепту на модерации (`pending`), отклонённому (`rejected`) или
    черновику закрыты: иначе обсуждение «утекает» до публикации.
    """
    if (recipe.status or 'published') == 'published':
        return True
    if recipe.user_id == user.id:
        return True
    return user.role in ('moderator', 'admin')


@router.post("/{recipe_id}")
def create_comment(
        recipe_id: int,
        comment_data: CommentCreate,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user_required)
):
    """Добавить комментарий к рецепту (требует авторизации).

    Если передан `parent_id` — это ответ на комментарий: уведомляем его автора.
    Уведомления отправляются после сохранения комментария и не могут его сломать.
    """
    recipe = db.query(Recipe).filter(Recipe.id == recipe_id).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Рецепт не найден")

    if not _can_discuss(recipe, current_user):
        raise HTTPException(status_code=403, detail="Рецепт ещё не опубликован, обсуждение недоступно")

    parent_comment = None
    if comment_data.parent_id is not None:
        parent_comment = db.query(Comment).filter(
            Comment.id == comment_data.parent_id,
            Comment.recipe_id == recipe_id
        ).first()
        if parent_comment is None:
            raise HTTPException(status_code=404, detail="Комментарий, на который вы отвечаете, не найден")

    new_comment = Comment(
        text=comment_data.text,
        user_id=current_user.id,
        recipe_id=recipe_id,
        parent_id=parent_comment.id if parent_comment else None
    )
    db.add(new_comment)
    db.commit()
    db.refresh(new_comment)

    # Автору рецепта — о новом комментарии. Комментарий уже сохранён, поэтому
    # любой сбой уведомления только логируем (и откатываем его транзакцию).
    try:
        notify_comment(db, recipe, new_comment, current_user)
        db.commit()
    except Exception as e:
        db.rollback()
        logger.exception("Не удалось создать уведомление о комментарии: %s", e)

    # Автору родительского комментария — об ответе (если это не тот же человек,
    # что автор рецепта: он уже получил уведомление выше).
    if parent_comment is not None and parent_comment.user_id != recipe.user_id:
        try:
            notify_reply(db, parent_comment, new_comment, current_user, recipe=recipe)
            db.commit()
        except Exception as e:
            db.rollback()
            logger.exception("Не удалось создать уведомление об ответе: %s", e)

    return {
        "id": new_comment.id,
        "text": new_comment.text,
        "user_id": new_comment.user_id,
        "recipe_id": new_comment.recipe_id,
        "parent_id": new_comment.parent_id,
        "created_at": new_comment.created_at,
        "username": current_user.username,
        "avatar_url": current_user.avatar_url
    }


@router.get("/{recipe_id}")
def get_comments(
        recipe_id: int,
        skip: int = 0,
        limit: int = 50,
        db: Session = Depends(get_db)
):
    """Получить все комментарии к рецепту (доступно без авторизации)"""
    comments = db.query(Comment).filter(Comment.recipe_id == recipe_id) \
        .order_by(Comment.created_at.desc()).offset(skip).limit(limit).all()

    result = []
    for comment in comments:
        user = db.query(User).filter(User.id == comment.user_id).first()
        result.append({
            "id": comment.id,
            "text": comment.text,
            "user_id": comment.user_id,
            "recipe_id": comment.recipe_id,
            "parent_id": comment.parent_id,
            "created_at": comment.created_at,
            "username": user.username if user else None,
            "avatar_url": user.avatar_url if user else None
        })

    return result


@router.delete("/{comment_id}")
def delete_comment(
        comment_id: int,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user_required)
):
    """Удалить комментарий (требует авторизации)"""
    comment = db.query(Comment).filter(Comment.id == comment_id).first()
    if not comment:
        raise HTTPException(status_code=404, detail="Комментарий не найден")

    if comment.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Нет прав на удаление")

    db.delete(comment)
    db.commit()

    return {"message": "Комментарий удалён"}