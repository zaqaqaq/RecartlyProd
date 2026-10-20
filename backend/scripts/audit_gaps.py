"""Аудит «узких мест» Recartly: проверяет публикацию контента на модерации,
доступность краудсорсинга цен, жалоб и скорость бюджетного подбора.

Запуск:
    .venv\\Scripts\\python.exe backend\\scripts\\audit_gaps.py
"""

import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = 'http://localhost:8000'
EMAIL = 'smeta.tester@recartly.ru'
PASSWORD = 'test1234'


def call(path, method='GET', body=None, token=None):
    data = json.dumps(body).encode('utf-8') if body is not None else None
    request = urllib.request.Request(f'{BASE}{path}', data=data, method=method)
    if data:
        request.add_header('Content-Type', 'application/json')
    if token:
        request.add_header('Authorization', f'Bearer {token}')
    started = time.time()
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = response.read().decode('utf-8')
            status = response.status
    except urllib.error.HTTPError as exc:
        payload = exc.read().decode('utf-8')
        status = exc.code
    elapsed = (time.time() - started) * 1000
    try:
        parsed = json.loads(payload) if payload else None
    except json.JSONDecodeError:
        parsed = payload
    return status, parsed, elapsed


def main() -> int:
    status, login, _ = call('/auth/login', 'POST', {'email': EMAIL, 'password': PASSWORD})
    if status != 200:
        print('Не удалось войти:', status, login)
        return 1
    token = login['access_token']

    print('=' * 64)
    print('1. МОДЕРАЦИЯ: попадает ли контент со статусом pending в публичную ленту?')
    recipe_payload = {
        'title': 'АУДИТ: рецепт на проверке',
        'description': 'Проверка того, что неопубликованное не видно другим пользователям.',
        'instructions': '1. Ничего не делать.',
        'ingredients': [{'name': 'Картофель', 'quantity': '1 кг', 'price': 45}],
    }
    status, created, _ = call('/recipes/', 'POST', recipe_payload, token)
    recipe_id = created.get('id') if isinstance(created, dict) else None
    print(f'   создан рецепт #{recipe_id}, статус ответа создания: {created.get("status") if isinstance(created, dict) else created}')

    status, feed, _ = call('/recipes/?limit=100')
    ids = [item.get('id') for item in feed] if isinstance(feed, list) else []
    in_feed = recipe_id in ids
    print(f'   GET /recipes/ (анонимно): статус {status}, всего {len(ids)}, '
          f'pending-рецепт в ленте: {"ДА — ДЫРА" if in_feed else "нет"}')

    status, single, _ = call(f'/recipes/{recipe_id}')
    print(f'   GET /recipes/{recipe_id} анонимно: статус {status}, '
          f'статус рецепта в ответе: {single.get("status") if isinstance(single, dict) else "—"}')

    status, search, _ = call('/recipes/search?q=' + urllib.parse.quote('АУДИТ'))
    search_ids = [item.get('id') for item in search] if isinstance(search, list) else []
    print(f'   поиск находит неопубликованное: {"ДА — ДЫРА" if recipe_id in search_ids else "нет"}')

    print('=' * 64)
    print('2. КРАУДСОРСИНГ ЦЕН: можно ли сообщить цену из магазина?')
    for path, method in (('/prices/', 'POST'), ('/prices/quote', 'POST'), ('/catalog/prices', 'POST')):
        status, _, _ = call(path, method, {'product_id': 1, 'shop_id': 1, 'city_id': 1, 'price': 99}, token)
        print(f'   {method} {path:<20} -> {status}')

    print('=' * 64)
    print('3. ЖАЛОБЫ: может ли пользователь пожаловаться на контент?')
    for path, method in (('/reports/', 'POST'), ('/moderation/reports', 'POST')):
        status, _, _ = call(path, method, {'target_type': 'recipe', 'target_id': recipe_id, 'reason_code': 'spam'}, token)
        print(f'   {method} {path:<22} -> {status}')

    print('=' * 64)
    print('4. СКОРОСТЬ бюджетного подбора и подбора меню (сейчас 8 рецептов, 8064 цены)')
    for path in (
        '/catalog/budget?budget=1000&city_id=1&servings=2',
        '/catalog/shelves?city_id=1',
        '/catalog/recipes/7/cost?city_id=1',
    ):
        status, payload, elapsed = call(path)
        size = len(payload.get('items', [])) if isinstance(payload, dict) else '—'
        print(f'   {path:<48} {status} {elapsed:7.0f} ms, элементов: {size}')

    status, _, elapsed = call('/mealplans/preview', 'POST', {
        'city_id': 1, 'days': 7, 'meals_per_day': 3, 'servings': 2, 'budget': 3000, 'diet': 'any',
    })
    print(f'   /mealplans/preview (7 дней, 3 приёма)                {status} {elapsed:7.0f} ms')

    print('=' * 64)
    print('5. ПАГИНАЦИЯ: отдаёт ли лента общее количество?')
    status, feed, _ = call('/recipes/?limit=2')
    print(f'   GET /recipes/?limit=2: тип ответа {type(feed).__name__}, '
          f'элементов {len(feed) if isinstance(feed, list) else "—"} (заголовка X-Total нет)')

    print('=' * 64)
    print(f'ИТОГ: тестовый рецепт #{recipe_id} оставлен в базе для проверки модерации.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
