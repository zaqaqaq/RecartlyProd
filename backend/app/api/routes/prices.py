"""Краудсорсинг цен: пользователь приносит цену из магазина, модерация её проверяет.

Это ядро «Сметы»: без живых цен все расчёты — выдумка. Поэтому здесь три роли
одного механизма:
  * автор — ищет продукт, выбирает магазин, прикладывает ценник;
  * доверие — цена авторитетного автора (``trust_score >= 60``) публикуется сразу,
    остальные уходят в общую очередь модерации (``target_type='price'``);
  * модератор — может подтвердить цену вручную, действие попадает в AuditLog.

Роутер подключается отдельно (``prices_router``) — регистрация в
``app/api/routes/__init__.py`` и ``app/main.py`` выполняется другим исполнителем.
"""

from datetime import datetime, timedelta, timezone
import os
import uuid
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import case, func, or_
from sqlalchemy.orm import Session

from app.api.deps import get_current_moderator, get_current_user_required
from app.core.database import get_db
from app.models.geo import City, Shop
from app.models.moderation import ModerationTask
from app.models.price import PriceQuote
from app.models.product import Product
from app.models.user import User
from app.schemas.price import ProductSearchOut, PriceQuoteCreateIn, PriceQuoteOut
from app.services.achievement_service import check_achievements
from app.services.moderation_service import auto_flags_for, enqueue_if_needed, log_action

prices_router = APIRouter(prefix='/prices', tags=['Цены'])

# Доверие, начиная с которого цена публикуется без ручной проверки.
TRUST_AUTO_CONFIRM = 60.0

# Санити-чек: насколько новая цена может отличаться от свежей предыдущей.
SANITY_WINDOW_DAYS = 60
SANITY_MAX_RATIO = 3.0

# Загрузка фото ценника.
UPLOAD_DIR = 'uploads'
ALLOWED_PHOTO_EXTENSIONS = {'jpg', 'jpeg', 'png', 'webp'}
MAX_PHOTO_BYTES = 5 * 1024 * 1024
UPLOAD_CHUNK_BYTES = 1024 * 1024

# Сколько продуктов отдаём в автодополнении.
MAX_PRODUCT_SUGGESTIONS = 20


# ---------- Вспомогательные функции ----------


def _now() -> datetime:
    """Текущее время в UTC (в БД поля цен — timestamptz)."""
    return datetime.now(timezone.utc)


def _like_pattern(term: str, prefix_only: bool = False) -> str:
    """Шаблон для ILIKE с экранированием служебных символов (%, _, \\)."""
    escaped = (
        term.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
    )
    return f'{escaped}%' if prefix_only else f'%{escaped}%'


def _get_or_404(db: Session, model, object_id: int, message: str):
    """Достаёт объект справочника или отдаёт понятную 404."""
    obj = db.query(model).filter(model.id == object_id).first()
    if obj is None:
        raise HTTPException(status_code=404, detail=message)
    return obj


def _build_out(
        quote: PriceQuote,
        product: Optional[Product] = None,
        shop: Optional[Shop] = None,
        author: Optional[User] = None,
) -> PriceQuoteOut:
    """Собирает ответ по цене (имена подтягиваются отдельно, чтобы не ловить N+1)."""
    return PriceQuoteOut(
        id=quote.id,
        product_id=quote.product_id,
        product_name=product.name if product else None,
        shop_id=quote.shop_id,
        shop_name=shop.name if shop else None,
        city_id=quote.city_id,
        price=float(quote.price or 0),
        unit_amount=float(quote.unit_amount or 1.0),
        source=quote.source or 'user',
        status=quote.status or 'pending',
        photo_url=quote.photo_url,
        created_at=quote.created_at,
        checked_at=quote.checked_at,
        reported_by_username=author.username if author else None,
    )


def _quotes_to_out(db: Session, quotes: List[PriceQuote]) -> List[PriceQuoteOut]:
    """Список цен с именами продукта, магазина и автора — тремя запросами на пачку."""
    if not quotes:
        return []

    product_ids = {quote.product_id for quote in quotes}
    shop_ids = {quote.shop_id for quote in quotes}
    author_ids = {quote.reported_by for quote in quotes if quote.reported_by}

    products: Dict[int, Product] = {
        p.id: p for p in db.query(Product).filter(Product.id.in_(product_ids)).all()
    }
    shops: Dict[int, Shop] = {
        s.id: s for s in db.query(Shop).filter(Shop.id.in_(shop_ids)).all()
    }
    authors: Dict[int, User] = {}
    if author_ids:
        authors = {
            u.id: u for u in db.query(User).filter(User.id.in_(author_ids)).all()
        }

    return [
        _build_out(
            quote,
            products.get(quote.product_id),
            shops.get(quote.shop_id),
            authors.get(quote.reported_by),
        )
        for quote in quotes
    ]


