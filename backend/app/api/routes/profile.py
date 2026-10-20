from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from typing import List
import os
import uuid
import shutil
from app.core.database import get_db
from app.api.deps import get_current_user_required
from app.models.user import User
from app.models.geo import City
from app.models.recipe import Recipe
from app.models.comment import Comment
from app.models.favorite import Favorite
from app.schemas.user import UserResponse, UserUpdate
from app.schemas.achievement import AchievementResponse
from app.core.security import verify_password, get_password_hash

router = APIRouter(prefix="/profile", tags=["Профиль"])

# Создаём папку для аватарок
AVATAR_DIR = "uploads/avatars"
os.makedirs(AVATAR_DIR, exist_ok=True)


def _build_profile_response(user: User, db: Session) -> UserResponse:
    """Профиль + счётчики. Роль и trust_score берутся из ORM автоматически."""
    response = UserResponse.model_validate(user)
    response.recipes_count = db.query(Recipe).filter(Recipe.user_id == user.id).count()
    response.comments_count = db.query(Comment).filter(Comment.user_id == user.id).count()

    favorites_received = 0
    for recipe in user.recipes:
        favorites_received += db.query(Favorite).filter(Favorite.recipe_id == recipe.id).count()
    response.likes_received = favorites_received

    return response


@router.get("/me", response_model=UserResponse)
def get_my_profile(
        current_user: User = Depends(get_current_user_required),
        db: Session = Depends(get_db)
):
    """Получить свой профиль: id, username, city_id, city, role, trust_score и счётчики."""
    return _build_profile_response(current_user, db)


def _apply_profile_updates(
        profile_data: UserUpdate,
        current_user: User,
        db: Session
) -> None:
    """Общая логика обновления профиля для PUT и PATCH.

    Город приходит либо как `city_id` (справочник `cities`), либо как строка
    `city` — во втором случае пытаемся найти город по названию и проставить id.
    """
    provided = profile_data.model_fields_set

    # Город валидируем до изменений, чтобы 404 не оставлял частичный апдейт.
    if "city_id" in provided and profile_data.city_id is not None:
        city = db.query(City).filter(City.id == profile_data.city_id).first()
        if not city:
            raise HTTPException(
                status_code=404,
                detail="Город не найден. Выберите город из списка доступных."
            )
    else:
        city = None

    if profile_data.username is not None:
        current_user.username = profile_data.username
    if profile_data.avatar_url is not None:
        current_user.avatar_url = profile_data.avatar_url
    if profile_data.bio is not None:
        current_user.bio = profile_data.bio
    if profile_data.website is not None:
        current_user.website = profile_data.website

    if "city_id" in provided:
        if profile_data.city_id is None:
            # Явный null — очищаем и связь, и строку.
            current_user.city_id = None
            current_user.city = None
        else:
            current_user.city_id = city.id
            # Дублируем название строкой: её читают старые места приложения.
            current_user.city = city.name
    elif profile_data.city is not None:
        current_user.city = profile_data.city
        # Сравниваем в Python: городов мало, а ilike трактует % и _ как маски.
        city_name = profile_data.city.strip().lower()
        matched_city = next(
            (item for item in db.query(City).all() if (item.name or '').strip().lower() == city_name),
            None
        )
        if matched_city:
            current_user.city_id = matched_city.id


@router.put("/me", response_model=UserResponse)
@router.patch("/me", response_model=UserResponse)
def update_my_profile(
        profile_data: UserUpdate,
        current_user: User = Depends(get_current_user_required),
        db: Session = Depends(get_db)
):
    """Обновить профиль (PUT или PATCH). `city_id` проверяется по справочнику городов."""
    _apply_profile_updates(profile_data, current_user, db)

    db.commit()
    db.refresh(current_user)

    return _build_profile_response(current_user, db)


@router.post("/upload-avatar")
async def upload_avatar(
        file: UploadFile = File(...),
        current_user: User = Depends(get_current_user_required),
        db: Session = Depends(get_db)
):
    """Загрузка аватарки пользователя"""
    if not file.content_type.startswith('image/'):
        raise HTTPException(status_code=400, detail="Можно загружать только изображения")

    file.file.seek(0, 2)
    size = file.file.tell()
    file.file.seek(0)
    if size > 2 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Файл не должен превышать 2MB")

    file_extension = file.filename.split(".")[-1] if "." in file.filename else "jpg"
    new_filename = f"avatar_{current_user.id}_{uuid.uuid4().hex[:8]}.{file_extension}"
    file_path = os.path.join(AVATAR_DIR, new_filename)

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    avatar_url = f"/uploads/avatars/{new_filename}"
    current_user.avatar_url = avatar_url
    db.commit()

    return {"avatar_url": avatar_url}


@router.get("/me/achievements", response_model=List[AchievementResponse])
def get_my_achievements(
        current_user: User = Depends(get_current_user_required),
        db: Session = Depends(get_db)
):
    """Получить достижения пользователя"""
    return current_user.achievements


@router.get("/{user_id}", response_model=UserResponse)
def get_user_profile(
        user_id: int,
        db: Session = Depends(get_db)
):
    """Получить профиль другого пользователя"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    return _build_profile_response(user, db)


@router.post("/change-password")
def change_password(
        password_data: dict,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user_required)
):
    """Смена пароля"""
    old_password = password_data.get("old_password")
    new_password = password_data.get("new_password")

    if not old_password or not new_password:
        raise HTTPException(status_code=400, detail="Все поля обязательны")

    if not verify_password(old_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Неверный текущий пароль")

    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="Новый пароль должен содержать минимум 6 символов")

    current_user.hashed_password = get_password_hash(new_password)
    db.commit()

    return {"message": "Пароль успешно изменён"}