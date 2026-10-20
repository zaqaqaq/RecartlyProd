from sqlalchemy import Column, Integer, String, Float, ForeignKey
from sqlalchemy.orm import relationship
from app.core.database import Base

class Ingredient(Base):
    __tablename__ = "ingredients"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    quantity = Column(String, nullable=False)
    price = Column(Float, nullable=True)
    # Фото продукта: что именно куплено (необязательно)
    photo_url = Column(String, nullable=True)
    position = Column(Integer, nullable=False, default=0, server_default='0')
    recipe_id = Column(Integer, ForeignKey("recipes.id"), nullable=False)

    # Связи
    recipe = relationship("Recipe", back_populates="ingredients")