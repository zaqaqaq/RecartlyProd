"""Демо-контент для «Сметы»: реалистичные рецепты с ингредиентами, КБЖУ и сметой.

Идемпотентно: рецепты с такими же названиями повторно не создаются.

Запуск:
    .venv\\Scripts\\python.exe backend\\scripts\\seed_demo.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault(
    'DATABASE_URL', 'postgresql://recartly:recartly123@localhost:5432/recartly'
)

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.models.geo import City  # noqa: E402
from app.models.ingredient import Ingredient  # noqa: E402
from app.models.recipe import Recipe  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services import pricing_service  # noqa: E402

# (название, описание, шаги, категория, порции, время, сложность, сезон, ингредиенты)
DEMO_RECIPES = [
    (
        'Куриный суп с картофелем',
        'Домашний суп на курином бедре — сытно, просто и недорого. Хорош для ужина в будни.',
        '1. Куриное бедро залить 2 л воды, довести до кипения и варить 30 минут.\n'
        '2. Достать мясо, отделить от кости и вернуть в бульон.\n'
        '3. Картофель нарезать кубиками, морковь — кружочками, лук — мелко.\n'
        '4. Добавить овощи в бульон и варить 20 минут до готовности картофеля.\n'
        '5. Посолить, добавить зелень и дать настояться 10 минут.',
        'Суп',
        4,
        50,
        1,
        '10,11,12,1,2,3',
        [
            ('Куриное бедро', '500 г'),
            ('Картофель', '500 г'),
            ('Морковь', '150 г'),
            ('Лук репчатый', '1 шт'),
            ('Зелень свежая', '1 пучок'),
            ('Соль', '5 г'),
        ],
    ),
    (
        'Паста с курицей в томатном соусе',
        'Быстрый ужин из того, что есть в любом магазине. Готовится за полчаса.',
        '1. Макароны отварить в подсоленной воде до аль денте.\n'
        '2. Куриную грудку нарезать кубиками и обжарить на масле 7 минут.\n'
        '3. Добавить лук и чеснок, готовить ещё 3 минуты.\n'
        '4. Влить томаты в собственном соку, тушить 10 минут.\n'
        '5. Соединить с макаронами, посыпать тёртым сыром.',
        'Ужин',
        3,
        30,
        1,
        None,
        [
            ('Макароны', '400 г'),
            ('Куриная грудка', '400 г'),
            ('Томаты в собственном соку', '1 шт'),
            ('Лук репчатый', '1 шт'),
            ('Чеснок', '3 шт'),
            ('Масло растительное', '30 мл'),
            ('Сыр твёрдый', '50 г'),
            ('Соль', '5 г'),
        ],
    ),
    (
        'Гречка с грибами',
        'Постное блюдо: гречка, шампиньоны и лук. Дешёвый и сытный вариант.',
        '1. Гречку промыть и отварить в пропорции 1:2.\n'
        '2. Шампиньоны нарезать пластинами, лук — полукольцами.\n'
        '3. Обжарить лук на масле до прозрачности, добавить грибы.\n'
        '4. Готовить грибы 10 минут, посолить.\n'
        '5. Смешать с гречкой и прогреть под крышкой 5 минут.',
        'Ужин',
        3,
        35,
        1,
        '9,10,11',
        [
            ('Гречка', '300 г'),
            ('Шампиньоны', '400 г'),
            ('Лук репчатый', '2 шт'),
            ('Масло растительное', '30 мл'),
            ('Соль', '5 г'),
        ],
    ),
    (
        'Омлет с сыром',
        'Завтрак за десять минут: яйца, молоко и сыр.',
        '1. Яйца взбить с молоком и щепоткой соли.\n'
        '2. Растопить сливочное масло на сковороде.\n'
        '3. Влить яичную смесь и готовить на среднем огне 3 минуты.\n'
        '4. Посыпать тёртым сыром, накрыть крышкой и довести до готовности.',
        'Завтрак',
        2,
        10,
        1,
        None,
        [
            ('Яйца куриные', '4 шт'),
            ('Молоко 2,5%', '100 мл'),
            ('Сыр твёрдый', '60 г'),
            ('Масло сливочное', '20 г'),
            ('Соль', '2 г'),
        ],
    ),
    (
        'Овощной салат с маслом',
        'Лёгкий салат: помидоры, огурцы и зелень. Готовится за пять минут.',
        '1. Помидоры и огурцы нарезать крупными кусками.\n'
        '2. Зелень мелко порубить.\n'
        '3. Заправить маслом, посолить и аккуратно перемешать.',
        'Салат',
        2,
        5,
        1,
        '6,7,8,9',
        [
            ('Помидоры', '300 г'),
            ('Огурцы', '300 г'),
            ('Зелень свежая', '1 пучок'),
            ('Масло растительное', '20 мл'),
            ('Соль', '3 г'),
        ],
    ),
]


def main() -> int:
    engine = create_engine(os.environ['DATABASE_URL'])
    Session = sessionmaker(bind=engine)
    db = Session()

    user = db.query(User).order_by(User.id).first()
    if user is None:
        print('В БД нет пользователей — сначала зарегистрируйте хотя бы одного.')
        return 1

    city = db.query(City).filter(City.slug == 'moskva').first()
    product_index = pricing_service.build_product_index(db)

    print(f'Автор: {user.username} (id={user.id}); город расчёта: {city.name if city else "—"}')

    created = 0
    for (
        title,
        description,
        instructions,
        category,
        servings,
        cook_time,
        difficulty,
        season,
        ingredients,
    ) in DEMO_RECIPES:
        exists = db.query(Recipe).filter(Recipe.title == title).first()
        if exists:
            recipe = exists
            print(f'  = уже есть: {title}')
        else:
            recipe = Recipe(
                title=title,
                description=description,
                instructions=instructions,
                user_id=user.id,
                servings=servings,
                cook_time_min=cook_time,
                difficulty=difficulty,
                category=category,
                season_months=season,
                status='published',
                is_verified=True,
                city_id=city.id if city else None,
            )
            db.add(recipe)
            db.flush()
            for name, quantity in ingredients:
                db.add(Ingredient(name=name, quantity=quantity, recipe_id=recipe.id))
            db.commit()
            db.refresh(recipe)
            created += 1
            print(f'  + создан: {title}')

        # Считаем смету и КБЖУ, записываем в рецепт
        summary = pricing_service.recipe_cost_summary(
            db, recipe, city.id if city else None, product_index=product_index
        )
        nutrition = summary['nutrition']
        recipe.kcal_per_serving = nutrition['kcal']
        recipe.protein_per_serving = nutrition['protein']
        recipe.fat_per_serving = nutrition['fat']
        recipe.carbs_per_serving = nutrition['carbs']
        recipe.ri_score = 50 + (summary['price_per_serving'] or 0) * 0  # база до реакций
        db.commit()

        single = summary['single']
        split = summary['split']
        print(
            f'      {summary["price_per_serving"]} ₽/порция | '
            f'один магазин: {single["total"] if single else "—"} ₽ | '
            f'сплит: {split["total"] if split else "—"} ₽ '
            f'(экономия {summary["savings"]} ₽) | '
            f'{nutrition["kcal"]} ккал, Б{nutrition["protein"]} Ж{nutrition["fat"]} У{nutrition["carbs"]}'
        )

    print(f'\nСоздано рецептов: {created}')
    db.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
