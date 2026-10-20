"""Акции от пользователей: «увидел ценник — поделился».

Отличие от справочных цен (`/prices`): акция — разовое предложение со сроком
и старой ценой. Публикуется только после модерации, поэтому фейковые «скидки»
не попадают в ленту и не подрывают доверие к ценам.
"""

import os
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_current_user_required
from app.core.database import get_db
from app.models.geo import City, Shop
from app.models.moderation import ModerationTask
from app.models.product import Product
from app.models.promo import Promo, PromoLike
from app.models.user import User
from app.schemas.promo import PromoCreateIn, PromoListOut, PromoOut
from app.services.moderation_service import auto_flags_for, enqueue_if_needed

promos_router = APIRouter(prefix='/promos', tags=['Акции'])

UPLOAD_DIR = 'uploads'
ALLOWED_EXTENSIONS = {'jpg', 'jpeg', 'png', 'webp'}
MAX_PHOTO_BYTES = 5 * 1024 * 1024

# Доверенный автор публикует акцию сразу, остальные — через модерацию
TRUST_THRESHOLD = 60


def _discount_percent(old_price: Optional[float], new_price: float) -> Optional[float]:
    if not old_price or old_price <= 0 or new_price >= old_price:
        return None
    return round((old_price - new_price) / old_price * 100, 1)


def serialize_promo(
    promo: Promo,
    shop: Optional[Shop] = None,
    product: Optional[Product] = None,
    city: Optional[City] = None,
    author: Optional[User] = None,
    is_liked: bool = False,
) -> PromoOut:
    is_expired = bool(promo.ends_at and promo.ends_at < datetime.now(timezone.utc))
    return PromoOut(
        id=promo.id,
        title=promo.title,
        description=promo.description,
        shop_id=promo.shop_id,
        shop_name=shop.name if shop else None,
        shop_emoji=shop.emoji if shop else None,
        city_id=promo.city_id,
        city_name=city.name if city else None,
        product_id=promo.product_id,
        product_name=product.name if product else None,
        old_price=promo.old_price,
        new_price=promo.new_price,
        unit=promo.unit,
        discount_percent=_discount_percent(promo.old_price, promo.new_price),
        photo_url=promo.photo_url,
        status=promo.status,
        reject_reason=promo.reject_reason,
        is_verified=bool(promo.is_verified),
        likes_count=int(promo.likes_count or 0),
        views_count=int(promo.views_count or 0),
        is_liked=is_liked,
        author_id=promo.user_id,
        author_username=author.username if author else None,
        author_avatar_url=author.avatar_url if author else None,
        ends_at=promo.ends_at,
        created_at=promo.created_at,
        is_expired=is_expired,
    )


def _serialize_many(db: Session, promos: List[Promo], current_user: Optional[User]) -> List[PromoOut]:
    """Пакетно подтягивает связанные объекты, чтобы не плодить запросы."""
    if not promos:
        return []

    shop_ids = {p.shop_id for p in promos if p.shop_id}
    product_ids = {p.product_id for p in promos if p.product_id}
    city_ids = {p.city_id for p in promos if p.city_id}
    author_ids = {p.user_id for p in promos}
    promo_ids = [p.id for p in promos]

    shops = {s.id: s for s in db.query(Shop).filter(Shop.id.in_(shop_ids)).all()} if shop_ids else {}
    products = (
        {p.id: p for p in db.query(Product).filter(Product.id.in_(product_ids)).all()}
        if product_ids
        else {}
    )
    cities = {c.id: c for c in db.query(City).filter(City.id.in_(city_ids)).all()} if city_ids else {}
    authors = {u.id: u for u in db.query(User).filter(User.id.in_(author_ids)).all()}

    liked_ids = set()
    if current_user is not None:
        likes = (
            db.query(PromoLike)
            .filter(PromoLike.user_id == current_user.id, PromoLike.promo_id.in_(promo_ids))
            .all()
        )
        liked_ids = {like.promo_id for like in likes}

    return [
        serialize_promo(
            promo,
            shop=shops.get(promo.shop_id),
            product=products.get(promo.product_id),
            city=cities.get(promo.city_id),
            author=authors.get(promo.user_id),
            is_liked=promo.id in liked_ids,
        )
        for promo in promos
    ]


