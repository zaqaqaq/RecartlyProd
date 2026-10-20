"""Диагностика генерации меню: запускает сервис напрямую и печатает трейсбек."""

import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault(
    'DATABASE_URL', 'postgresql://recartly:recartly123@localhost:5432/recartly'
)

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.models.geo import City  # noqa: E402
from app.services import mealplan_service  # noqa: E402


def main() -> int:
    engine = create_engine(os.environ['DATABASE_URL'])
    db = sessionmaker(bind=engine)()

    city = db.query(City).order_by(City.id).first()
    print('city:', city.name if city else None)

    try:
        candidates = mealplan_service.build_candidates(db, city.id if city else None, 2, 'any')
        print('candidates:', len(candidates))
        for candidate in candidates[:5]:
            print('  ', candidate)
    except Exception:  # noqa: BLE001
        print('ОШИБКА в build_candidates:')
        traceback.print_exc()
        return 1

    try:
        items = mealplan_service.generate_plan_items(candidates, 3, 2, 900.0, None, None)
        print('items:', len(items))
        summary = mealplan_service.summarize_plan(items, 3)
        print('summary:', {k: v for k, v in summary.items() if k != 'days'})
    except Exception:  # noqa: BLE001
        print('ОШИБКА в generate/summarize:')
        traceback.print_exc()
        return 1

    db.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
