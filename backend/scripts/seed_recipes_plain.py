"""Демо-рецепты без набора — для раздела «Рецепты».

По концепции блюдо без набора живёт в разделе «Рецепты» и не участвует
в бюджетном подборе. Чтобы этот раздел не был пустым, добавляем два простых
рецепта: автор указал состав и шаги, но закупку не собирал.

Запуск:
    .venv\\Scripts\\python.exe backend\\scripts\\seed_recipes_plain.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

import app.models  # noqa: E402,F401
from app.models.ingredient import Ingredient  # noqa: E402
from app.models.recipe import Recipe  # noqa: E402
from app.models.user import User  # noqa: E402

DATABASE_URL = os.getenv(
    'DATABASE_URL', 'postgresql://recartly:recartly123@localhost:5432/recartly'
)

# Рецепты без набора: состав + шаги, цены не указаны
PLAIN_RECIPES = [
    {
        'title': 'Сырники классические',
        'description': 'Простые сырники на завтрак — творог, яйцо, мука.',
        'instructions': (
            '1. Творог размять с яйцом и сахаром.\n'
            '2. Добавить муку, замесить мягкое тесто.\n'
            '3. Сформировать шайбы, обвалять в муке.\n'
            '4. Обжарить по 3 минуты с каждой стороны на среднем огне.\n'
            '5. Подать со сметаной.'
        ),
        'category': 'завтрак',
        'cook_time_min': 20,
        'difficulty': 1,
        'servings': 3,
        'kcal_per_serving': 280,
        'protein_per_serving': 18,
        'fat_per_serving': 12,
        'carbs_per_serving': 26,
        'ingredients': [
            ('Творог 9%', '400 г'),
            ('Яйцо', '1 шт'),
            ('Мука пшеничная', '3 ст. л.'),
            ('Сахар', '2 ст. л.'),
            ('Сметана', '100 г'),
        ],
    },
    {
        'title': 'Овсяная каша на молоке',
        'description': 'Базовый завтрак: овсянка, молоко и щепотка соли.',
        'instructions': (
            '1. Молоко довести до кипения.\n'
            '2. Всыпать овсяные хлопья, посолить.\n'
            '3. Варить 5–7 минут, помешивая.\n'
            '4. Дать настояться под крышкой 3 минуты.'
        ),
        'category': 'завтрак',
        'cook_time_min': 12,
        'difficulty': 1,
        'servings': 2,
        'kcal_per_serving': 210,
        'protein_per_serving': 8,
        'fat_per_serving': 6,
        'carbs_per_serving': 32,
        'ingredients': [
            ('Овсяные хлопья', '100 г'),
            ('Молоко 2,5%', '500 мл'),
            ('Соль', '1 щепотка'),
        ],
    },
]


def main() -> int:
    engine = create_engine(DATABASE_URL)

    with Session(engine) as db:
        author = db.query(User).order_by(User.id).first()
        if author is None:
            print('Нет пользователей — сначала зарегистрируйтесь')
            return 1

        created = 0
        for data in PLAIN_RECIPES:
            exists = db.query(Recipe).filter(Recipe.title == data['title']).first()
            if exists is not None:
                print(f'  уже есть: {data["title"]}')
                continue

            recipe = Recipe(
                title=data['title'],
                description=data['description'],
                instructions=data['instructions'],
                user_id=author.id,
                servings=data['servings'],
                cook_time_min=data['cook_time_min'],
                difficulty=data['difficulty'],
                category=data['category'],
                kcal_per_serving=data['kcal_per_serving'],
                protein_per_serving=data['protein_per_serving'],
                fat_per_serving=data['fat_per_serving'],
                carbs_per_serving=data['carbs_per_serving'],
                status='published',
                ri_score=52.0,
                # basket_id не задаём: блюдо остаётся в разделе «Рецепты»
            )
            db.add(recipe)
            db.flush()

            for name, quantity in data['ingredients']:
                db.add(Ingredient(recipe_id=recipe.id, name=name, quantity=quantity))

            created += 1
            print(f'  создан рецепт «{recipe.title}» (без набора)')

        db.commit()
        total = db.query(Recipe).filter(Recipe.basket_id.is_(None)).count()
        print(f'Создано: {created}. Рецептов без набора в разделе «Рецепты»: {total}')

    return 0


if __name__ == '__main__':
    sys.exit(main())
