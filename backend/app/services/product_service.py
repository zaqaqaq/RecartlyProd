"""Продукты: нормализация названий, защита от дублей и пищевая ценность.

Три задачи сервиса:

1. **Единый вид названия.** «творог 9%», «Творог9 процентов» и «ТВОРОГ 9 %» —
   один и тот же продукт. От этого зависит и поиск, и корректное усреднение КБЖУ.
2. **Защита от дублей.** При создании продукта сначала ищем точное совпадение,
   затем похожие названия (опечатки вроде «творогг»), и только потом создаём новый.
3. **Пищевая ценность.** Пользователи вводят КБЖУ с упаковки; если записей несколько,
   берётся медиана (одна опечатка не портит расчёт). Если записей нет — справочные
   значения из самого продукта.
"""

import re
from difflib import SequenceMatcher
from statistics import median
from typing import Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.product import Product, ProductNutrition
from app.models.user import User

# Латинские буквы-двойники кириллицы: частая ошибка при переключении раскладки
LATIN_TO_CYRILLIC = {
    'a': 'а', 'e': 'е', 'o': 'о', 'p': 'р', 'c': 'с', 'x': 'х',
    'y': 'у', 'k': 'к', 'm': 'м', 't': 'т', 'h': 'н', 'b': 'в',
}

# «процентов», «проц.» и «процент» приводим к знаку %
PERCENT_WORDS = re.compile(r'\s*(процентов|процента|проценты|проц\.?|процент)\s*', re.IGNORECASE)

WHITESPACE = re.compile(r'\s+')
# Числовой модификатор названия: жирность, объём, процент («9%», «2,5»)
VARIANT = re.compile(r'\d+(?:[.,]\d+)?')
# Пробел между словом и числом: «Творог9» → «Творог 9»
LETTER_DIGIT = re.compile(r'([^\W\d_])(\d)', re.UNICODE)
DIGIT_LETTER = re.compile(r'(\d)([^\W\d_])', re.UNICODE)
# Склеенный знак процента: «9 %» и «9%» — одно и то же
SPACE_BEFORE_PERCENT = re.compile(r'\s*%\s*')


def normalize_product_name(value: Optional[str]) -> str:
    """Приводит название продукта к единому виду.

    «творог9 процентов» → «Творог 9%», «ТВОРОГ 9 %» → «Творог 9%».
    """
    if not value:
        return ''

    text = value.strip()
    text = PERCENT_WORDS.sub('%', text)
    text = WHITESPACE.sub(' ', text)
    text = LETTER_DIGIT.sub(r'\1 \2', text)
    text = DIGIT_LETTER.sub(r'\1 \2', text)
    text = SPACE_BEFORE_PERCENT.sub('%', text)
    text = _fix_keyboard_layout(text)

    text = WHITESPACE.sub(' ', text).strip(' .,;')

    words = [word for word in text.split(' ') if word]
    if not words:
        return ''

    # С большой буквы — только первое слово: «лук репчатый» → «Лук репчатый»
    first = _capitalize_word(words[0])
    rest = [_lower_word(word) for word in words[1:]]
    return ' '.join([first, *rest])


def _capitalize_word(word: str) -> str:
    """«творог» → «Творог», «9%» → «9%» (знак процента сохраняется)."""
    if not word:
        return word

    has_percent = '%' in word
    core = word.replace('%', '')
    core = core[:1].upper() + core[1:].lower() if core else core
    return f'{core}%' if has_percent else core


def _lower_word(word: str) -> str:
    """Приводит слово к нижнему регистру, сохраняя знак процента."""
    has_percent = '%' in word
    core = word.replace('%', '').lower()
    return f'{core}%' if has_percent else core


def _fix_keyboard_layout(text: str) -> str:
    """Заменяет латинские двойники кириллицы, но только внутри русских названий.

    «Tворог» → «Творог», при этом «Coca-Cola» не трогаем: там нет кириллицы.
    """
    if not re.search(r'[а-яё]', text, re.IGNORECASE):
        return text

    result = []
    for char in text:
        lower = char.lower()
        cyrillic = LATIN_TO_CYRILLIC.get(lower)
        if cyrillic is None:
            result.append(char)
        else:
            result.append(cyrillic.upper() if char.isupper() else cyrillic)
    return ''.join(result)


def search_key(value: Optional[str]) -> str:
    """Ключ для сравнения названий: регистр и лишние пробелы не важны."""
    return normalize_product_name(value).lower()


