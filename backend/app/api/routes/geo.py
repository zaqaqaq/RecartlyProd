"""География «Сметы»: города России и магазины.

Городов в справочнике больше тысячи, поэтому выдача по умолчанию ограничена
крупнейшими, а конкретный город ищется параметром `q`. Если города нет в списке,
пользователь может добавить его сам — название нормализуется (первая буква заглавная).
"""

import re
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_current_user_required
from app.core.database import get_db
from app.models.geo import City, Shop, ShopCity, UserShop
from app.models.user import User
from app.schemas.smeta import CityCreateIn, CityOut, ShopCreateIn, ShopOut

geo_router = APIRouter(prefix="/geo", tags=["География"])

# Сколько городов отдавать по умолчанию (крупнейшие) — чтобы не грузить весь справочник
DEFAULT_LIMIT = 50

TRANSLIT = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e', 'ж': 'zh',
    'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
    'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'ts',
    'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu',
    'я': 'ya',
}


def slugify(value: str) -> str:
    result = ''.join(TRANSLIT.get(char, char) for char in (value or '').lower())
    result = re.sub(r'[^a-z0-9]+', '-', result).strip('-')
    return result or 'city'


def normalize_city_name(value: str) -> str:
    """Приводит название к виду «Санкт-Петербург»: каждое слово с большой буквы.

    Пользователь просил сохранять город «с большой буквы», поэтому ввод вида
    «томск», «ТОМСК» и «санкт-петербург» приводится к нормальному виду.
    """
    cleaned = re.sub(r'\s+', ' ', (value or '').strip())
    if not cleaned:
        return ''

    def capitalize(part: str) -> str:
        if not part:
            return part
        return part[0].upper() + part[1:].lower()

    # Отдельно обрабатываем дефисы: «санкт-петербург» → «Санкт-Петербург»
    return ' '.join('-'.join(capitalize(piece) for piece in word.split('-')) for word in cleaned.split(' '))


def normalize_shop_name(value: str) -> str:
    """Название магазина: «магазин у дома» → «Магазин у дома».

    У магазинов с большой буквы пишется только первое слово — иначе получается
    «Магазин У Дома», что выглядит нелепо.
    """
    name = normalize_city_name(value)
    if not name:
        return ''
    words = name.split(' ')
    return ' '.join([words[0]] + [word.lower() for word in words[1:]])


@geo_router.get("/cities", response_model=List[CityOut])
def list_cities(
    q: Optional[str] = Query(None, description="Поиск города по названию или региону"),
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=300),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """Список городов: без `q` — крупнейшие, с `q` — поиск по всей России.

    Ищем по названию города; по региону — только если по названию ничего не нашлось,
    иначе запрос «Киров» тянул бы всю Кировскую область вместо самого города.
    Сортировка: точное совпадение, затем совпадение с начала названия, затем население.
    """
    query = db.query(City).filter(City.is_active.is_(True))

    if q and q.strip():
        term = q.strip()

        def ranked(source):
            return source.order_by(
                case(
                    (func.lower(City.name) == term.lower(), 0),
                    (City.name.ilike(f'{term}%'), 1),
                    else_=2,
                ),
                City.population.desc().nullslast(),
                City.name,
            )

        by_name = ranked(query.filter(City.name.ilike(f'%{term}%')))
        results = by_name.offset(offset).limit(limit).all()
        if results:
            return results

        # Запасной вариант: пользователь мог ввести регион
        by_region = ranked(query.filter(City.region.ilike(f'%{term}%')))
        return by_region.offset(offset).limit(limit).all()

    return (
        query.order_by(City.population.desc().nullslast(), City.name)
        .offset(offset)
        .limit(limit)
        .all()
    )


@geo_router.post("/cities", response_model=CityOut)
def create_city(
    payload: CityCreateIn,
    db: Session = Depends(get_db),
):
    """Добавляет город, которого нет в справочнике.

    Название нормализуется («томск» → «Томск»). Если такой город уже есть,
    возвращаем существующий, чтобы не плодить дубликаты.
    """
    name = normalize_city_name(payload.name)
    if len(name) < 2:
        raise HTTPException(status_code=400, detail='Название города слишком короткое')

    existing = (
        db.query(City)
        .filter(func.lower(City.name) == name.lower())
        .order_by(City.population.desc().nullslast())
        .first()
    )
    if existing is not None:
        # Уточняем регион, если пользователь его указал
        if payload.region and not existing.region:
            existing.region = payload.region.strip()
            db.commit()
            db.refresh(existing)
        return existing

    base_slug = slugify(name)
    slug = base_slug
    suffix = 2
    while db.query(City).filter(City.slug == slug).first() is not None:
        slug = f'{base_slug}-{suffix}'
        suffix += 1

    city = City(
        name=name,
        slug=slug,
        region=(payload.region or '').strip() or None,
        population=payload.population,
        is_active=True,
    )
    db.add(city)
    db.commit()
    db.refresh(city)
    return city


