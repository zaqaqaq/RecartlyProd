"""Проверка расчётов «Сметы» на реальных данных БД.

Запуск:
    .venv\\Scripts\\python.exe backend\\scripts\\smoke_pricing.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import psycopg2  # noqa: E402

os.environ.setdefault(
    'DATABASE_URL', 'postgresql://recartly:recartly123@localhost:5432/recartly'
)

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.models.recipe import Recipe  # noqa: E402
from app.models.geo import City  # noqa: E402
from app.services import pricing_service  # noqa: E402


def main() -> int:
    engine = create_engine(os.environ['DATABASE_URL'])
    Session = sessionmaker(bind=engine)
    db = Session()

    city = db.query(City).filter(City.slug == 'moskva').first()
    recipes = db.query(Recipe).all()

    print(f'Город: {city.name if city else "не найден"} (id={city.id if city else "-"})')
    print(f'Рецептов в БД: {len(recipes)}')

    product_index = pricing_service.build_product_index(db)
    print(f'Продуктов в индексе (с алиасами): {len(product_index)}')

    for recipe in recipes:
        print('\n' + '=' * 62)
        print(f'Рецепт #{recipe.id}: {recipe.title} (порций: {recipe.servings})')
        for ingredient in recipe.ingredients:
            amount, unit = pricing_service.parse_quantity(ingredient.quantity)
            product = pricing_service.match_product(product_index, ingredient.name)
            grams = pricing_service.to_grams(product, amount, unit)
            print(
                f'  • {ingredient.name!r} ({ingredient.quantity!r}) → '
                f'продукт: {product.name if product else "НЕ СОПОСТАВЛЕН"}, '
                f'кол-во: {amount} {unit or ""}, масса: {grams} г'
            )

        summary = pricing_service.recipe_cost_summary(db, recipe, city.id if city else None)

        print(f'  позиций: {summary["positions"]}, сопоставлено: {summary["matched_positions"]}')
        print(f'  КБЖУ на порцию: {summary["nutrition"]}')

        single = summary['single']
        if single:
            shops = ', '.join(s['name'] for s in single['shops']) or '—'
            print(f'  Один магазин: {single["total"]} ₽ ({shops}), покрытие {single["coverage"]}')
        split = summary['split']
        if split:
            shops = ', '.join(f'{s["name"]} {s["subtotal"]}₽' for s in split['shops'])
            print(f'  Сплит:        {split["total"]} ₽ [{shops}], покрытие {split["coverage"]}')
            print(f'  Экономия сплита: {summary["savings"]} ₽')
        print(f'  Лучшая цена: {summary["best_total"]} ₽ → {summary["price_per_serving"]} ₽/порция')

    db.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
