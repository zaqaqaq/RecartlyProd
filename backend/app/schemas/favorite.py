from pydantic import BaseModel
from datetime import datetime

class FavoriteResponse(BaseModel):
    id: int
    recipe_id: int
    created_at: datetime

    class Config:
        from_attributes = True