"""Удаление тестовых рецептов-мусора («sda», «Название рецепта») вместе со связями."""

import os
import sys

import psycopg2

sys.stdout.reconfigure(encoding='utf-8')
DATABASE_URL = os.getenv('DATABASE_URL', 'postgresql://recartly:recartly123@localhost:5432/recartly')
JUNK_IDS = (1, 6)

conn = psycopg2.connect(DATABASE_URL)
cur = conn.cursor()

for table, column in (
    ('ingredients', 'recipe_id'),
    ('comments', 'recipe_id'),
    ('favorites', 'recipe_id'),
    ('reactions', 'recipe_id'),
    ('cooked_photos', 'recipe_id'),
    ('baskets', 'recipe_id'),
):
    try:
        cur.execute(f'DELETE FROM {table} WHERE {column} IN %s', (JUNK_IDS,))
    except Exception as exc:  # noqa: BLE001 — таблицы может не быть
        print(f'  {table}: пропущено ({exc.__class__.__name__})')
        conn.rollback()

cur.execute('DELETE FROM recipes WHERE id IN %s', (JUNK_IDS,))
print('Удалено рецептов:', cur.rowcount)

conn.commit()
cur.execute('SELECT count(*) FROM recipes')
print('Рецептов осталось:', cur.fetchone()[0])
cur.execute('SELECT count(*) FROM baskets WHERE is_public')
print('Публичных наборов:', cur.fetchone()[0])
cur.execute('SELECT id, title, basket_id FROM recipes ORDER BY id')
for row in cur.fetchall():
    print('  рецепт', row)

cur.close()
conn.close()