@promos_router.get('/', response_model=PromoListOut)
def list_promos(
    city_id: Optional[int] = Query(None),
    shop_id: Optional[int] = Query(None),
    sort: str = Query('hot', pattern='^(hot|new|discount)$'),
    include_expired: bool = Query(False),
    limit: int = Query(20, ge=1, le=100),
    skip: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    """Лента опубликованных акций: горячие, свежие или с максимальной скидкой."""
    query = db.query(Promo).filter(Promo.status == 'published')

    if city_id is not None:
        query = query.filter(Promo.city_id == city_id)
    if shop_id is not None:
        query = query.filter(Promo.shop_id == shop_id)
    if not include_expired:
        now = datetime.now(timezone.utc)
        query = query.filter((Promo.ends_at.is_(None)) | (Promo.ends_at >= now))

    if sort == 'hot':
        query = query.order_by(Promo.likes_count.desc(), Promo.created_at.desc())
    elif sort == 'discount':
        query = query.order_by(
            ((Promo.old_price - Promo.new_price) / Promo.old_price).desc().nullslast(),
            Promo.created_at.desc(),
        )
    else:
        query = query.order_by(Promo.created_at.desc())

    total = query.count()
    promos = query.offset(skip).limit(limit).all()
    return PromoListOut(total=total, items=_serialize_many(db, promos, current_user))


@promos_router.get('/my', response_model=PromoListOut)
def my_promos(
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_required),
):
    """Мои акции со статусами — видно, приняли или отклонили."""
    promos = (
        db.query(Promo)
        .filter(Promo.user_id == current_user.id)
        .order_by(Promo.created_at.desc())
        .limit(limit)
        .all()
    )
    return PromoListOut(total=len(promos), items=_serialize_many(db, promos, current_user))


@promos_router.post('/upload-photo')
async def upload_promo_photo(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user_required),
):
    """Загрузка фото ценника для акции."""
    extension = (file.filename or '').rsplit('.', 1)[-1].lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail='Допустимы только JPG, PNG и WebP')

    contents = await file.read()
    if len(contents) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=400, detail='Файл больше 5 МБ')

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    filename = f'{uuid.uuid4()}.{extension}'
    with open(os.path.join(UPLOAD_DIR, filename), 'wb') as buffer:
        buffer.write(contents)

    return {'photo_url': f'/uploads/{filename}'}


@promos_router.post('/', response_model=PromoOut)
def create_promo(
    payload: PromoCreateIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_required),
):
    """Опубликовать акцию. Новые авторы уходят на модерацию, доверенные — сразу в ленту."""
    shop = db.query(Shop).filter(Shop.id == payload.shop_id).first()
    if shop is None:
        raise HTTPException(status_code=404, detail='Магазин не найден')

    if payload.old_price is not None and payload.new_price >= payload.old_price:
        raise HTTPException(
            status_code=400,
            detail='Новая цена должна быть ниже старой — иначе это не акция',
        )

    city_id = payload.city_id
    if city_id is not None:
        city = db.query(City).filter(City.id == city_id).first()
        if city is None:
            raise HTTPException(status_code=404, detail='Город не найден')
    elif current_user.city_id:
        city_id = current_user.city_id

    product = None
    if payload.product_id is not None:
        product = db.query(Product).filter(Product.id == payload.product_id).first()
        if product is None:
            raise HTTPException(status_code=404, detail='Продукт не найден')

    promo = Promo(
        user_id=current_user.id,
        shop_id=shop.id,
        city_id=city_id,
        product_id=payload.product_id,
        title=payload.title,
        description=payload.description,
        old_price=payload.old_price,
        new_price=payload.new_price,
        unit=payload.unit or (product.unit if product else None),
        photo_url=payload.photo_url,
        ends_at=payload.ends_at,
        status='pending',
    )
    db.add(promo)
    db.flush()

    # Автофлаги и решение о модерации: доверенные авторы публикуются сразу
    moderation_text = ' '.join(
        [payload.title or '', payload.description or '', shop.name or '', product.name if product else '']
    )
    flags = auto_flags_for(moderation_text, payload.photo_url)

    queued = False
    if (current_user.trust_score or 0) < TRUST_THRESHOLD or flags:
        queued = enqueue_if_needed(
            db, 'promo', promo.id, current_user.id, flags
        )

    if not queued and (current_user.trust_score or 0) >= TRUST_THRESHOLD:
        promo.status = 'published'
        promo.is_verified = True
    elif not queued:
        promo.status = 'pending'

    db.commit()
    db.refresh(promo)
    return serialize_promo(promo, shop=shop, product=product, author=current_user)


