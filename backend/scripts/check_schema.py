"""Проверка схемы после добавления реакций, магазинов и фото чека."""

import os
import sys

import psycopg2

sys.stdout.reconfigure(encoding='utf-8')
conn = psycopg2.connect(os.getenv('DATABASE_URL', 'postgresql://recartly:recartly123@localhost:5432/recartly'))
cur = conn.cursor()

print('Таблицы:')
for table in ('basket_comment_reactions', 'user_shops', 'baskets', 'shops'):
    cur.execute("SELECT to_regclass(%s)", (f'public.{table}',))
    print(f'  {table}: {"есть" if cur.fetchone()[0] else "НЕТ"}')

print('Колонки:')
for table, column in (
    ('baskets', 'receipt_photo_url'),
    ('baskets', 'photo_url'),
    ('shops', 'is_custom'),
    ('shops', 'created_by'),
):
    cur.execute(
        'SELECT count(*) FROM information_schema.columns WHERE table_name = %s AND column_name = %s',
        (table, column),
    )
    print(f'  {table}.{column}: {"есть" if cur.fetchone()[0] else "НЕТ"}')

print('Данные:')
cur.execute('SELECT count(*) FROM baskets')
print('  наборов:', cur.fetchone()[0])
cur.execute('SELECT count(*) FROM shops WHERE is_custom')
print('  своих магазинов:', cur.fetchone()[0])
cur.execute('SELECT count(*) FROM basket_comment_reactions')
print('  реакций на комментарии:', cur.fetchone()[0])
cur.execute('SELECT count(*) FROM recipes WHERE basket_id IS NULL')
print('  рецептов без набора:', cur.fetchone()[0])

cur.close()
conn.close()
