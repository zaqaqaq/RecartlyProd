"""Диагностика БД Recartly: список таблиц, версия Alembic, объём данных.

Запуск (с хоста, Postgres проброшен на localhost:5432):
    .venv\\Scripts\\python.exe backend\\scripts\\check_db.py
"""

import os
import sys

import psycopg2

DSN = os.getenv(
    "DATABASE_URL",
    "postgresql://recartly:recartly123@localhost:5432/recartly",
)

TABLES = [
    "users",
    "recipes",
    "ingredients",
    "comments",
    "favorites",
    "shopping_carts",
    "cart_items",
    "reviews",
    "achievements",
    "cities",
    "shops",
    "price_quotes",
    "reactions",
    "moderation_tasks",
]


def main() -> int:
    conn = psycopg2.connect(DSN)
    cur = conn.cursor()

    cur.execute("select tablename from pg_tables where schemaname='public' order by 1")
    existing = [row[0] for row in cur.fetchall()]
    print("Таблиц в БД:", len(existing))
    print("  " + ", ".join(existing))

    try:
        cur.execute("select version_num from alembic_version")
        print("Версия Alembic:", cur.fetchone()[0])
    except Exception as exc:  # noqa: BLE001
        conn.rollback()
        print("alembic_version недоступна:", exc)

    print("\nСтрок в таблицах:")
    for table in TABLES:
        if table not in existing:
            print(f"  {table:<20} — нет таблицы")
            continue
        try:
            cur.execute(f"select count(*) from {table}")  # noqa: S608 - имена из белого списка
            print(f"  {table:<20} {cur.fetchone()[0]}")
        except Exception as exc:  # noqa: BLE001
            conn.rollback()
            print(f"  {table:<20} ошибка: {exc}")

    cur.close()
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