@promos_router.get('/{promo_id}', response_model=PromoOut)
def get_promo(
    promo_id: int,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    """Карточка акции. Неопубликованную видят только автор и модераторы."""
    promo = db.query(Promo).filter(Promo.id == promo_id).first()
    if promo is None:
        raise HTTPException(status_code=404, detail='Акция не найдена')

    role = getattr(current_user, 'role', 'user') if current_user else None
    is_privileged = bool(
        current_user
        and (promo.user_id == current_user.id or role in ('moderator', 'admin'))
    )
    if promo.status != 'published' and not is_privileged:
        raise HTTPException(status_code=404, detail='Акция не найдена')

    promo.views_count = int(promo.views_count or 0) + 1
    db.commit()
    db.refresh(promo)

    shop = db.query(Shop).filter(Shop.id == promo.shop_id).first() if promo.shop_id else None
    product = db.query(Product).filter(Product.id == promo.product_id).first() if promo.product_id else None
    city = db.query(City).filter(City.id == promo.city_id).first() if promo.city_id else None
    author = db.query(User).filter(User.id == promo.user_id).first()

    is_liked = False
    if current_user is not None:
        is_liked = (
            db.query(PromoLike)
            .filter(PromoLike.promo_id == promo.id, PromoLike.user_id == current_user.id)
            .first()
            is not None
        )

    return serialize_promo(promo, shop=shop, product=product, city=city, author=author, is_liked=is_liked)


@promos_router.post('/{promo_id}/like', response_model=PromoOut)
def like_promo(
    promo_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_required),
):
    promo = db.query(Promo).filter(Promo.id == promo_id).first()
    if promo is None:
        raise HTTPException(status_code=404, detail='Акция не найдена')

    existing = (
        db.query(PromoLike)
        .filter(PromoLike.promo_id == promo_id, PromoLike.user_id == current_user.id)
        .first()
    )
    if existing is None:
        db.add(PromoLike(promo_id=promo_id, user_id=current_user.id))
        promo.likes_count = int(promo.likes_count or 0) + 1
        db.commit()
        db.refresh(promo)

    return serialize_promo(promo, author=current_user, is_liked=True)


@promos_router.delete('/{promo_id}/like', response_model=PromoOut)
def unlike_promo(
    promo_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_required),
):
    promo = db.query(Promo).filter(Promo.id == promo_id).first()
    if promo is None:
        raise HTTPException(status_code=404, detail='Акция не найдена')

    existing = (
        db.query(PromoLike)
        .filter(PromoLike.promo_id == promo_id, PromoLike.user_id == current_user.id)
        .first()
    )
    if existing is not None:
        db.delete(existing)
        promo.likes_count = max(0, int(promo.likes_count or 0) - 1)
        db.commit()
        db.refresh(promo)

    return serialize_promo(promo, author=current_user, is_liked=False)


@promos_router.delete('/{promo_id}')
def delete_promo(
    promo_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_required),
):
    promo = db.query(Promo).filter(Promo.id == promo_id).first()
    if promo is None:
        raise HTTPException(status_code=404, detail='Акция не найдена')

    role = getattr(current_user, 'role', 'user') or 'user'
    if promo.user_id != current_user.id and role not in ('moderator', 'admin'):
        raise HTTPException(status_code=403, detail='Можно удалять только свои акции')

    db.query(PromoLike).filter(PromoLike.promo_id == promo_id).delete()
    # Закрываем связанные задачи модерации: объекта больше нет,
    # иначе в очереди остаётся «висячая» задача с пустым превью
    db.query(ModerationTask).filter(
        ModerationTask.target_type == 'promo',
        ModerationTask.target_id == promo_id,
    ).delete(synchronize_session=False)
    db.delete(promo)
    db.commit()
    return {'message': 'Акция удалена'}
