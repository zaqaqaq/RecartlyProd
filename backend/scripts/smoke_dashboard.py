"""Проверка сводки «Моя неделя»: вызывает функцию роута напрямую и печатает трейсбек."""

import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault(
    'DATABASE_URL', 'postgresql://recartly:recartly123@localhost:5432/recartly'
)

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.api.routes.dashboard import week_summary  # noqa: E402
from app.models.user import User  # noqa: E402


def main() -> int:
    engine = create_engine(os.environ['DATABASE_URL'])
    db = sessionmaker(bind=engine)()

    user = db.query(User).filter(User.email == 'smeta.tester@recartly.ru').first()
    if user is None:
        print('Тестовый пользователь не найден')
        return 1

    print(f'Пользователь: {user.username} (id={user.id})')
    try:
        result = week_summary(days=7, db=db, current_user=user)
        print('OK')
        print('  план:', (result['plan'] or {}).get('title'))
        print('  смет:', len(result['baskets']), 'потрачено:', result['spent'], 'осталось купить:', result['to_buy'])
        print('  доставка:', result['delivery'])
        print('  рецепты:', result['recipes'])
    except Exception:  # noqa: BLE001
        traceback.print_exc()
        return 1
    finally:
        db.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
