from sqlalchemy import Column, Integer, String, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base

class Achievement(Base):
    __tablename__ = "achievements"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    type = Column(String, nullable=False)  # recipe_master, hot_author, etc.
    name = Column(String, nullable=False)  # "Гуру рецептов"
    description = Column(String, nullable=True)  # "Опубликовал 10+ рецептов"
    icon = Column(String, nullable=True)  # эмодзи или URL иконки
    earned_at = Column(DateTime(timezone=True), server_default=func.now())

    # Связи
    user = relationship("User", back_populates="achievements")