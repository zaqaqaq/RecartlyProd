from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List

class ReviewBase(BaseModel):
    title: str
    content: str
    rating: Optional[float] = None
    target_type: str  # 'recipe', 'cart', 'shop'
    target_id: Optional[int] = None
    shop_name: Optional[str] = None

class ReviewCreate(ReviewBase):
    pass

class ReviewResponse(ReviewBase):
    id: int
    user_id: int
    created_at: datetime
    updated_at: Optional[datetime] = None
    username: Optional[str] = None
    avatar_url: Optional[str] = None
    likes_count: int = 0
    comments_count: int = 0
    is_liked: bool = False

    class Config:
        from_attributes = True

class ReviewLikeResponse(BaseModel):
    id: int
    user_id: int
    review_id: int

class ReviewCommentBase(BaseModel):
    text: str

class ReviewCommentCreate(ReviewCommentBase):
    pass

class ReviewCommentResponse(ReviewCommentBase):
    id: int
    user_id: int
    review_id: int
    created_at: datetime
    username: Optional[str] = None
    avatar_url: Optional[str] = None

    class Config:
        from_attributes = True