def _check_price_sanity(db: Session, payload: PriceQuoteCreateIn) -> None:
    """Сравнивает новую цену со свежей предыдущей ценой той же пары.

    Если для (продукт, магазин, город) уже есть цена не старше 60 дней, новая
    не должна отличаться от неё больше чем в 3 раза в любую сторону: скорее
    всего это опечатка («1999» вместо «199,9») или неверно указан объём.
    """
    since = _now() - timedelta(days=SANITY_WINDOW_DAYS)
    previous = (
        db.query(PriceQuote)
        .filter(
            PriceQuote.product_id == payload.product_id,
            PriceQuote.shop_id == payload.shop_id,
            PriceQuote.city_id == payload.city_id,
            PriceQuote.status != 'rejected',
            PriceQuote.checked_at.isnot(None),
            PriceQuote.checked_at >= since,
        )
        .order_by(PriceQuote.checked_at.desc())
        .first()
    )
    if previous is None:
        return

    try:
        previous_price = float(previous.price or 0)
        new_price = float(payload.price)
    except (TypeError, ValueError):
        return

    if previous_price <= 0 or new_price <= 0:
        return

    ratio = new_price / previous_price
    if ratio > SANITY_MAX_RATIO or ratio < 1.0 / SANITY_MAX_RATIO:
        raise HTTPException(
            status_code=400,
            detail='Цена выглядит неправдоподобно, укажите точнее',
        )


def _close_pending_tasks(db: Session, quote_id: int, moderator_id: int) -> None:
    """Закрывает висящие задачи модерации по цене после ручного подтверждения.

    Иначе подтверждённая цена остаётся в очереди и её можно «отклонить» вторым
    проходом, хотя решение уже принято.
    """
    tasks = (
        db.query(ModerationTask)
        .filter(
            ModerationTask.target_type == 'price',
            ModerationTask.target_id == quote_id,
            ModerationTask.status == 'pending',
        )
        .all()
    )
    if not tasks:
        return

    now = _now()
    for task in tasks:
        task.status = 'approved'
        task.moderator_id = moderator_id
        task.resolved_at = now
    db.commit()


# ---------- Поиск продуктов ----------


@prices_router.get('/products', response_model=List[ProductSearchOut])
def search_products(
        q: str = Query(default='', max_length=100, description='Название или алиас продукта'),
        limit: int = Query(default=MAX_PRODUCT_SUGGESTIONS, ge=1, le=MAX_PRODUCT_SUGGESTIONS),
        db: Session = Depends(get_db),
):
    """Автодополнение продукта: поиск по названию и алиасам.

    Совпадение в начале названия идёт первым, затем — короткие названия:
    на запрос «молок» сверху должен быть «Молоко», а не «Молоко сгущённое».
    """
    query = db.query(Product)
    term = (q or '').strip()

    if term:
        query = query.filter(
            or_(
                Product.name.ilike(_like_pattern(term), escape='\\'),
                Product.aliases.ilike(_like_pattern(term), escape='\\'),
            )
        )
        query = query.order_by(
            case((Product.name.ilike(_like_pattern(term, prefix_only=True), escape='\\'), 0), else_=1),
            func.length(Product.name),
            Product.name,
        )
    else:
        query = query.order_by(Product.name)

    return query.limit(limit).all()


# ---------- Создание цены ----------


@prices_router.post('/', response_model=PriceQuoteOut)
def create_price(
        payload: PriceQuoteCreateIn,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user_required),
):
    """Создать цену от имени пользователя.

    Авторитетный автор (``trust_score >= 60``) или модератор публикует цену сразу,
    остальные получают ``status='pending'`` и задачу в очереди модерации.
    """
    product = _get_or_404(db, Product, payload.product_id, 'Продукт не найден')
    shop = _get_or_404(db, Shop, payload.shop_id, 'Магазин не найден')
    city = _get_or_404(db, City, payload.city_id, 'Город не найден')

    _check_price_sanity(db, payload)

    trust = float(current_user.trust_score or 0)
    is_trusted = trust >= TRUST_AUTO_CONFIRM or current_user.role in ('moderator', 'admin')
    status = 'confirmed' if is_trusted else 'pending'

    quote = PriceQuote(
        product_id=product.id,
        shop_id=shop.id,
        city_id=city.id,
        price=float(payload.price),
        unit_amount=float(payload.unit_amount or 1.0),
        source='user',
        status=status,
        photo_url=payload.photo_url or None,
        reported_by=current_user.id,
        checked_at=_now(),
    )
    db.add(quote)
    db.commit()
    db.refresh(quote)

    if status == 'pending':
        # Автофлаги считаем по осмысленному тексту заявки: что за продукт и где.
        moderation_text = '\n'.join(filter(None, [
            product.name,
            shop.name,
            city.name,
            payload.comment,
        ]))
        auto_flags = auto_flags_for(moderation_text, quote.photo_url)
        enqueue_if_needed(
            db,
            target_type='price',
            target_id=quote.id,
            author_id=current_user.id,
            auto_flags=auto_flags,
        )
    else:
        # Сразу подтверждённая цена может закрыть ачивку «Охотник за ценами».
        check_achievements(db, current_user)

    return _build_out(quote, product, shop, current_user)


