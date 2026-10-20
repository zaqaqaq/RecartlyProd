from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    username = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    avatar_url = Column(String, nullable=True)
    bio = Column(String, nullable=True)
    city = Column(String, nullable=True)
    website = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # ---------- Роли и доверие (модерация) ----------
    # user | verified_author | moderator | admin
    role = Column(String, nullable=False, default='user', server_default='user', index=True)
    # 0..100: растёт за одобренный контент, падает за нарушения.
    # От доверия зависит, уходит публикация на модерацию или выходит сразу.
    trust_score = Column(Float, nullable=False, default=50, server_default='50')
    city_id = Column(Integer, ForeignKey('cities.id', ondelete='SET NULL'), nullable=True)

    is_banned = Column(Boolean, nullable=False, default=False, server_default='false')
    muted_until = Column(DateTime(timezone=True), nullable=True)

    # ---------- Геймификация ----------
    points = Column(Integer, nullable=False, default=0, server_default='0')
    level = Column(Integer, nullable=False, default=1, server_default='1')

    # Связи
    recipes = relationship("Recipe", back_populates="user", foreign_keys="Recipe.user_id", cascade="all, delete-orphan")
    comments = relationship("Comment", back_populates="user", cascade="all, delete-orphan")
    favorites = relationship("Favorite", back_populates="user", cascade="all, delete-orphan")
    achievements = relationship("Achievement", back_populates="user", cascade="all, delete-orphan")
    # Корзины сообщества удалены — их заменили наборы (baskets)
    reviews = relationship("Review", back_populates="user", cascade="all, delete-orphan")
    review_likes = relationship("ReviewLike", back_populates="user", cascade="all, delete-orphan")
    review_comments = relationship("ReviewComment", back_populates="user", cascade="all, delete-orphan")

    @property
    def is_moderator(self) -> bool:
        return self.role in ('moderator', 'admin')

    @property
    def is_admin(self) -> bool:
        return self.role == 'admin'
