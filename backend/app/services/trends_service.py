"""Тренды цен: что подешевело, что подорожало и что сейчас в сезон.

Идея: у каждого продукта в городе есть история цен (`price_quotes`). Сравниваем
лучшую (минимальную по магазинам) цену за сегодня с лучшей ценой в начале окна —
получаем честную динамику «в этом городе сейчас выгодно покупать вот это».

Если у продукта меньше двух точек истории — он молча пропускается: лучше пустой
список, чем выдуманная динамика.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.models.geo import Shop
from app.models.price import PriceQuote
from app.models.product import Product

# Сколько продуктов попадает в «оценку корзины»
BASKET_SIZE = 20


def _season_months(product: Product) -> List[str]:
    """Месяцы сезонности продукта в виде списка строк: '6,7,8' → ['6', '7', '8']."""
    return [month.strip() for month in (product.season_months or '').split(',') if month.strip()]


def _is_seasonal(product: Product, month: str) -> bool:
    return month in _season_months(product)


def _daily_best(quotes: List[PriceQuote]) -> Dict[date, Tuple[float, Optional[int]]]:
    """Схлопывает цены продукта по датам: {дата: (минимальная цена, shop_id)}.

    Внутри одной даты у продукта может быть несколько магазинов — берём самый
    дешёвый, потому что пользователь может выбрать магазин.
    """
    buckets: Dict[date, Tuple[float, Optional[int]]] = {}
    for quote in quotes:
        if quote.checked_at is None:
            continue
        day = quote.checked_at.date()
        price = float(quote.price)
        current = buckets.get(day)
        if current is None or price < current[0]:
            buckets[day] = (price, quote.shop_id)
    return buckets


def load_price_history(db: Session, city_id: int) -> Dict[int, List[PriceQuote]]:
    """Загружает историю цен города одним запросом, сгруппированную по продукту."""
    quotes = (
        db.query(PriceQuote)
        .filter(PriceQuote.city_id == city_id)
        .filter(PriceQuote.status != 'rejected')
        .order_by(PriceQuote.product_id, PriceQuote.checked_at)
        .all()
    )
    history: Dict[int, List[PriceQuote]] = {}
    for quote in quotes:
        history.setdefault(quote.product_id, []).append(quote)
    return history


def build_trends(
    db: Session,
    city_id: int,
    days: int = 30,
    limit: int = 12,
) -> dict:
    """Считает динамику цен по городу за окно `days` дней.

    Для каждого продукта берётся последняя точка (max checked_at) и самая старая
    точка в пределах окна; сравнение идёт по лучшей цене среди магазинов на дату.
    """
    history = load_price_history(db, city_id)
    today = datetime.now(timezone.utc).date()
    window_start = today - timedelta(days=days)
    current_month = str(today.month)

    product_ids = list(history.keys())
    products: Dict[int, Product] = {}
    if product_ids:
        products = {
            product.id: product
            for product in db.query(Product).filter(Product.id.in_(product_ids)).all()
        }

    shop_ids = {quote.shop_id for quotes in history.values() for quote in quotes}
    shops: Dict[int, Shop] = {}
    if shop_ids:
        shops = {shop.id: shop for shop in db.query(Shop).filter(Shop.id.in_(shop_ids)).all()}

    dropped: List[dict] = []
    risen: List[dict] = []
    seasonal: List[dict] = []
    quotes_tracked = 0
    tracked_products = 0

    # Продукты, по которым есть цены: нужны и для сезонных подборок, и для оценки корзины
    latest_by_product: Dict[int, Tuple[float, Optional[int]]] = {}
    quotes_by_product: Dict[int, int] = {}

    for product_id, quotes in history.items():
        product = products.get(product_id)
        if product is None:
            continue
        quotes_tracked += len(quotes)
        quotes_by_product[product_id] = len(quotes)

        buckets = _daily_best(quotes)
        if not buckets:
            continue
        tracked_products += 1

        latest_day = max(buckets)
        latest_price, latest_shop_id = buckets[latest_day]
        latest_by_product[product_id] = (latest_price, latest_shop_id)

        if _is_seasonal(product, current_month):
            seasonal.append(_seasonal_out(product, latest_price, shops, latest_shop_id))

        # Продукт без свежих цен: сравнивать не с чем
        if latest_day < window_start:
            continue

        # Точки внутри окна сравнения; нужны минимум две разные даты
        in_window = sorted(day for day in buckets if day >= window_start)
        if len(in_window) < 2:
            continue

        old_day = in_window[0]
        old_price, _old_shop_id = buckets[old_day]

        if old_price <= 0:
            continue

        change_abs = round(latest_price - old_price, 2)
        change_percent = round((change_abs / old_price) * 100, 2)
        in_season = _is_seasonal(product, current_month)

        item = {
            'product_id': product.id,
            'name': product.name,
            'category': product.category,
            'unit': product.unit,
            'price': round(latest_price, 2),
            'old_price': round(old_price, 2),
            'change_percent': change_percent,
            'change_abs': change_abs,
            'shop_id': latest_shop_id,
            'shop_name': shops[latest_shop_id].name if latest_shop_id in shops else None,
            'kcal_per_100': product.kcal_per_100,
            'in_season': in_season,
        }

        if change_percent < 0:
            dropped.append(item)
        elif change_percent > 0:
            risen.append(item)

    # Подешевело сильнее всего — вперёд: это и есть «рост выгоды»
    dropped.sort(key=lambda item: (item['change_percent'], item['name']))
    # Подорожало сильнее всего — тоже вперёд: на это стоит посмотреть первым делом
    risen.sort(key=lambda item: (-item['change_percent'], item['name']))
    seasonal.sort(key=lambda item: item['price'])

    # Оценка корзины: сумма лучших цен по 20 самым «популярным» продуктам города,
    # где популярность приближена числом ценовых точек (чаще обновляют — чаще берут).
    popular = sorted(
        latest_by_product,
        key=lambda pid: (-quotes_by_product.get(pid, 0), pid),
    )[:BASKET_SIZE]
    basket_estimate = (
        round(sum(latest_by_product[pid][0] for pid in popular), 2) if popular else None
    )

    return {
        'period_days': days,
        'dropped': dropped[:limit],
        'risen': risen[:limit],
        'seasonal': seasonal[:limit],
        'averages': {
            'basket_estimate': basket_estimate,
            'products_tracked': tracked_products,
            'quotes_tracked': quotes_tracked,
        },
    }


def _seasonal_out(
    product: Product,
    price: float,
    shops: Dict[int, Shop],
    shop_id: Optional[int],
) -> dict:
    """Строка сезонной подборки: продукт и его лучшая цена в городе."""
    return {
        'product_id': product.id,
        'name': product.name,
        'category': product.category,
        'unit': product.unit,
        'price': round(price, 2),
        'shop_name': shops[shop_id].name if shop_id in shops else None,
        'in_season': True,
    }