def _variants(value: str) -> set:
    """Числовые модификаторы названия: «Творог 9%» → {'9'}."""
    return {match.replace(',', '.') for match in VARIANT.findall(value or '')}


def similarity(left: str, right: str) -> float:
    """Похожесть двух названий от 0 до 1 (для подсказок об опечатках).

    Разные числовые модификаторы — это разные продукты, а не опечатка:
    «Творог 9%» и «Творог 5%» похожи по буквам, но усреднять их КБЖУ нельзя.
    """
    base = SequenceMatcher(None, search_key(left), search_key(right)).ratio()

    left_variants = _variants(search_key(left))
    right_variants = _variants(search_key(right))
    if left_variants and right_variants and left_variants != right_variants:
        return base * 0.5

    return base


def find_exact(db: Session, name: str) -> Optional[Product]:
    """Точное совпадение по нормализованному названию."""
    key = search_key(name)
    if not key:
        return None
    return (
        db.query(Product)
        .filter(func.lower(Product.normalized_name) == key)
        .order_by(Product.id)
        .first()
    )


def find_similar(db: Session, name: str, limit: int = 5, threshold: float = 0.72) -> List[Product]:
    """Похожие продукты — подсказка «возможно, вы имели в виду».

    Автоматически не склеиваем: автор сам подтверждает, что это тот же продукт.
    """
    key = search_key(name)
    if not key:
        return []

    candidates = db.query(Product).all()
    scored = []
    for product in candidates:
        ratio = similarity(product.name or '', name)
        if ratio >= threshold:
            scored.append((ratio, product))

    scored.sort(key=lambda pair: (-pair[0], pair[1].id))
    return [product for _, product in scored[:limit]]


def nutrition_summary(db: Session, product: Product) -> Dict[str, object]:
    """КБЖУ продукта: медиана записей пользователей, иначе справочные значения.

    Всегда на 100 г / 100 мл — иначе усреднять значения нельзя.
    """
    records = (
        db.query(ProductNutrition)
        .filter(ProductNutrition.product_id == product.id)
        .all()
    )

    def pick(field: str, fallback: Optional[float]) -> Optional[float]:
        values = [getattr(record, field) for record in records if getattr(record, field) is not None]
        if not values:
            return fallback
        return round(median(values), 1)

    return {
        'kcal': pick('kcal', product.kcal_per_100),
        'protein': pick('protein', product.protein_per_100),
        'fat': pick('fat', product.fat_per_100),
        'carbs': pick('carbs', product.carbs_per_100),
        # Сколько записей от пользователей — показываем как основание расчёта
        'samples': len(records),
        'source': 'users' if records else ('reference' if product.kcal_per_100 else 'unknown'),
    }


def find_or_create(
    db: Session,
    name: str,
    user: Optional[User] = None,
    category: Optional[str] = None,
    unit: Optional[str] = None,
    nutrition: Optional[Dict[str, Optional[float]]] = None,
) -> Product:
    """Возвращает продукт по названию, создавая его при необходимости.

    Если название уже есть (в едином виде) — используем существующий продукт,
    чтобы КБЖУ и цены накапливались в одном месте, а не расползались по дублям.
    """
    normalized = normalize_product_name(name)
    existing = find_exact(db, normalized)
    if existing is not None:
        if nutrition and any(value is not None for value in nutrition.values()):
            db.add(
                ProductNutrition(
                    product_id=existing.id,
                    user_id=user.id if user else None,
                    kcal=nutrition.get('kcal'),
                    protein=nutrition.get('protein'),
                    fat=nutrition.get('fat'),
                    carbs=nutrition.get('carbs'),
                )
            )
            db.commit()
        return existing

    product = Product(
        name=normalized or (name or '').strip(),
        normalized_name=normalized,
        category=category,
        unit=unit or 'шт',
    )
    if nutrition:
        product.kcal_per_100 = nutrition.get('kcal')
        product.protein_per_100 = nutrition.get('protein')
        product.fat_per_100 = nutrition.get('fat')
        product.carbs_per_100 = nutrition.get('carbs')
        product.is_verified = False

    db.add(product)
    db.commit()
    db.refresh(product)

    if nutrition and any(value is not None for value in nutrition.values()):
        db.add(
            ProductNutrition(
                product_id=product.id,
                user_id=user.id if user else None,
                kcal=nutrition.get('kcal'),
                protein=nutrition.get('protein'),
                fat=nutrition.get('fat'),
                carbs=nutrition.get('carbs'),
            )
        )
        db.commit()

    return product
