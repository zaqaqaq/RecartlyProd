from pydantic import BaseModel
from datetime import datetime
from typing import Optional

class CommentBase(BaseModel):
    text: str

class CommentCreate(CommentBase):
    # Если передан — это ответ на комментарий с указанным id (уведомляем его автора)
    parent_id: Optional[int] = None

class CommentResponse(CommentBase):
    id: int
    user_id: int
    recipe_id: int
    parent_id: Optional[int] = None
    created_at: datetime
    username: Optional[str] = None

    class Config:
        from_attributes = True