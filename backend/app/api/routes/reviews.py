from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from app.core.database import get_db
from app.api.deps import get_current_user, get_current_user_required
from app.models.user import User
from app.models.review import Review, ReviewLike, ReviewComment
from app.schemas.review import ReviewCreate, ReviewResponse, ReviewCommentCreate, ReviewCommentResponse

router = APIRouter(prefix="/reviews", tags=["Отзывы"])


@router.post("/", response_model=ReviewResponse)
def create_review(
        review_data: ReviewCreate,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user_required)
):
    """Создание отзыва"""
    new_review = Review(
        user_id=current_user.id,
        title=review_data.title,
        content=review_data.content,
        rating=review_data.rating,
        target_type=review_data.target_type,
        target_id=review_data.target_id,
        shop_name=review_data.shop_name
    )
    db.add(new_review)
    db.commit()
    db.refresh(new_review)

    response = ReviewResponse.model_validate(new_review)
    response.username = current_user.username
    response.avatar_url = current_user.avatar_url

    return response


@router.get("/", response_model=List[ReviewResponse])
def get_reviews(
        skip: int = 0,
        limit: int = 20,
        target_type: Optional[str] = None,
        db: Session = Depends(get_db),
        current_user: Optional[User] = Depends(get_current_user)
):
    """Получение списка отзывов"""
    query = db.query(Review).order_by(Review.created_at.desc())

    if target_type:
        query = query.filter(Review.target_type == target_type)

    reviews = query.offset(skip).limit(limit).all()

    result = []
    for review in reviews:
        user = db.query(User).filter(User.id == review.user_id).first()
        response = ReviewResponse.model_validate(review)
        response.username = user.username if user else "Пользователь"
        response.avatar_url = user.avatar_url if user else None
        response.likes_count = db.query(ReviewLike).filter(ReviewLike.review_id == review.id).count()
        response.comments_count = db.query(ReviewComment).filter(ReviewComment.review_id == review.id).count()
        if current_user:
            is_liked = db.query(ReviewLike).filter(
                ReviewLike.review_id == review.id,
                ReviewLike.user_id == current_user.id
            ).first() is not None
            response.is_liked = is_liked
        result.append(response)

    return result


@router.get("/{review_id}", response_model=ReviewResponse)
def get_review(
        review_id: int,
        db: Session = Depends(get_db),
        current_user: Optional[User] = Depends(get_current_user)
):
    """Получение отзыва по ID"""
    review = db.query(Review).filter(Review.id == review_id).first()
    if not review:
        raise HTTPException(status_code=404, detail="Отзыв не найден")

    user = db.query(User).filter(User.id == review.user_id).first()
    response = ReviewResponse.model_validate(review)
    response.username = user.username if user else "Пользователь"
    response.avatar_url = user.avatar_url if user else None
    response.likes_count = db.query(ReviewLike).filter(ReviewLike.review_id == review.id).count()
    response.comments_count = db.query(ReviewComment).filter(ReviewComment.review_id == review.id).count()
    if current_user:
        is_liked = db.query(ReviewLike).filter(
            ReviewLike.review_id == review.id,
            ReviewLike.user_id == current_user.id
        ).first() is not None
        response.is_liked = is_liked

    return response


@router.delete("/{review_id}")
def delete_review(
        review_id: int,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user_required)
):
    """Удаление отзыва (только автор)"""
    review = db.query(Review).filter(Review.id == review_id, Review.user_id == current_user.id).first()
    if not review:
        raise HTTPException(status_code=404, detail="Отзыв не найден")

    db.delete(review)
    db.commit()

    return {"message": "Отзыв удалён"}


@router.post("/{review_id}/like")
def like_review(
        review_id: int,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user_required)
):
    """Поставить лайк отзыву"""
    review = db.query(Review).filter(Review.id == review_id).first()
    if not review:
        raise HTTPException(status_code=404, detail="Отзыв не найден")

    existing = db.query(ReviewLike).filter(
        ReviewLike.review_id == review_id,
        ReviewLike.user_id == current_user.id
    ).first()

    if existing:
        raise HTTPException(status_code=400, detail="Вы уже поставили лайк")

    like = ReviewLike(review_id=review_id, user_id=current_user.id)
    db.add(like)
    db.commit()

    return {"message": "Лайк поставлен"}


@router.delete("/{review_id}/like")
def unlike_review(
        review_id: int,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user_required)
):
    """Убрать лайк с отзыва"""
    like = db.query(ReviewLike).filter(
        ReviewLike.review_id == review_id,
        ReviewLike.user_id == current_user.id
    ).first()

    if not like:
        raise HTTPException(status_code=404, detail="Лайк не найден")

    db.delete(like)
    db.commit()

    return {"message": "Лайк убран"}


@router.post("/{review_id}/comments", response_model=ReviewCommentResponse)
def create_review_comment(
        review_id: int,
        comment_data: ReviewCommentCreate,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user_required)
):
    """Добавить комментарий к отзыву"""
    review = db.query(Review).filter(Review.id == review_id).first()
    if not review:
        raise HTTPException(status_code=404, detail="Отзыв не найден")

    comment = ReviewComment(
        review_id=review_id,
        user_id=current_user.id,
        text=comment_data.text
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)

    return ReviewCommentResponse(
        id=comment.id,
        text=comment.text,
        user_id=comment.user_id,
        review_id=comment.review_id,
        created_at=comment.created_at,
        username=current_user.username,
        avatar_url=current_user.avatar_url
    )


@router.get("/{review_id}/comments", response_model=List[ReviewCommentResponse])
def get_review_comments(
        review_id: int,
        skip: int = 0,
        limit: int = 50,
        db: Session = Depends(get_db)
):
    """Получить комментарии к отзыву"""
    comments = db.query(ReviewComment).filter(ReviewComment.review_id == review_id) \
        .order_by(ReviewComment.created_at.desc()).offset(skip).limit(limit).all()

    result = []
    for comment in comments:
        user = db.query(User).filter(User.id == comment.user_id).first()
        result.append(ReviewCommentResponse(
            id=comment.id,
            text=comment.text,
            user_id=comment.user_id,
            review_id=comment.review_id,
            created_at=comment.created_at,
            username=user.username if user else "Пользователь",
            avatar_url=user.avatar_url if user else None
        ))

    return result