"""Удаление тестового рецепта «Тест шагов» вместе со связями."""

import os
import sys

import psycopg2

sys.stdout.reconfigure(encoding='utf-8')
conn = psycopg2.connect(os.getenv('DATABASE_URL', 'postgresql://recartly:recartly123@localhost:5432/recartly'))
cur = conn.cursor()

cur.execute("SELECT id FROM recipes WHERE title = %s", ('Тест шагов',))
rows = [row[0] for row in cur.fetchall()]
if not rows:
    print('Тестовый рецепт не найден')
else:
    for table in ('recipe_steps', 'ingredients', 'comments', 'favorites', 'reactions'):
        try:
            cur.execute(f'DELETE FROM {table} WHERE recipe_id = ANY(%s)', (rows,))
        except Exception as exc:  # noqa: BLE001
            print(f'  {table}: пропущено ({exc.__class__.__name__})')
            conn.rollback()
    cur.execute('DELETE FROM recipes WHERE id = ANY(%s)', (rows,))
    print('Удалено рецептов:', cur.rowcount)
    conn.commit()

cur.execute('SELECT count(*) FROM recipes')
print('Рецептов осталось:', cur.fetchone()[0])
cur.execute('SELECT count(*) FROM recipe_steps')
print('Шагов всего:', cur.fetchone()[0])

cur.close()
conn.close()
