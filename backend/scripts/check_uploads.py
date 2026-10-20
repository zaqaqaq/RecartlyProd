"""Проверка, что загруженные фото доступны по HTTP."""

import os
import sys
import urllib.request

import psycopg2

sys.stdout.reconfigure(encoding='utf-8')
conn = psycopg2.connect(os.getenv('DATABASE_URL', 'postgresql://recartly:recartly123@localhost:5432/recartly'))
cur = conn.cursor()

cur.execute("SELECT name, photo_url FROM ingredients WHERE photo_url IS NOT NULL LIMIT 3")
rows = cur.fetchall()

if not rows:
    print('Фото ингредиентов нет')
else:
    for name, url in rows:
        full = f'http://localhost:8000{url}'
        try:
            with urllib.request.urlopen(full, timeout=5) as response:
                data = response.read()
                print(f'  «{name}»: {url} -> HTTP {response.status}, {len(data)} байт')
        except Exception as exc:  # noqa: BLE001
            print(f'  «{name}»: {url} -> ОШИБКА: {exc}')

cur.execute("SELECT file_path FROM recipe_photos LIMIT 1") if False else None

# Что вообще лежит в папке загрузок
uploads_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'uploads')
if os.path.isdir(uploads_dir):
    files = sorted(os.listdir(uploads_dir))[:5]
    print('Файлов в uploads:', len(os.listdir(uploads_dir)))
    for name in files:
        print('  ', name)
else:
    print('Папки uploads нет')

cur.close()
conn.close()
