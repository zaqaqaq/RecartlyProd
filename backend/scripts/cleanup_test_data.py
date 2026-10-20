"""Уборка тестовых данных, оставшихся от проверок.

Удаляет служебных пользователей (`notif%`, `notifc%`) вместе с их контентом и рецепты,
созданные аудитом (`АУДИТ:%`, «Тестовый рецепт для модерации»).
По умолчанию только показывает, что будет удалено; для удаления нужен флаг --apply.

Порядок удаления важен: сначала зависимые записи, потом сами сущности — иначе
внешние ключи (они без ON DELETE CASCADE) не дадут удалить пользователя.

Запуск:
    .venv\\Scripts\\python.exe backend\\scripts\\cleanup_test_data.py --apply
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault(
    'DATABASE_URL', 'postgresql://recartly:recartly123@localhost:5432/recartly'
)

import psycopg2  # noqa: E402

TEST_EMAIL_PATTERNS = ('notif%@recartly.ru', 'notifc%@recartly.ru')
TEST_RECIPE_TITLES = ('АУДИТ:%', 'Тестовый рецепт для модерации')

# Таблицы с ссылкой на пользователя: (таблица, колонки)
USER_REFERENCES = [
    ('notifications', ('user_id', 'actor_id')),
    ('reactions', ('user_id',)),
    ('comments', ('user_id',)),
    ('favorites', ('user_id',)),
    ('achievements', ('user_id',)),
    ('challenge_entries', ('user_id',)),
    ('meal_plans', ('user_id',)),
    ('pantry_items', ('user_id',)),
    ('baskets', ('user_id',)),
    ('reviews', ('user_id',)),
    ('cart_comments', ('user_id',)),
    ('cart_likes', ('user_id',)),
    ('shopping_carts', ('user_id',)),
    ('moderation_tasks', ('author_id', 'moderator_id')),
    ('reports', ('reporter_id', 'moderator_id')),
    ('price_quotes', ('reported_by',)),
    ('user_sanctions', ('user_id', 'issued_by')),
]

RECIPE_REFERENCES = [
    ('reactions', ('recipe_id',)),
    ('cooked_photos', ('recipe_id',)),
    ('comments', ('recipe_id',)),
    ('favorites', ('recipe_id',)),
    ('ingredients', ('recipe_id',)),
    ('meal_plan_items', ('recipe_id',)),
    ('challenge_entries', ('recipe_id',)),
    ('baskets', ('recipe_id',)),
    ('price_quotes', ()),  # по recipe_id не связаны, оставлено для наглядности
]


def delete_recipe(cur, recipe_id: int) -> None:
    """Удаляет рецепт вместе со зависимостями (внешние ключи без CASCADE)."""
    for table, columns in RECIPE_REFERENCES:
        for column in columns:
            cur.execute(f'DELETE FROM {table} WHERE {column} = %s', (recipe_id,))
    cur.execute(
        "DELETE FROM moderation_tasks WHERE target_type = 'recipe' AND target_id = %s",
        (recipe_id,),
    )
    cur.execute('DELETE FROM recipes WHERE id = %s', (recipe_id,))


def cleanup_dangling_tasks(cur) -> int:
    """Удаляет задачи модерации, чей объект уже удалён.

    Такие задачи появляются, если автор удалил публикацию, пока она была на проверке:
    в очереди остаётся запись с пустым превью.
    """
    pairs = [
        ('recipe', 'recipes'),
        ('promo', 'promos'),
        ('price', 'price_quotes'),
        ('review', 'reviews'),
    ]
    removed = 0
    for target_type, table in pairs:
        # Таблицы могло не стать после переделки концепции (например, корзины)
        exists = cur.execute('SELECT to_regclass(%s)', (f'public.{table}',))
        if cur.fetchone()[0] is None:
            continue
        cur.execute(
            f"DELETE FROM moderation_tasks WHERE target_type = %s "
            f"AND target_id IS NOT NULL AND target_id NOT IN (SELECT id FROM {table})",
            (target_type,),
        )
        removed += cur.rowcount
    return removed


def main() -> int:
    apply = '--apply' in sys.argv

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    cur = conn.cursor()

    cur.execute(
        'SELECT id, email, username FROM users WHERE '
        + ' OR '.join(['email LIKE %s'] * len(TEST_EMAIL_PATTERNS)),
        TEST_EMAIL_PATTERNS,
    )
    users = cur.fetchall()

    cur.execute(
        'SELECT id, title FROM recipes WHERE '
        + ' OR '.join(['title LIKE %s'] * len(TEST_RECIPE_TITLES)),
        TEST_RECIPE_TITLES,
    )
    recipes = cur.fetchall()

    print(f'Тестовых пользователей: {len(users)}')
    for user in users:
        print(f'  #{user[0]} {user[1]} ({user[2]})')
    print(f'Тестовых рецептов: {len(recipes)}')
    for recipe in recipes:
        print(f'  #{recipe[0]} {recipe[1]}')

    if not apply:
        print('\nЭто предпросмотр. Запустите с --apply, чтобы удалить.')
        cur.close()
        conn.close()
        return 0

    dangling = cleanup_dangling_tasks(cur)
    if dangling:
        print(f'Висячих задач модерации удалено: {dangling}')

    user_ids = [user[0] for user in users]
    recipe_ids = [recipe[0] for recipe in recipes]

    for user_id in user_ids:
        # Сначала все рецепты автора (в том числе созданные для проверок),
        # иначе внешний ключ не даст удалить пользователя
        cur.execute('SELECT id FROM recipes WHERE user_id = %s', (user_id,))
        for (recipe_id,) in cur.fetchall():
            delete_recipe(cur, recipe_id)

        for table, columns in USER_REFERENCES:
            for column in columns:
                cur.execute(f'DELETE FROM {table} WHERE {column} = %s', (user_id,))

    for recipe_id in recipe_ids:
        # Рецепты аудита могли остаться от других авторов
        cur.execute('SELECT 1 FROM recipes WHERE id = %s', (recipe_id,))
        if cur.fetchone():
            delete_recipe(cur, recipe_id)

    for user_id in user_ids:
        cur.execute('DELETE FROM users WHERE id = %s', (user_id,))

    conn.commit()
    print(f'\nУдалено: пользователей {len(user_ids)}, рецептов {len(recipe_ids)}')

    cur.close()
    conn.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
