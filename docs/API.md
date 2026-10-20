# API Recartly

Справочник REST API бэкенда: как получить актуальную спецификацию, соглашения, полный список
эндпоинтов по разделам и примеры запросов для ключевых сценариев. Базовый адрес локальной
разработки — `http://localhost:8000`.

## Оглавление

1. [Актуальная спецификация](#актуальная-спецификация)
2. [Соглашения](#соглашения)
3. [Авторизация](#авторизация)
4. [Эндпоинты по разделам](#эндпоинты-по-разделам)
5. [Примеры запросов](#примеры-запросов)
6. [Коды ошибок](#коды-ошибок)

## Актуальная спецификация

FastAPI сам отдаёт машинночитаемую спецификацию и документацию:

| Что | Адрес |
|---|---|
| Swagger UI | `http://localhost:8000/docs` |
| ReDoc | `http://localhost:8000/redoc` |
| OpenAPI JSON | `http://localhost:8000/openapi.json` |

Сохранить спецификацию в файл (Windows, встроенный `curl.exe`):

```powershell
curl.exe -s http://localhost:8000/openapi.json -o openapi.json
```

Посмотреть список путей без сохранения:

```powershell
curl.exe -s http://localhost:8000/openapi.json | ConvertFrom-Json | ForEach-Object { $_.paths.PSObject.Properties.Name }
```

Если бэкенд не запущен, таблицы ниже остаются рабочим справочником: они собраны из декораторов
`@router.get/post/patch/delete` в `backend/app/api/routes/*.py` (21 роутер, 117 эндпоинтов).
При запущенном бэкенде источником правды считается `/openapi.json` — в нём видны все параметры,
схемы тел и коды ответов.

## Соглашения

- Формат — JSON (`Content-Type: application/json`), кроме загрузки файлов (`multipart/form-data`,
  поле `file`).
- Имена полей — `snake_case`; даты — ISO 8601 (`2026-10-20T12:00:00Z`). Для `prices_date`
  передавайте именно datetime: строка `2026-10-20` даёт `422`.
- Пагинация — `skip`/`limit` (в разных разделах ограничения на `limit` отличаются: обычно 1–100).
- Успешные ответы — `200`; создание — `200` (не `201`); удаление обычно возвращает
  `{"message": "..."}` (ответ `204` в текущем API не используется, хотя клиент его поддерживает).
- Ошибки — `{"detail": "текст"}`; ошибки валидации Pydantic — `422` с массивом `detail`.
- Версионирования API нет: пути стабильны, префикс — имя домена (`/baskets`, `/catalog`, …).
- У `reactions_router` нет префикса: его эндпоинты выглядят как `/recipes/{recipe_id}/reactions`.
- Часть эндпоинтов существует, но не вызывается текущим UI (`/catalog/*`, `/prices/*`, `/reviews/*`,
  `/go/link/*`). Это не мёртвый код, а готовый контракт для соответствующих экранов и сценариев.

## Авторизация

1. `POST /auth/login` с `email` и `password` возвращает:

   ```json
   { "access_token": "<jwt>", "token_type": "bearer" }
   ```

2. Токен передаётся заголовком:

   ```
   Authorization: Bearer <access_token>
   ```

3. JWT подписан HS256, срок жизни — **30 минут**, в токене только `sub = email`. Refresh-токена
   нет: после истечения нужен повторный вход.
4. Роль берётся из `users.role` при каждом запросе, поэтому смена роли/блокировка действуют
   сразу.

Уровни доступа в таблицах:

| Обозначение | Значение |
|---|---|
| `—` | без авторизации |
| `опц.` | токен не обязателен, но меняет ответ (например, `is_liked`, «моя реакция», приватные наборы) |
| `токен` | обязателен, иначе `401` |
| `модер.` | роль `moderator` или `admin`, иначе `403` |

## Эндпоинты по разделам

### Авторизация (`/auth`)

| Метод | Путь | Назначение | Доступ |
|---|---|---|---|
| POST | `/auth/register` | регистрация по email, username, password | — |
| POST | `/auth/login` | вход, выдача JWT | — |
| GET | `/auth/me` | текущий пользователь | опц.; без токена не предназначен — используйте `/profile/me` |

### Рецепты (`/recipes`)

| Метод | Путь | Назначение | Доступ |
|---|---|---|---|
| POST | `/recipes/upload-photo` | загрузка фото рецепта → `{photo_url}` | токен |
| POST | `/recipes/` | создать рецепт с ингредиентами и шагами | токен |
| GET | `/recipes/` | лента опубликованных рецептов (`skip`, `limit`) | — |
| GET | `/recipes/my` | мои рецепты (включая черновики и отклонённые) | токен |
| GET | `/recipes/search` | поиск по названию и цене (`q`, `min_price`, `max_price`) | — |
| GET | `/recipes/{recipe_id}` | карточка; неопубликованное — только автору/модератору | опц. |
| DELETE | `/recipes/{recipe_id}` | удалить свой рецепт | токен |

### Комментарии к рецептам (`/comments`)

| Метод | Путь | Назначение | Доступ |
|---|---|---|---|
| GET | `/comments/latest` | последние комментарии для ленты | — |
| POST | `/comments/{recipe_id}` | добавить комментарий или ответ (`parent_id`) | токен |
| GET | `/comments/{recipe_id}` | комментарии рецепта | — |
| DELETE | `/comments/{comment_id}` | удалить свой комментарий | токен |

### Избранное (`/favorites`)

| Метод | Путь | Назначение | Доступ |
|---|---|---|---|
| GET | `/favorites/` | избранные рецепты | токен |
| POST | `/favorites/{recipe_id}` | добавить в избранное | токен |
| DELETE | `/favorites/{recipe_id}` | убрать из избранного | токен |

### Профиль (`/profile`)

| Метод | Путь | Назначение | Доступ |
|---|---|---|---|
| GET | `/profile/me` | свой профиль со счётчиками | токен |
| PUT | `/profile/me` | обновить профиль | токен |
| PATCH | `/profile/me` | то же (частичное обновление) | токен |
| POST | `/profile/upload-avatar` | аватар (image/*, до 2 МБ) | токен |
| GET | `/profile/me/achievements` | мои ачивки | токен |
| GET | `/profile/{user_id}` | публичный профиль | — |
| POST | `/profile/change-password` | смена пароля (`old_password`, `new_password`) | токен |

### Отзывы (`/reviews`)

| Метод | Путь | Назначение | Доступ |
|---|---|---|---|
| POST | `/reviews/` | создать отзыв | токен |
| GET | `/reviews/` | список отзывов (`target_type`) | опц. |
| GET | `/reviews/{review_id}` | отзыв по ID | опц. |
| DELETE | `/reviews/{review_id}` | удалить свой отзыв | токен |
| POST | `/reviews/{review_id}/like` | лайк отзыва | токен |
| DELETE | `/reviews/{review_id}/like` | убрать лайк | токен |
| POST | `/reviews/{review_id}/comments` | комментарий к отзыву | токен |
| GET | `/reviews/{review_id}/comments` | комментарии отзыва | — |

### География (`/geo`)

| Метод | Путь | Назначение | Доступ |
|---|---|---|---|
| GET | `/geo/cities` | города: без `q` — крупнейшие, с `q` — поиск по названию/региону (`limit` ≤ 300) | — |
| POST | `/geo/cities` | добавить город, которого нет в справочнике | — |
| GET | `/geo/shops` | магазины города + личные магазины пользователя | опц. |
| POST | `/geo/shops` | добавить «магазин у дома» | токен |
| DELETE | `/geo/shops/{shop_id}` | убрать магазин из личного списка | токен |

### Бюджетный подбор (`/catalog`)

Считает смету «на лету» по `price_quotes` (`status='confirmed'`). Если в городе нет цен,
используется город-эталон, а в ответе `prices_estimated = true`.

| Метод | Путь | Назначение | Доступ |
|---|---|---|---|
| GET | `/catalog/budget` | рецепты под бюджет (город, порции, категория, время, сложность, КБЖУ, сортировка) | — |
| GET | `/catalog/shelves` | «полки бюджета»: до 300, 300–600, 600–1000, 1000–1500, от 1500 ₽ | — |
| GET | `/catalog/recipes/{recipe_id}/cost` | смета рецепта: single/split, ₽/порция, КБЖУ | — |
| GET | `/catalog/seasonal` | продукты текущего сезона с минимальной ценой | — |
| GET | `/catalog/price-history/{product_id}` | история цен продукта | — |
| GET | `/catalog/trends` | что подешевело/подорожало/в сезон за окно `days` | — |

### Наборы (`/baskets`)

| Метод | Путь | Назначение | Доступ |
|---|---|---|---|
| GET | `/baskets/feed` | лента публичных наборов (`budget`, `servings`, `sort=popular/cheap/expensive/fresh`) | опц. |
| GET | `/baskets/dishes` | блюда из наборов (`max_kcal`, `min_protein`, те же сортировки) | — |
| POST | `/baskets/` | создать набор из рецепта или вручную | токен |
| GET | `/baskets/` | мои наборы, включая приватные | токен |
| GET | `/baskets/preview` | что подставится в набор по рецепту (`recipe_id`, `city_id`, `servings`) | — |
| GET | `/baskets/shared/{token}` | набор по ссылке-токену | — |
| GET | `/baskets/{basket_id}` | карточка набора (увеличивает `views_count`) | опц. |
| GET | `/baskets/{basket_id}/recipes` | блюда из набора (авторские + по покрытию ≥ 60 %) | — |
| PATCH | `/baskets/{basket_id}/prices` | обновить цены (`prices_date` обязательна, старые уходят в `prev_price`) | токен |
| POST | `/baskets/{basket_id}/like` | лайк | токен |
| DELETE | `/baskets/{basket_id}/like` | снять лайк | токен |
| GET | `/baskets/{basket_id}/comments` | обсуждение набора с реакциями | опц. |
| POST | `/baskets/{basket_id}/comments` | комментарий/ответ | токен |
| DELETE | `/baskets/{basket_id}/comments/{comment_id}` | удалить комментарий (автор или модератор) | токен |
| POST | `/baskets/{basket_id}/comments/{comment_id}/reactions` | эмодзи-реакция; повторный клик снимает | токен |
| PATCH | `/baskets/{basket_id}/visibility` | показать/скрыть набор (`is_public`) | токен |
| PATCH | `/baskets/{basket_id}/items/{item_id}` | отметить позицию купленной / поправить количество | токен |
| POST | `/baskets/{basket_id}/optimize` | пересобрать состав по ценам магазинов | токен |
| POST | `/baskets/{basket_id}/share` | публичная ссылка + семейный режим (`family=true`) | токен |
| DELETE | `/baskets/{basket_id}` | удалить набор (рецепт остаётся) | токен |

### Партнёрские переходы (`/go`)

| Метод | Путь | Назначение | Доступ |
|---|---|---|---|
| GET | `/go/link/{shop_id}` | ссылка на магазин без перехода (`query` — поисковый запрос) | — |
| GET | `/go/{shop_id}` | редирект `302` в магазин + запись в `purchase_clicks` (`query`, `recipe_id`, `basket_id`) | опц. |

### План питания (`/mealplans`)

| Метод | Путь | Назначение | Доступ |
|---|---|---|---|
| POST | `/mealplans/preview` | сгенерировать план без сохранения | — |
| POST | `/mealplans/` | сгенерировать и сохранить план | токен |
| GET | `/mealplans/` | мои планы | токен |
| GET | `/mealplans/{plan_id}` | план по ID | токен |
| DELETE | `/mealplans/{plan_id}` | удалить план | токен |

### Остатки дома (`/pantry`)

| Метод | Путь | Назначение | Доступ |
|---|---|---|---|
| GET | `/pantry/` | мои остатки | токен |
| POST | `/pantry/` | добавить продукт (при совпадении связывается со справочником) | токен |
| DELETE | `/pantry/{item_id}` | убрать продукт | токен |
| POST | `/pantry/suggest` | рецепты с минимальной докупкой (`city_id`, `limit`, `min_covered`) | токен |

### Реакции и Индекс Recartly

| Метод | Путь | Назначение | Доступ |
|---|---|---|---|
| POST | `/recipes/{recipe_id}/reactions` | поставить/обновить оценку (`taste`, `value`, `simplicity`, `cooked`) | токен |
| DELETE | `/recipes/{recipe_id}/reactions` | удалить свою оценку и пересчитать RI | токен |
| GET | `/recipes/{recipe_id}/reactions` | агрегаты + моя реакция | опц. |
| POST | `/recipes/{recipe_id}/cooked-photo` | фото «что получилось» | токен |

### Челленджи и ачивки

| Метод | Путь | Назначение | Доступ |
|---|---|---|---|
| GET | `/challenges/` | активные челленджи с числом участников (`active_only`) | опц. |
| GET | `/challenges/{challenge_id}/leaderboard` | лидерборд по очкам | — |
| POST | `/challenges/{challenge_id}/join` | участвовать рецептом (`recipe_id`, `basket_id`) | токен |
| GET | `/achievements/` | мои ачивки, баллы, уровень | токен |
| GET | `/achievements/catalog` | каталог всех ачивок | — |
| POST | `/achievements/check` | пересчитать прогресс и выдать новые ачивки | токен |

### Уведомления (`/notifications`)

| Метод | Путь | Назначение | Доступ |
|---|---|---|---|
| GET | `/notifications/unread-count` | счётчик непрочитанных | токен |
| POST | `/notifications/read-all` | отметить все прочитанными | токен |
| GET | `/notifications` | лента `{total, unread, items}` (`unread_only`, `limit`, `skip`) | токен |
| POST | `/notifications/{notification_id}/read` | отметить одно | токен |
| DELETE | `/notifications/{notification_id}` | удалить своё | токен |

### Жалобы (`/reports`)

| Метод | Путь | Назначение | Доступ |
|---|---|---|---|
| GET | `/reports/reasons` | справочник причин | — |
| POST | `/reports/` | отправить жалобу (повтор на тот же объект — `409`) | токен |
| GET | `/reports/my` | мои жалобы и статусы | токен |

### Цены от людей (`/prices`)

| Метод | Путь | Назначение | Доступ |
|---|---|---|---|
| GET | `/prices/products` | автодополнение продукта по названию и алиасам (`q`, до 20) | — |
| POST | `/prices/` | сообщить цену; доверенный автор получает `confirmed`, остальные — `pending` | токен |
| GET | `/prices/my` | мои заявки со статусами | токен |
| GET | `/prices/recent` | последние подтверждённые цены города | — |
| POST | `/prices/upload-photo` | фото ценника (jpg/jpeg/png/webp, до 5 МБ) | токен |
| POST | `/prices/{quote_id}/confirm` | подтвердить цену вручную | модер. |

### «Моя неделя» (`/dashboard`)

| Метод | Путь | Назначение | Доступ |
|---|---|---|---|
| GET | `/dashboard/week` | план, наборы, траты, экономия, сравнение с доставкой (`days` 1–31) | токен |

### Акции (`/promos`)

| Метод | Путь | Назначение | Доступ |
|---|---|---|---|
| GET | `/promos/` | лента акций (`city_id`, `shop_id`, `sort=hot/new/discount`, `include_expired`) | опц. |
| GET | `/promos/my` | мои акции со статусами | токен |
| POST | `/promos/upload-photo` | фото ценника акции | токен |
| POST | `/promos/` | создать акцию; новые авторы — на модерацию | токен |
| GET | `/promos/{promo_id}` | карточка (увеличивает `views_count`) | опц. |
| POST | `/promos/{promo_id}/like` | лайк | токен |
| DELETE | `/promos/{promo_id}/like` | снять лайк | токен |
| DELETE | `/promos/{promo_id}` | удалить (автор или модератор) | токен |

### Админка и модерация (`/admin`)

| Метод | Путь | Назначение | Доступ |
|---|---|---|---|
| GET | `/admin/whoami` | роль и доверие текущего пользователя | токен |
| GET | `/admin/stats` | метрики очереди, решений за 24 ч, среднее время | модер. |
| GET | `/admin/queue` | очередь задач (`status`, `target_type`, `limit`, `skip`) | модер. |
| POST | `/admin/tasks/{task_id}/approve` | одобрить: опубликовать, +2 к доверию | модер. |
| POST | `/admin/tasks/{task_id}/reject` | отклонить (`reason_code`, `comment`), −5 к доверию | модер. |
| POST | `/admin/tasks/{task_id}/needs-changes` | отправить на доработку | модер. |
| GET | `/admin/reports` | жалобы (`status=open/resolved/rejected/all`) | модер. |
| POST | `/admin/reports/{report_id}/resolve` | закрыть жалобу (`resolution`, `status`) | модер. |
| POST | `/admin/sanctions` | санкция (`user_id`, `kind`, `reason`, `expires_at`) | модер. |
| GET | `/admin/audit` | журнал действий | модер. |

### Служебные (`/`)

| Метод | Путь | Назначение | Доступ |
|---|---|---|---|
| GET | `/` | приветствие API | — |
| GET | `/health` | проверка живости | — |

## Примеры запросов

Ниже — Windows PowerShell с `curl.exe`. Для удобства сохраните токен в переменную.

### 1. Логин и токен

```powershell
curl.exe -s -X POST http://localhost:8000/auth/login `
  -H "Content-Type: application/json" `
  -d '{"email":"user@example.com","password":"secret123"}'
```

Ответ:

```json
{"access_token":"eyJhbGciOiJIUzI1NiIs...","token_type":"bearer"}
```

```powershell
$token = (curl.exe -s -X POST http://localhost:8000/auth/login `
  -H "Content-Type: application/json" `
  -d '{"email":"user@example.com","password":"secret123"}' | ConvertFrom-Json).access_token
```

### 2. Лента наборов

```powershell
curl.exe -s "http://localhost:8000/baskets/feed?budget=1000&servings=2&servings=4&sort=cheap&limit=20"
```

Ответ — `BasketFeedOut`: `total` и `items[]` без состава (состав подгружается карточкой).
Для ленты блюд:

```powershell
curl.exe -s "http://localhost:8000/baskets/dishes?max_kcal=500&min_protein=20&sort=popular"
```

### 3. Создание набора из рецепта

Сначала предпросмотр — что сервер подставит:

```powershell
curl.exe -s "http://localhost:8000/baskets/preview?recipe_id=12&servings=4"
```

Затем сохранение (дата покупки — обязательный datetime):

```powershell
curl.exe -s -X POST http://localhost:8000/baskets/ `
  -H "Authorization: Bearer $token" `
  -H "Content-Type: application/json" `
  -d '{
        "recipe_id": 12,
        "title": "Набор на ужин",
        "servings": 4,
        "prices_date": "2026-10-20T12:00:00Z",
        "is_public": true
      }'
```

Набор вручную — вместо `recipe_id` передаётся список позиций:

```powershell
curl.exe -s -X POST http://localhost:8000/baskets/ `
  -H "Authorization: Bearer $token" `
  -H "Content-Type: application/json" `
  -d '{
        "title": "Закупка на неделю",
        "servings": 2,
        "prices_date": "2026-10-20T12:00:00Z",
        "items": [
          {"name": "Творог 9%", "quantity": 400, "unit": "г", "price": 320.0, "shop_id": 1},
          {"name": "Яйцо", "quantity": 10, "unit": "шт", "price": 129.9, "shop_id": 1}
        ]
      }'
```

Обновление цен (дата обязательна, старые цены попадут в `prev_price`):

```powershell
curl.exe -s -X PATCH http://localhost:8000/baskets/5/prices `
  -H "Authorization: Bearer $token" `
  -H "Content-Type: application/json" `
  -d '{"prices_date":"2026-10-21T12:00:00Z","items":[{"id":31,"price":299.0}]}'
```

### 4. Создание рецепта с шагами

```powershell
curl.exe -s -X POST http://localhost:8000/recipes/ `
  -H "Authorization: Bearer $token" `
  -H "Content-Type: application/json" `
  -d '{
        "title": "Сырники классические",
        "description": "Простой завтрак из творога.",
        "instructions": "1. Смешать творог, яйцо и сахар.\n2. Обжарить с двух сторон.",
        "photo_url": null,
        "ingredients": [
          {"name": "Творог 9%", "quantity": "400 г", "price": null, "photo_url": null},
          {"name": "Яйцо", "quantity": "1 шт", "price": null, "photo_url": null}
        ],
        "steps": [
          {"text": "Смешать творог, яйцо и сахар.", "photo_url": null},
          {"text": "Обжарить по 3 минуты с каждой стороны.", "photo_url": null}
        ]
      }'
```

Особенности:

- `steps` необязательны: если их нет, сервер разложит `instructions` по строкам
  (`split_instructions`);
- `servings`, `category`, `cook_time_min`, `difficulty` и КБЖУ через эту схему **не передаются** —
  они заполняются сидами или правкой БД;
- при `trust_score < 60` или автофлагах рецепт вернётся со `status: "pending"` и попадёт в
  очередь модерации; иначе — `published`.

### 5. Модерация

```powershell
# кто я и есть ли доступ
curl.exe -s -H "Authorization: Bearer $token" http://localhost:8000/admin/whoami

# очередь
curl.exe -s -H "Authorization: Bearer $token" "http://localhost:8000/admin/queue?status=pending&limit=20"

# одобрить задачу №7
curl.exe -s -X POST http://localhost:8000/admin/tasks/7/approve `
  -H "Authorization: Bearer $token"

# отклонить задачу №8
curl.exe -s -X POST http://localhost:8000/admin/tasks/8/reject `
  -H "Authorization: Bearer $token" `
  -H "Content-Type: application/json" `
  -d '{"reason_code":"spam","comment":"Реклама в описании"}'

# отправить на доработку
curl.exe -s -X POST http://localhost:8000/admin/tasks/9/needs-changes `
  -H "Authorization: Bearer $token" `
  -H "Content-Type: application/json" `
  -d '{"comment":"Добавьте фото готового блюда"}'
```

Роль выдаётся скриптом `backend/scripts/grant_admin.py` (см. [`DEPLOY.md`](DEPLOY.md)).

### 6. Публикация акции

```powershell
curl.exe -s -X POST http://localhost:8000/promos/ `
  -H "Authorization: Bearer $token" `
  -H "Content-Type: application/json" `
  -d '{
        "title": "Творог 9% — 99 ₽",
        "description": "Акция до конца недели в магазине у дома.",
        "shop_id": 1,
        "city_id": 1,
        "product_id": 3,
        "old_price": 149.0,
        "new_price": 99.0,
        "unit": "упак",
        "ends_at": "2026-10-27T23:59:59Z"
      }'
```

`new_price` должна быть ниже `old_price`, иначе `400`. Ответ содержит `status`: `published`
(если автор доверенный) или `pending`.

### 7. Жалоба на контент

```powershell
curl.exe -s -X POST http://localhost:8000/reports/ `
  -H "Authorization: Bearer $token" `
  -H "Content-Type: application/json" `
  -d '{"target_type":"recipe","target_id":12,"reason_code":"spam","comment":"Ссылка на сторонний сайт"}'
```

Доступные `reason_code` — из `GET /reports/reasons`; повторная открытая жалоба на тот же объект
вернёт `409`, больше 15 жалоб в сутки — `429`.

## Коды ошибок

| Код | Когда возникает | Пример |
|---|---|---|
| `400` | бизнес-валидация | нет `prices_date`; цена акции не ниже старой; короткое название города |
| `401` | нет/неверен токен | запрос к `/baskets/` без `Authorization` |
| `403` | нет прав | чужой набор, роль ниже `moderator`, чужой комментарий |
| `404` | объект не найден или скрыт | неопубликованный рецепт для постороннего; приватный набор |
| `409` | конфликт | повторная жалоба на объект |
| `422` | ошибка схемы/типа | `prices_date: "2026-10-20"` вместо datetime; отсутствует обязательное поле |
| `429` | антиспам | больше 15 жалоб в сутки |
| `500` | необработанная ошибка | проверить логи `docker logs recartly_backend` |