@geo_router.get("/shops", response_model=List[ShopOut])
def list_shops(
    city_id: Optional[int] = Query(None, description="Показать магазины конкретного города"),
    only_partners: bool = Query(False, description="Только магазины с партнёрской программой"),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    """Магазины: сети плюс личные магазины пользователя («у дома»).

    Если для города нет явного списка магазинов, показываем все сети — иначе
    выбирать будет нечего. Личные магазины автора всегда идут первыми.
    """
    query = db.query(Shop).filter(Shop.is_custom.is_(False))

    if city_id is not None:
        has_links = db.query(ShopCity).filter(ShopCity.city_id == city_id).first() is not None
        if has_links:
            linked = (
                db.query(ShopCity.shop_id)
                .filter(ShopCity.city_id == city_id, ShopCity.is_active.is_(True))
                .subquery()
            )
            query = query.filter(Shop.id.in_(linked))

    if only_partners:
        query = query.filter(Shop.is_partner.is_(True))

    shops = query.order_by(Shop.is_online, Shop.name).all()

    custom_shops: List[Shop] = []
    custom_ids: Dict[int, int] = {}
    if current_user is not None:
        links = db.query(UserShop).filter(UserShop.user_id == current_user.id).all()
        if links:
            custom_ids = {link.shop_id: link.id for link in links}
            custom_shops = (
                db.query(Shop)
                .filter(Shop.id.in_(custom_ids.keys()))
                .order_by(Shop.name)
                .all()
            )

    result: List[ShopOut] = []
    for shop in custom_shops:
        item = ShopOut.model_validate(shop)
        item.has_affiliate = bool(shop.affiliate_template)
        item.is_custom = True
        item.user_shop_id = custom_ids.get(shop.id)
        result.append(item)

    for shop in shops:
        item = ShopOut.model_validate(shop)
        item.has_affiliate = bool(shop.affiliate_template)
        result.append(item)
    return result


@geo_router.post("/shops", response_model=ShopOut)
def create_custom_shop(
    payload: ShopCreateIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_required),
):
    """Добавить свой магазин — «магазин у дома».

    После сохранения он появляется в списках выбора и в фильтрах у автора,
    поэтому вводить название заново не нужно.
    """
    name = normalize_shop_name(payload.name)
    if len(name) < 2:
        raise HTTPException(status_code=400, detail='Название магазина слишком короткое')

    existing = db.query(Shop).filter(func.lower(Shop.name) == name.lower()).first()
    if existing is None:
        base_slug = f'user-{slugify(name)}'
        slug = base_slug
        suffix = 2
        while db.query(Shop).filter(Shop.slug == slug).first() is not None:
            slug = f'{base_slug}-{suffix}'
            suffix += 1

        existing = Shop(
            name=name,
            slug=slug,
            emoji='🏪',
            is_custom=True,
            created_by=current_user.id,
        )
        db.add(existing)
        db.commit()
        db.refresh(existing)

    link = (
        db.query(UserShop)
        .filter(UserShop.user_id == current_user.id, UserShop.shop_id == existing.id)
        .first()
    )
    if link is None:
        link = UserShop(user_id=current_user.id, shop_id=existing.id)
        db.add(link)
        db.commit()
        db.refresh(link)

    item = ShopOut.model_validate(existing)
    item.is_custom = True
    item.user_shop_id = link.id
    return item


@geo_router.delete("/shops/{shop_id}")
def delete_custom_shop(
    shop_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_required),
):
    """Убрать магазин из личного списка."""
    link = (
        db.query(UserShop)
        .filter(UserShop.user_id == current_user.id, UserShop.shop_id == shop_id)
        .first()
    )
    if link is None:
        raise HTTPException(status_code=404, detail='Магазин не найден в вашем списке')

    db.delete(link)
    db.commit()
    return {'message': 'Магазин удалён из вашего списка'}