# ---------- Мои цены и лента города ----------


@prices_router.get('/my', response_model=List[PriceQuoteOut])
def my_prices(
        limit: int = Query(default=50, ge=1, le=200),
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user_required),
):
    """Мои заявки на цены со статусами: видно, приняли цену или отклонили."""
    quotes = (
        db.query(PriceQuote)
        .filter(PriceQuote.reported_by == current_user.id)
        .order_by(PriceQuote.created_at.desc())
        .limit(limit)
        .all()
    )
    return _quotes_to_out(db, quotes)


@prices_router.get('/recent', response_model=List[PriceQuoteOut])
def recent_prices(
        city_id: Optional[int] = Query(default=None, description='Город ленты'),
        limit: int = Query(default=10, ge=1, le=50),
        db: Session = Depends(get_db),
):
    """Последние подтверждённые цены города — лента «кто что видел»."""
    query = db.query(PriceQuote).filter(PriceQuote.status == 'confirmed')
    if city_id:
        query = query.filter(PriceQuote.city_id == city_id)

    quotes = (
        query
        .order_by(PriceQuote.checked_at.desc().nulls_last(), PriceQuote.id.desc())
        .limit(limit)
        .all()
    )
    return _quotes_to_out(db, quotes)


# ---------- Фото ценника ----------


@prices_router.post('/upload-photo')
async def upload_price_photo(
        file: UploadFile = File(...),
        current_user: User = Depends(get_current_user_required),
):
    """Загрузка фото ценника (jpg, jpeg, png, webp; до 5 МБ).

    Проверяем расширение по белому списку и читаем файл порциями, чтобы
    «тяжёлая» загрузка не легла в память целиком.
    """
    original_name = file.filename or ''
    extension = original_name.rsplit('.', 1)[-1].lower() if '.' in original_name else ''
    if extension not in ALLOWED_PHOTO_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail='Фото ценника: допустимы только jpg, jpeg, png или webp',
        )

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    filename = f'{uuid.uuid4()}.{extension}'
    file_path = os.path.join(UPLOAD_DIR, filename)

    size = 0
    try:
        with open(file_path, 'wb') as buffer:
            while True:
                chunk = await file.read(UPLOAD_CHUNK_BYTES)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_PHOTO_BYTES:
                    raise HTTPException(
                        status_code=400,
                        detail='Фото ценника больше 5 МБ — сделайте снимок поменьше',
                    )
                buffer.write(chunk)
    except HTTPException:
        if os.path.exists(file_path):
            os.remove(file_path)
        raise

    return {'photo_url': f'/uploads/{filename}'}


# ---------- Подтверждение модератором ----------


@prices_router.post('/{quote_id}/confirm', response_model=PriceQuoteOut)
def confirm_price(
        quote_id: int,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_moderator),
):
    """Подтвердить цену вручную (только модератор/админ).

    Цена становится ``confirmed`` с источником ``moderator``, действие пишется
    в AuditLog, а автора проверяют на ачивки (в том числе «Охотник за ценами»).
    """
    quote = _get_or_404(db, PriceQuote, quote_id, 'Цена не найдена')

    was_confirmed = quote.status == 'confirmed'
    quote.status = 'confirmed'
    quote.source = 'moderator'
    if not was_confirmed or quote.checked_at is None:
        quote.checked_at = _now()
    db.commit()
    db.refresh(quote)

    log_action(
        db,
        actor_id=current_user.id,
        action='verify_price',
        target_type='price',
        target_id=quote.id,
        payload={
            'product_id': quote.product_id,
            'shop_id': quote.shop_id,
            'city_id': quote.city_id,
            'price': quote.price,
            'unit_amount': quote.unit_amount,
            'author_id': quote.reported_by,
            'photo_url': quote.photo_url,
        },
    )

    # Задача модерации по этой цене больше не актуальна.
    _close_pending_tasks(db, quote.id, current_user.id)

    author = None
    if quote.reported_by:
        author = db.query(User).filter(User.id == quote.reported_by).first()
        if author is not None:
            check_achievements(db, author)

    product = db.query(Product).filter(Product.id == quote.product_id).first()
    shop = db.query(Shop).filter(Shop.id == quote.shop_id).first()
    return _build_out(quote, product, shop, author)
