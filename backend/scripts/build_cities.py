"""Сборка списка городов России из открытого датасета hflabs/city.

Читает `backend/data/russian_cities_raw.csv` и формирует компактный JSON со всеми
городами: название, регион, федеральный округ, население, slug.

Запуск:
    .venv\\Scripts\\python.exe backend\\scripts\\build_cities.py
"""

import csv
import json
import os
import re
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(BASE_DIR, 'data', 'russian_cities_raw.csv')
TARGET = os.path.join(BASE_DIR, 'data', 'russian_cities.json')

# Транслит для slug: slug уникален, поэтому к нему добавляется регион
TRANSLIT = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e', 'ж': 'zh',
    'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
    'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'ts',
    'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu',
    'я': 'ya',
}


def slugify(value: str) -> str:
    value = (value or '').lower().strip()
    result = ''.join(TRANSLIT.get(char, char) for char in value)
    result = re.sub(r'[^a-z0-9]+', '-', result)
    return result.strip('-') or 'city'


# Города-миллионники федерального значения в датасете отсутствуют как города —
# добавляем их вручную, иначе Москва и Петербург пропадут из списка
EXTRA_CITIES = [
    {
        'name': 'Москва',
        'region': 'г Москва',
        'federal_district': 'Центральный',
        'population': 13_010_112,
        'slug': 'moskva',
        'timezone': 'UTC+3',
    },
    {
        'name': 'Санкт-Петербург',
        'region': 'г Санкт-Петербург',
        'federal_district': 'Северо-Западный',
        'population': 5_601_911,
        'slug': 'sankt-peterburg',
        'timezone': 'UTC+3',
    },
    {
        'name': 'Севастополь',
        'region': 'г Севастополь',
        'federal_district': 'Южный',
        'population': 547_820,
        'slug': 'sevastopol',
        'timezone': 'UTC+3',
    },
]


def main() -> int:
    if not os.path.exists(SOURCE):
        print(f'Не найден исходный файл: {SOURCE}')
        return 1

    cities = {}
    with open(SOURCE, encoding='utf-8') as handle:
        for row in csv.DictReader(handle):
            city = (row.get('city') or '').strip()
            city_type = (row.get('city_type') or '').strip()
            region = (row.get('region') or '').strip()
            region_type = (row.get('region_type') or '').strip()

            # Берём только настоящие города (не пгт, не сёла, не деревни)
            if not city or city_type != 'г':
                continue
            # Внутригородские образования вроде «Алупка» внутри Ялты не нужны:
            # они дублируют город и путают выбор
            settlement = (row.get('settlement') or '').strip()
            if settlement and settlement.lower() != city.lower():
                continue

            population = row.get('population') or '0'
            try:
                population = int(float(population))
            except ValueError:
                population = 0

            region_label = f'{region_type} {region}'.strip() if region else (row.get('federal_district') or '').strip()
            key = (city.lower(), region.lower())

            # Оставляем запись с наибольшим населением (дубликаты в датасете)
            existing = cities.get(key)
            if existing and existing['population'] >= population:
                continue

            cities[key] = {
                'name': city,
                'region': region_label or None,
                'federal_district': (row.get('federal_district') or '').strip() or None,
                'population': population,
                'slug': slugify(f'{city}-{region}'),
                'timezone': (row.get('timezone') or '').strip() or None,
            }

    for extra in EXTRA_CITIES:
        key = (extra['name'].lower(), extra['region'].lower())
        cities.setdefault(key, extra)

    result = sorted(cities.values(), key=lambda item: (-item['population'], item['name']))

    # Гарантируем уникальность slug (в датасете встречаются одноимённые регионы)
    seen = {}
    for item in result:
        base = item['slug']
        if base in seen:
            seen[base] += 1
            item['slug'] = f'{base}-{seen[base]}'
        else:
            seen[base] = 1

    os.makedirs(os.path.dirname(TARGET), exist_ok=True)
    with open(TARGET, 'w', encoding='utf-8') as handle:
        json.dump(result, handle, ensure_ascii=False, indent=1)

    print(f'Городов: {len(result)}')
    print(f'Сохранено: {TARGET}')
    print('Крупнейшие:', ', '.join(item["name"] for item in result[:5]))
    print('Примеры:', ', '.join(item["name"] for item in result[-5:]))
    return 0


if __name__ == '__main__':
    sys.exit(main())
