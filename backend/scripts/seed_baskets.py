"""Наполнение ленты наборами на основе существующих рецептов.

Для каждого опубликованного рецепта собирается набор с ценами магазинов, датой
покупки и числом человек. Набор публикуется, рецепт привязывается к нему —
так блюдо попадает в бюджетный раздел.

Запуск:
    .venv\\Scripts\\python.exe backend\\scripts\\seed_baskets.py
"""

import os
import random
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

import app.models  # noqa: E402,F401
from app.models.basket import Basket, BasketItem  # noqa: E402
from app.models.geo import City  # noqa: E402
from app.models.recipe import Recipe  # noqa: E402
from app.services import pricing_service  # noqa: E402

DATABASE_URL = os.getenv(
    'DATABASE_URL', 'postgresql://recartly:recartly123@localhost:5432/recartly'
)

# Наборы-черновики от прошлых тестов, которые не должны попадать в ленту
JUNK_TITLES = ('Тест', 'тест', 'тест пепе меню', 'Тест набор')


def build_basket_for_recipe(db: Session, recipe: Recipe, city_id: int) -> Basket:
    """Собирает набор под рецепт: продукты, магазины, цены."""
    index = pricing_service.build_product_index(db)
    positions = pricing_service.recipe_positions(recipe, index)
    product_ids = [p.product.id for p in positions if p.product]
    prices, shops = pricing_service.load_price_map(db, city_id, product_ids)
    options = pricing_service.build_options(positions, prices, shops, max_shops=3)

    option = options.get('single') or options.get('split')
    if option is None:
        return None

    # Дата покупки — от 1 до 6 дней назад: цены должны выглядеть свежими
    prices_date = datetime.now(timezone.utc) - timedelta(days=random.randint(1, 6))

    basket = Basket(
        user_id=recipe.user_id,
        recipe_id=recipe.id,
        city_id=city_id,
        title=f'Набор: {recipe.title}',
        description=(
            f'Закупка для «{recipe.title}»: {len(option.lines)} позиций. '
            f'Цены собраны {prices_date.strftime("%d.%m.%Y")}.'
        ),
        strategy='single',
        servings=recipe.servings or 2,
        total_price=round(option.total, 2),
        prices_date=prices_date,
        photo_url=recipe.photo_url,
        is_public=True,
        status='published',
        likes_count=random.randint(2, 24),
        views_count=random.randint(20, 300),
    )
    db.add(basket)
    db.flush()

    for position, line in enumerate(option.lines):
        position_price = line.line_total if line.line_total is not None else line.price
        db.add(
            BasketItem(
                basket_id=basket.id,
                product_id=line.product_id,
                name=line.name,
                quantity=line.quantity,
                unit=line.unit,
                shop_id=line.shop_id,
                price=position_price,
                position=position,
            )
        )

    recipe.basket_id = basket.id
    db.flush()
    return basket


def main() -> int:
    engine = create_engine(DATABASE_URL)

    with Session(engine) as db:
        # 1. Убираем тестовый мусор из ленты
        junk = (
            db.query(Basket)
            .filter(Basket.title.in_(JUNK_TITLES))
            .all()
        )
        for basket in junk:
            db.query(Recipe).filter(Recipe.basket_id == basket.id).update({'basket_id': None})
            db.delete(basket)
        if junk:
            db.flush()
            print(f'Удалено тестовых наборов: {len(junk)}')

        city = db.query(City).order_by(City.id).first()
        if city is None:
            print('Нет городов — сначала выполните migrate_smeta.py')
            return 1

        # 2. Собираем набор для каждого рецепта без набора
        recipes = (
            db.query(Recipe)
            .filter(Recipe.status == 'published')
            .order_by(Recipe.id)
            .all()
        )
        created = 0
        for recipe in recipes:
            existing = (
                db.query(Basket).filter(Basket.recipe_id == recipe.id).first()
            )
            if existing is not None:
                # Набор уже есть — просто публикуем и обновляем дату цен
                existing.is_public = True
                existing.status = 'published'
                existing.servings = recipe.servings or existing.servings
                if existing.prices_date is None:
                    existing.prices_date = datetime.now(timezone.utc) - timedelta(days=2)
                if not existing.title.startswith('Набор'):
                    existing.title = f'Набор: {recipe.title}'
                recipe.basket_id = existing.id
                continue

            basket = build_basket_for_recipe(db, recipe, city.id)
            if basket is None:
                print(f'  рецепт #{recipe.id} «{recipe.title}»: не удалось оценить состав')
                continue
            created += 1
            print(f'  набор «{basket.title}» — {basket.total_price} ₽ на {basket.servings} чел.')

        db.commit()
        total = db.query(Basket).filter(Basket.is_public.is_(True)).count()
        print(f'Создано наборов: {created}. Публичных наборов в ленте: {total}')

    return 0


if __name__ == '__main__':
    sys.exit(main())
