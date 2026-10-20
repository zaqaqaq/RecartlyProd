"""Тест модерации: назначает роль и проверяет админ-эндпоинты.

Запуск:
    .venv\\Scripts\\python.exe backend\\scripts/grant_admin.py <email>
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault(
    'DATABASE_URL', 'postgresql://recartly:recartly123@localhost:5432/recartly'
)

import psycopg2  # noqa: E402


def main() -> int:
    email = sys.argv[1] if len(sys.argv) > 1 else 'smeta.tester@recartly.ru'
    role = sys.argv[2] if len(sys.argv) > 2 else 'admin'

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    cur = conn.cursor()
    cur.execute('UPDATE users SET role = %s WHERE email = %s RETURNING id, username', (role, email))
    row = cur.fetchone()
    conn.commit()
    cur.close()
    conn.close()

    if row is None:
        print(f'Пользователь {email} не найден')
        return 1
    print(f'Пользователь {row[1]} (id={row[0]}) получил роль {role}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
