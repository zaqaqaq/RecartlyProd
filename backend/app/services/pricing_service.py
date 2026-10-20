"""Ядро «Сметы»: себестоимость рецепта, раскладка по магазинам, КБЖУ и Индекс Recartly.

Ключевая идея: цена — это факт о магазине в городе (`price_quotes`), а не свойство
рецепта. Поэтому любой рецепт оценивается заново для конкретного города и числа порций,
а корзину можно собрать двумя стратегиями:
  * single — всё в одном магазине (быстро, один заход);
  * split  — по нескольким магазинам (дешевле, но дольше).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Iterable, Optional

from sqlalchemy.orm import Session

from app.models.price import PriceQuote
from app.models.product import Product
from app.models.recipe import Recipe
from app.models.reaction import Reaction
from app.models.geo import Shop

# ---------- Разбор количеств ----------

# «500 г», «1,5 кг», «2 шт», «3 ст.л.», «200 мл»
QUANTITY_RE = re.compile(
    r'(?P<amount>\d+(?:[.,]\d+)?)\s*(?P<unit>кг|гр|г|мл|л|шт|уп|упак|пучок|ст\.?\s*л\.?|ч\.?\s*л\.?|стакан)?',
    re.IGNORECASE,
)

UNIT_TO_GRAMS = {
    'кг': 1000.0,
    'г': 1.0,
    'гр': 1.0,
    'л': 1000.0,
    'мл': 1.0,
    'ст.л': 15.0,
    'ст. л': 15.0,
    'стл': 15.0,
    'ч.л': 5.0,
    'ч. л': 5.0,
    'чл': 5.0,
    'стакан': 200.0,
    # Штучные позиции пересчитываются по условной массе одной единицы
    'шт': 100.0,
    'уп': 200.0,
    'упак': 200.0,
    'пучок': 50.0,
}

DEFAULT_UNIT_GRAMS = 100.0


def parse_quantity(text: Optional[str]) -> tuple[Optional[float], Optional[str]]:
    """Возвращает (количество, единица) из свободного текста ингредиента."""
    if not text:
        return None, None
    match = QUANTITY_RE.search(str(text))
    if not match:
        return None, None
    amount = match.group('amount').replace(',', '.')
    unit = (match.group('unit') or '').lower().replace(' ', '')
    try:
        return float(amount), (unit or None)
    except ValueError:
        return None, None


def unit_mass(product: Optional[Product]) -> float:
    """Масса одной штуки продукта в граммах (яйцо ≈ 55 г, сосиска ≈ 50 г)."""
    if product is None:
        return DEFAULT_UNIT_GRAMS
    if product.pack_size and product.pack_units:
        return max(1.0, float(product.pack_size) / float(product.pack_units))
    if product.pack_size:
        return float(product.pack_size)
    return DEFAULT_UNIT_GRAMS


def to_grams(product: Optional[Product], amount: Optional[float], unit: Optional[str]) -> Optional[float]:
    """Приблизительная масса позиции в граммах (для расчёта КБЖУ)."""
    if amount is None:
        return None

    if not unit:
        # Без единицы: для весовых продуктов подразумеваются килограммы, для остальных — штуки
        if product is not None and product.unit in ('кг', 'л'):
            return amount * 1000.0
        return amount * unit_mass(product)

    normalized = unit.lower().replace('.', '').replace(' ', '')

    if normalized == 'кг':
        return amount * 1000.0
    if normalized in ('г', 'гр'):
        return amount
    if normalized == 'л':
        return amount * 1000.0
    if normalized == 'мл':
        return amount
    if normalized == 'шт':
        return amount * unit_mass(product)
    if normalized in ('уп', 'упак'):
        pack = product.pack_size if product and product.pack_size else DEFAULT_UNIT_GRAMS
        return amount * float(pack)
    if normalized == 'пучок':
        pack = product.pack_size if product and product.pack_size else 50.0
        return amount * float(pack)
    if normalized in ('стл', 'ст.л'):
        return amount * 15.0
    if normalized in ('чл', 'ч.л'):
        return amount * 5.0
    if normalized == 'стакан':
        return amount * 200.0
    return amount * unit_mass(product)


# ---------- Сопоставление ингредиента с продуктом ----------


def normalize_name(value: str) -> str:
    return re.sub(r'[^a-zа-яё0-9]+', ' ', (value or '').lower()).strip()


def match_product(product_index: dict, text: str) -> Optional[Product]:
    """Ищет продукт справочника по свободному названию ингредиента.

    product_index — предзагруженный словарь {нормализованное имя/алиас: Product}.
    """
    if not text:
        return None
    normalized = normalize_name(text)
    if not normalized:
        return None

    if normalized in product_index:
        return product_index[normalized]

    # Частичное совпадение: «куриная грудка филе» → «куриная грудка»
    best = None
    best_len = 0
    for key, product in product_index.items():
        if len(key) < 4:
            continue
        if key in normalized or normalized in key:
            if len(key) > best_len:
                best, best_len = product, len(key)
    return best


def build_product_index(db: Session) -> dict:
    """Загружает справочник продуктов в память (72 позиции — дёшево)."""
    index: dict = {}
    for product in db.query(Product).all():
        index[normalize_name(product.name)] = product
        if product.aliases:
            for alias in product.aliases.split(','):
                alias_key = normalize_name(alias)
                if alias_key:
                    index.setdefault(alias_key, product)
    return index


# ---------- Цены ----------


@dataclass
class ShopRef:
    id: int
    name: str
    emoji: str
    slug: str
    is_online: bool = False


@dataclass
class BasketLine:
    product_id: Optional[int]
    name: str
    quantity: Optional[float]
    unit: Optional[str]
    shop_id: Optional[int]
    shop_name: Optional[str]
    price: Optional[float]
    line_total: Optional[float]
    matched: bool = True
    missing: bool = False  # цены не нашлось, подставлена средняя


@dataclass
class BasketOption:
    strategy: str                       # single | split
    shops: list = field(default_factory=list)
    lines: list = field(default_factory=list)
    total: float = 0.0
    coverage: int = 0                   # сколько позиций реально нашлось в магазинах
    total_positions: int = 0
    missing_positions: int = 0
    savings: float = 0.0                # экономия против стратегии single

    def as_dict(self) -> dict:
        return {
            'strategy': self.strategy,
            'shops': self.shops,
            'lines': [line.__dict__ for line in self.lines],
            'total': round(self.total, 2),
            'coverage': self.coverage,
            'total_positions': self.total_positions,
            'missing_positions': self.missing_positions,
            'savings': round(self.savings, 2),
        }


def load_price_map(db: Session, city_id: Optional[int], product_ids: Iterable[int]) -> tuple[dict, dict]:
    """Возвращает (prices, shops).

    prices: {product_id: {shop_id: price}} — берётся последняя подтверждённая цена пары.
    shops:  {shop_id: ShopRef}
    """
    product_ids = [pid for pid in product_ids if pid]
    if not product_ids:
        return {}, {}

    query = (
        db.query(PriceQuote)
        .filter(PriceQuote.product_id.in_(product_ids))
        # В расчёты идут только подтверждённые цены: непроверенная цена из краудсорсинга
        # не должна менять смету, пока её не подтвердил модератор или доверенный автор.
        .filter(PriceQuote.status == 'confirmed')
    )
    if city_id:
        query = query.filter(PriceQuote.city_id == city_id)

    # Свежие цены вперёд: первая встреченная цена на пару (product, shop) — актуальная
    quotes = query.order_by(PriceQuote.checked_at.desc()).all()

    prices: dict = {}
    shop_ids = set()
    for quote in quotes:
        per_shop = prices.setdefault(quote.product_id, {})
        if quote.shop_id in per_shop:
            continue
        per_shop[quote.shop_id] = float(quote.price)
        shop_ids.add(quote.shop_id)

    shops: dict = {}
    if shop_ids:
        for shop in db.query(Shop).filter(Shop.id.in_(shop_ids)).all():
            shops[shop.id] = ShopRef(
                id=shop.id,
                name=shop.name,
                emoji=shop.emoji or '🏬',
                slug=shop.slug,
                is_online=bool(shop.is_online),
            )

    return prices, shops


def average_price(prices: dict, product_id: int) -> Optional[float]:
    per_shop = prices.get(product_id)
    if not per_shop:
        return None
    values = list(per_shop.values())
    return round(sum(values) / len(values), 2)


# ---------- Позиции рецепта ----------


@dataclass
class RecipePosition:
    name: str
    quantity: Optional[float]
    unit: Optional[str]
    product: Optional[Product]
    grams: Optional[float]


def recipe_positions(recipe: Recipe, product_index: dict) -> list[RecipePosition]:
    positions: list[RecipePosition] = []
    for ingredient in recipe.ingredients:
        product = match_product(product_index, ingredient.name)
        amount, unit = parse_quantity(ingredient.quantity)
        positions.append(
            RecipePosition(
                name=ingredient.name,
                quantity=amount,
                unit=unit,
                product=product,
                grams=to_grams(product, amount, unit),
            )
        )
    return positions


def _position_price(prices: dict, shop_id: int, position: RecipePosition) -> Optional[float]:
    """Цена позиции в магазине: по сопоставленному продукту, иначе None."""
    if position.product is None:
        return None
    return prices.get(position.product.id, {}).get(shop_id)


def build_options(
    positions: list[RecipePosition],
    prices: dict,
    shops: dict,
    max_shops: int = 3,
) -> dict:
    """Считает варианты корзины: всё в одном магазине и с разбивкой по нескольким."""
    matched = [p for p in positions if p.product is not None]
    total_positions = len(positions)

    # Средняя цена по городу — для позиций, которых нет в выбранном магазине
    fallback = {p.product.id: average_price(prices, p.product.id) for p in matched}

    shop_ids = sorted({sid for p in matched for sid in prices.get(p.product.id, {})})

    options: dict = {}

    # --- Стратегия «всё в одном магазине» ---
    single_best = None
    for shop_id in shop_ids:
        total = 0.0
        covered = 0
        for position in matched:
            price = _position_price(prices, shop_id, position)
            if price is None:
                continue
            covered += 1
            total += price * _quantity_multiplier(position)
        if covered == 0:
            continue
        # Штраф за неполное покрытие: недостающее считаем по средней цене
        for position in matched:
            if _position_price(prices, shop_id, position) is None:
                avg = fallback.get(position.product.id)
                if avg:
                    total += avg * _quantity_multiplier(position)
        score = (covered, -total)
        if single_best is None or score > single_best[0]:
            single_best = (score, shop_id, total, covered)

    if single_best:
        _, shop_id, total, covered = single_best
        lines = _lines_for_shop(matched, prices, shops, shop_id, fallback)
        options['single'] = BasketOption(
            strategy='single',
            shops=[shops[shop_id].__dict__] if shop_id in shops else [],
            lines=lines,
            total=total,
            coverage=covered,
            total_positions=total_positions,
            missing_positions=len(matched) - covered,
        )

    # --- Стратегия «разложить по магазинам» ---
    if shop_ids:
        split = _greedy_split(matched, prices, shops, fallback, max_shops)
        if split:
            single_total = options['single'].total if 'single' in options else None
            if single_total:
                split.savings = max(0.0, single_total - split.total)
            split.total_positions = total_positions
            options['split'] = split

    return options


def _quantity_multiplier(position: RecipePosition) -> float:
    """Во сколько базовых единиц продукта обходится позиция.

    Цена в справочнике указана за базовую единицу (1 кг, 1 л, 1 шт, 1 упаковка).
    Поэтому «400 г макарон» при упаковке 400 г — это ровно одна упаковка,
    а «4 шт» яиц при упаковке 10 шт — 0,4 упаковки.
    """
    product = position.product
    if product is None:
        return 1.0

    quantity = position.quantity
    if quantity is None:
        return 1.0

    unit = (position.unit or '').lower().replace('.', '').replace(' ', '')
    base = product.unit

    if base in ('кг', 'л'):
        grams = position.grams if position.grams is not None else quantity * 1000.0
        return max(0.02, grams / 1000.0)

    if base == 'шт':
        if unit in ('', 'шт'):
            return max(0.25, quantity)
        mass = unit_mass(product)
        grams = position.grams or 0.0
        return max(0.1, grams / mass)

    if base in ('упак', 'уп'):
        if unit in ('', 'уп', 'упак'):
            return max(0.25, quantity)
        if unit == 'шт':
            # Штучный товар в упаковке: яйца, сосиски
            if product.pack_units and product.pack_units > 1:
                return max(0.05, quantity / float(product.pack_units))
            return max(0.25, quantity)
        pack = float(product.pack_size or DEFAULT_UNIT_GRAMS)
        grams = position.grams or 0.0
        return max(0.05, grams / pack)

    if base == 'пучок':
        if unit in ('', 'пучок', 'шт'):
            return max(0.25, quantity)
        pack = float(product.pack_size or 50.0)
        grams = position.grams or 0.0
        return max(0.05, grams / pack)

    return 1.0


def _lines_for_shop(matched, prices, shops, shop_id, fallback) -> list[BasketLine]:
    lines: list[BasketLine] = []
    for position in matched:
        price = _position_price(prices, shop_id, position)
        missing = price is None
        if missing:
            price = fallback.get(position.product.id)
        multiplier = _quantity_multiplier(position)
        lines.append(
            BasketLine(
                product_id=position.product.id,
                name=position.product.name,
                quantity=position.quantity,
                unit=position.unit or position.product.unit,
                shop_id=shop_id if not missing else None,
                shop_name=shops[shop_id].name if shop_id in shops else None,
                price=round(price, 2) if price is not None else None,
                line_total=round(price * multiplier, 2) if price is not None else None,
                missing=missing,
            )
        )
    return lines


def _greedy_split(matched, prices, shops, fallback, max_shops: int) -> Optional[BasketOption]:
    """Жадный алгоритм: стартуем с лучшей цены на каждую позицию и постепенно
    сокращаем число магазинов до max_shops, отбрасывая наименее выгодный."""
    # Лучший магазин для каждой позиции
    assignment: dict = {}
    for position in matched:
        per_shop = prices.get(position.product.id, {})
        if not per_shop:
            continue
        shop_id = min(per_shop, key=lambda sid: per_shop[sid])
        assignment[position.product.id] = shop_id

    used = set(assignment.values())

    while len(used) > max_shops:
        # Потери при исключении магазина: насколько дороже станет каждая позиция
        best_drop = None
        for shop_id in used:
            loss = 0.0
            for position in matched:
                if assignment.get(position.product.id) != shop_id:
                    continue
                alternatives = [
                    price
                    for sid, price in prices.get(position.product.id, {}).items()
                    if sid in used and sid != shop_id
                ]
                if not alternatives:
                    loss += 10 ** 6  # исключать нельзя: позиция больше нигде не встречается
                    break
                loss += (min(alternatives) - prices[position.product.id][shop_id]) * _quantity_multiplier(position)
            if best_drop is None or loss < best_drop[0]:
                best_drop = (loss, shop_id)
        if best_drop is None or best_drop[0] >= 10 ** 6:
            break
        used.discard(best_drop[1])
        # Переназначаем позиции внутри оставшихся магазинов
        for position in matched:
            per_shop = prices.get(position.product.id, {})
            candidates = {sid: price for sid, price in per_shop.items() if sid in used}
            if candidates:
                assignment[position.product.id] = min(candidates, key=lambda sid: candidates[sid])

    total = 0.0
    covered = 0
    lines: list[BasketLine] = []
    for position in matched:
        shop_id = assignment.get(position.product.id)
        price = prices.get(position.product.id, {}).get(shop_id) if shop_id else None
        missing = price is None
        if missing:
            shop_id = None
            price = fallback.get(position.product.id)
        else:
            covered += 1
        multiplier = _quantity_multiplier(position)
        if price is not None:
            total += price * multiplier
        lines.append(
            BasketLine(
                product_id=position.product.id,
                name=position.product.name,
                quantity=position.quantity,
                unit=position.unit or position.product.unit,
                shop_id=shop_id,
                shop_name=shops[shop_id].name if shop_id in shops else None,
                price=round(price, 2) if price is not None else None,
                line_total=round(price * multiplier, 2) if price is not None else None,
                missing=missing,
            )
        )

    shop_list = []
    for shop_id in sorted(used):
        subtotal = sum(
            line.line_total or 0 for line in lines if line.shop_id == shop_id
        )
        shop_list.append({**shops[shop_id].__dict__, 'subtotal': round(subtotal, 2)})

    return BasketOption(
        strategy='split',
        shops=shop_list,
        lines=lines,
        total=total,
        coverage=covered,
    )


# ---------- КБЖУ ----------


def nutrition(positions: list[RecipePosition], servings: int = 1) -> dict:
    """Приблизительное КБЖУ на порцию (по сопоставленным продуктам)."""
    totals = {'kcal': 0.0, 'protein': 0.0, 'fat': 0.0, 'carbs': 0.0}
    matched_grams = 0.0

    for position in positions:
        product = position.product
        if product is None or position.grams is None:
            continue
        factor = position.grams / 100.0
        matched_grams += position.grams
        totals['kcal'] += (product.kcal_per_100 or 0) * factor
        totals['protein'] += (product.protein_per_100 or 0) * factor
        totals['fat'] += (product.fat_per_100 or 0) * factor
        totals['carbs'] += (product.carbs_per_100 or 0) * factor

    servings = max(1, int(servings or 1))
    return {
        'kcal': round(totals['kcal'] / servings, 1),
        'protein': round(totals['protein'] / servings, 1),
        'fat': round(totals['fat'] / servings, 1),
        'carbs': round(totals['carbs'] / servings, 1),
        'matched_grams': round(matched_grams, 1),
    }


# ---------- Индекс Recartly ----------


def compute_ri(
    reactions: list[Reaction],
    price_per_serving: Optional[float],
    city_avg_per_serving: Optional[float] = None,
    smoothing: int = 5,
) -> dict:
    """Индекс Recartly 0–100.

    Складывается из качества (оценки «вкусно/выгодно/просто») и объективной выгоды
    (насколько ₽/порция ниже средней по городу). Голоса тех, кто реально приготовил
    (`cooked`), весят вдвое. Сглаживание не даёт одному голосу дать 100.
    """
    taste_sum = value_sum = simple_sum = 0.0
    weight_total = 0.0
    cooked = 0

    for reaction in reactions:
        weight = 2.0 if reaction.cooked else 1.0
        if reaction.cooked:
            cooked += 1
        if reaction.taste:
            taste_sum += reaction.taste * weight
        if reaction.value:
            value_sum += reaction.value * weight
        if reaction.simplicity:
            simple_sum += reaction.simplicity * weight
        weight_total += weight

    if weight_total:
        quality = ((taste_sum * 0.5 + value_sum * 0.3 + simple_sum * 0.2) / (weight_total * 5)) * 100
    else:
        quality = 50.0

    value_index = 50.0
    if price_per_serving and city_avg_per_serving:
        ratio = price_per_serving / city_avg_per_serving
        # Дешевле средней на 30 % и более → 100, дороже на 30 % → 0
        value_index = max(0.0, min(100.0, (1.3 - ratio) / 0.6 * 100))

    raw = quality * 0.75 + value_index * 0.25
    n = len(reactions)
    ri = (n / (n + smoothing)) * raw + (smoothing / (n + smoothing)) * 50

    return {
        'ri': round(ri, 1),
        'quality': round(quality, 1),
        'value_index': round(value_index, 1),
        'reactions_count': n,
        'cooked_count': cooked,
        'avg_taste': round(taste_sum / weight_total, 2) if weight_total else None,
        'avg_value': round(value_sum / weight_total, 2) if weight_total else None,
        'avg_simplicity': round(simple_sum / weight_total, 2) if weight_total else None,
    }


# ---------- Сводка по рецепту для ленты и бюджетного подбора ----------


def recipe_cost_summary(
    db: Session,
    recipe: Recipe,
    city_id: Optional[int],
    product_index: Optional[dict] = None,
    max_shops: int = 3,
) -> dict:
    """Полная смета рецепта: варианты корзины, ₽/порция и КБЖУ."""
    product_index = product_index if product_index is not None else build_product_index(db)
    positions = recipe_positions(recipe, product_index)

    product_ids = [p.product.id for p in positions if p.product]
    prices, shops = load_price_map(db, city_id, product_ids)
    options = build_options(positions, prices, shops, max_shops=max_shops)

    single = options.get('single')
    split = options.get('split')
    best_total = min(
        [opt.total for opt in (single, split) if opt is not None] or [0.0]
    )
    servings = max(1, int(recipe.servings or 1))

    return {
        'positions': len(positions),
        'matched_positions': len([p for p in positions if p.product]),
        'servings': servings,
        'single': single.as_dict() if single else None,
        'split': split.as_dict() if split else None,
        'best_total': round(best_total, 2),
        'price_per_serving': round(best_total / servings, 2) if best_total else None,
        'savings': round((single.total - split.total), 2) if single and split else 0.0,
        'nutrition': nutrition(positions, servings),
    }
