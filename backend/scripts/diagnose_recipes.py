"""Диагностика: последние рецепты, их статусы, автор и шаги."""

import os
import sys

import psycopg2

sys.stdout.reconfigure(encoding='utf-8')
conn = psycopg2.connect(os.getenv('DATABASE_URL', 'postgresql://recartly:recartly123@localhost:5432/recartly'))
cur = conn.cursor()

cur.execute(
    """
    SELECT r.id, r.title, r.status, r.reject_reason, r.created_at,
           u.username, u.trust_score, u.role,
           (SELECT count(*) FROM recipe_steps s WHERE s.recipe_id = r.id) AS steps,
           (SELECT count(*) FROM ingredients i WHERE i.recipe_id = r.id) AS ings
    FROM recipes r LEFT JOIN users u ON u.id = r.user_id
    ORDER BY r.id DESC LIMIT 8
    """
)
print('Последние рецепты:')
for row in cur.fetchall():
    print(
        f'  #{row[0]} «{row[1][:38]}» | {row[2]}'
        f'{" (" + str(row[3])[:40] + ")" if row[3] else ""}'
        f' | автор {row[5]} (trust={row[6]}, роль={row[7]})'
        f' | шагов {row[8]}, ингр. {row[9]} | {row[4]}'
    )

cur.execute("SELECT count(*) FROM recipes WHERE status = 'pending'")
print('Всего pending:', cur.fetchone()[0])

cur.execute('SELECT count(*) FROM recipe_steps')
print('Всего шагов:', cur.fetchone()[0])

cur.execute('SELECT count(*) FROM ingredients WHERE photo_url IS NOT NULL')
print('Ингредиентов с фото:', cur.fetchone()[0])

cur.execute('SELECT count(*) FROM basket_items WHERE photo_url IS NOT NULL')
print('Позиций наборов с фото:', cur.fetchone()[0])

cur.close()
conn.close()
