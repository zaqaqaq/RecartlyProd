"""Удаление тестовых пользовательских магазинов («магазин у дома»)."""

import os
import sys

import psycopg2

sys.stdout.reconfigure(encoding='utf-8')
conn = psycopg2.connect(os.getenv('DATABASE_URL', 'postgresql://recartly:recartly123@localhost:5432/recartly'))
cur = conn.cursor()

cur.execute('DELETE FROM user_shops')
print('Связей удалено:', cur.rowcount)
cur.execute('DELETE FROM shops WHERE is_custom = true')
print('Своих магазинов удалено:', cur.rowcount)
conn.commit()

cur.execute('SELECT count(*) FROM shops')
print('Магазинов в справочнике:', cur.fetchone()[0])

cur.close()
conn.close()
