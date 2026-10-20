from pydantic import BaseModel, EmailStr
from datetime import datetime
from typing import Optional

class UserBase(BaseModel):
    email: EmailStr
    username: str

class UserCreate(UserBase):
    password: str

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserUpdate(BaseModel):
    username: Optional[str] = None
    avatar_url: Optional[str] = None
    bio: Optional[str] = None
    city: Optional[str] = None
    # Основной источник города — справочник `cities`; строковое `city` остаётся
    # для совместимости и подтягивается автоматически по названию.
    city_id: Optional[int] = None
    website: Optional[str] = None

class UserResponse(UserBase):
    id: int
    avatar_url: Optional[str] = None
    bio: Optional[str] = None
    city: Optional[str] = None
    city_id: Optional[int] = None
    website: Optional[str] = None
    created_at: datetime
    recipes_count: int = 0
    comments_count: int = 0
    likes_received: int = 0
    # user | verified_author | moderator | admin — нужно фронтенду для меню модерации
    role: Optional[str] = None
    trust_score: Optional[float] = None

    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    email: Optional[str] = None