from pydantic import BaseModel
from datetime import datetime
from typing import Optional

class AchievementResponse(BaseModel):
    id: int
    type: str
    name: str
    description: Optional[str] = None
    icon: Optional[str] = None
    earned_at: datetime

    class Config:
        from_attributes = True