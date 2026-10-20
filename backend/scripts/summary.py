"""Сводка по данным после переделки: наборы, блюда, вырезанные таблицы."""

import os
import sys

import psycopg2

sys.stdout.reconfigure(encoding='utf-8')
conn = psycopg2.connect(os.getenv('DATABASE_URL', 'postgresql://recartly:recartly123@localhost:5432/recartly'))
cur = conn.cursor()

for table in (
    'baskets',
    'basket_items',
    'basket_likes',
    'basket_comments',
    'product_nutrition',
    'recipes',
    'products',
    'users',
):
    try:
        cur.execute(f'SELECT count(*) FROM {table}')
        print(f'  {table}: {cur.fetchone()[0]}')
    except Exception as exc:  # noqa: BLE001
        print(f'  {table}: ошибка ({exc.__class__.__name__})')
        conn.rollback()

cur.execute('SELECT count(*) FROM recipes WHERE basket_id IS NOT NULL')
print('  блюд с набором (в бюджетном разделе):', cur.fetchone()[0])
cur.execute('SELECT count(*) FROM recipes WHERE basket_id IS NULL')
print('  блюд без набора (раздел «Рецепты»):', cur.fetchone()[0])
cur.execute('SELECT count(*) FROM baskets WHERE is_public AND status = %s', ('published',))
print('  публичных наборов в ленте:', cur.fetchone()[0])
cur.execute("SELECT count(*) FROM cities")
print('  городов в справочнике (данные сохранены):', cur.fetchone()[0])

cur.close()
conn.close()
