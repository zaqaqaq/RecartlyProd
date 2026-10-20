# Бэкенд Recartly

Документ описывает модули `backend/app`: модели, сервисы, роутеры, схемы, ядро приложения и
операционные скрипты. Цель — чтобы новый разработчик знал, где искать логику и куда добавлять
новую; контракты эндпоинтов вынесены в [`API.md`](API.md), схема таблиц — в [`DATA_MODEL.md`](DATA_MODEL.md).

## Оглавление

1. [Структура `backend/app`](#структура-backendapp)
2. [Модели (`app/models/`)](#модели-appmodels)
3. [Сервисы (`app/services/`)](#сервисы-appservices)
4. [Роутеры (`app/api/routes/`)](#роутеры-appapiroutes)
5. [Схемы, ядро и сборка приложения](#схемы-ядро-и-сборка-приложения)
6. [Скрипты (`backend/scripts/`)](#скрипты-backendscripts)
7. [Соглашения и технический долг](#соглашения-и-технический-долг)

## Структура `backend/app`

```
app/
├── main.py                 FastAPI-приложение: CORS, роутеры, /uploads, /health
├── api/
│   ├── deps.py             зависимости авторизации и ролей
│   └── routes/             20 файлов, 21 роутер, 117 эндпоинтов
├── core/
│   ├── database.py         engine, SessionLocal, Base, get_db
│   ├── security.py         JWT HS256 (30 мин), bcrypt
│   └── config.py           пустой файл
├── models/                 18 файлов, 37 таблиц
├── schemas/                13 файлов Pydantic-схем
└── services/               9 сервисов
```

## Модели (`app/models/`)

Все модели наследуют `Base` из `app.core.database`. Регистрация моделей — в
`app/models/__init__.py`: он импортирует каждый модуль, чтобы `Base.metadata` знал о таблицах
(нужно для `create_all` и миграции).

| Файл | Модели | Что хранит | Ключевые связи |
|---|---|---|---|
| `user.py` | `User` | email, username, хеш пароля, аватар, био, город; роль (`user`/`verified_author`/`moderator`/`admin`), `trust_score` 0–100, `is_banned`, `muted_until`, `points`, `level` | `city_id` → `cities`; рецепты, комментарии, избранное, ачивки, отзывы |
| `recipe.py` | `Recipe`, `RecipeStep` | блюдо: заголовок, описание, `instructions`, фото, порции, время, сложность, категория, сезон, КБЖУ на порцию, `ri_score`, агрегаты реакций, статус модерации, `basket_id`; шаг: `position`, текст, фото | автор → `users`; ингредиенты, шаги, комментарии, реакции, избранное; `basket_id` → `baskets` (SET NULL) |
| `ingredient.py` | `Ingredient` | строка состава: название, количество текстом, необязательная цена и фото, `position` | `recipe_id` → `recipes` |
| `comment.py` | `Comment` | комментарий к рецепту; `parent_id` — ответ на другой комментарий | `user_id`, `recipe_id`, `parent_id` → `comments` (SET NULL) |
| `favorite.py` | `Favorite` | рецепт в избранном у пользователя | `user_id`, `recipe_id` |
| `achievement.py` | `Achievement` | выданная ачивка: `type` (код), название, описание, иконка, дата | `user_id` |
| `review.py` | `Review`, `ReviewLike`, `ReviewComment` | отзыв с рейтингом и `target_type` (`recipe`/`cart`/`shop`), лайки и комментарии к отзыву | `user_id`; лайки/комментарии → `reviews` |
| `geo.py` | `City`, `Shop`, `ShopCity`, `UserShop` | город (`slug` уникален, название — нет); магазин (сеть, эмодзи, цвет, `affiliate_template`, `is_partner`, `is_custom`); присутствие сети в городе; привязка личного магазина к пользователю | `ShopCity` → `shops`+`cities`; `UserShop` → `users`+`shops`; `User.city_id` |
| `product.py` | `Product`, `ProductNutrition` | продукт: имя, `normalized_name`, категория, единица, `pack_size`/`pack_units`, КБЖУ на 100 г, сезонность, `aliases`; КБЖУ-запись пользователя (`source`: user/moderator/import) | `ProductNutrition.product_id` → `products` |
| `price.py` | `PriceQuote` | цена продукта в магазине города на дату: `price`, `unit_amount`, `source`, статус (`pending`/`confirmed`/`rejected`), фото, автор, `checked_at` | `product_id`, `shop_id`, `city_id`, `reported_by` |
| `reaction.py` | `Reaction`, `CookedPhoto` | оценка 1–5 по осям `taste`/`value`/`simplicity`, флаг `cooked`; фото «что получилось» со статусом | `recipe_id`, `user_id`; уникальная пара рецепт+пользователь |
| `basket.py` | `Basket`, `BasketItem`, `BasketLike`, `BasketComment`, `BasketCommentReaction`, `PurchaseClick` | набор: стратегия, порции, бюджет, итог, экономия, `prices_date`, публичность, семейный режим, `share_token`, статус; позиция: продукт/название, количество, магазин, цена, `prev_price`, фото, `is_checked`; лайк; комментарий с `parent_id`; эмодзи-реакция; клик по партнёрской ссылке | автор, город, рецепт; позиции/лайки/комментарии каскадно от набора |
| `moderation.py` | `ModerationTask`, `Report`, `AuditLog`, `UserSanction` | задача очереди (`target_type`/`target_id`, статус, приоритет, `auto_flags`, автор, модератор); жалоба; запись журнала; санкция (`warning`/`mute`/`ban`/`shadowban`) | `moderator_id`, `author_id`, `reporter_id`, `actor_id`, `user_id`, `issued_by` → `users` |
| `mealplan.py` | `MealPlan`, `MealPlanItem`, `PantryItem` | план питания: дни, порции, диета, цели по КБЖУ, итог; приём пищи: день, тип, рецепт, цена и КБЖУ; остаток дома: название, количество, срок | `user_id`, `city_id`; позиции → `meal_plans` каскадно; `recipe_id` |
| `challenge.py` | `Challenge`, `ChallengeEntry` | челлендж бюджета (slug, лимит, порции, период); заявка участника с рецептом, набором, ценой и очками | `city_id`; заявки → `challenges` каскадно; `recipe_id`, `basket_id` |
| `notification.py` | `Notification` | одно уведомление: тип, заголовок, тело, актор, `target_type`/`target_id`, JSON-payload, `is_read` | получатель (`user_id`) и актор (`actor_id`) — обе ссылки на `users` |
| `promo.py` | `Promo`, `PromoLike` | акция: магазин, город, продукт, старая/новая цена, срок, статус модерации, счётчики; лайк акции | `user_id`, `shop_id`, `city_id`, `product_id` |
| `__init__.py` | — | импорт всех моделей и `__all__`; в docstring зафиксировано, что `ShoppingCart`/`CartItem`/`CartComment`/`CartLike` удалены в пользу `Basket` | — |

### Статусы, которые встречаются в моделях

| Поле | Допустимые значения |
|---|---|
| `recipes.status` | `draft`, `pending`, `published`, `rejected`, `needs_changes` |
| `baskets.status` | по умолчанию `published`; значение задаётся кодом и может быть изменено модерацией |
| `promos.status` | `draft`, `pending`, `published`, `rejected`, `needs_changes` |
| `price_quotes.status` | `pending`, `confirmed`, `rejected` |
| `moderation_tasks.status` | `pending`, `approved`, `rejected`, `needs_changes` |
| `reports.status` | `open`, `resolved`, `rejected` |
| `user_sanctions.kind` | `warning`, `mute`, `ban`, `shadowban` |
| `notifications.type` | `comment`, `reply`, `reaction`, `moderation`, `achievement`, `price_drop`, `basket_checked`, `challenge`, `system` |
| `users.role` | `user`, `verified_author`, `moderator`, `admin` |

## Сервисы (`app/services/`)

| Файл | Назначение | Основные функции |
|---|---|---|
| `pricing_service.py` | ядро «Сметы»: сопоставление ингредиентов с продуктами, фасовка, раскладка по магазинам, КБЖУ, Индекс Recartly | `parse_quantity`, `to_grams`, `unit_mass`, `normalize_name`, `match_product`, `build_product_index`, `load_price_map`, `build_options`, `nutrition`, `compute_ri`, `recipe_cost_summary` |
| `product_service.py` | нормализация названий продуктов, защита от дублей, медиана КБЖУ | `normalize_product_name`, `search_key`, `similarity`, `find_exact`, `find_similar`, `nutrition_summary`, `find_or_create` |
| `recipe_service.py` | создание рецепта вместе с ингредиентами и шагами, чтение и удаление | `split_instructions`, `RecipeService.create_recipe/get_recipe/get_recipes/get_recipes_by_user/calculate_total_price/delete_recipe` |
| `reaction_service.py` | пересчёт Индекса Recartly и запись агрегатов в кэш-поля рецепта | `recipe_price_per_serving`, `compute_recipe_ri`, `recalculate_recipe_ri` |
| `moderation_service.py` | автофлаги, постановка в очередь, решения, журнал, доверие | `auto_flags_for`, `flags_to_json`, `flags_from_json`, `enqueue_if_needed`, `log_action`, `apply_decision`, `shift_trust` |
| `notification_service.py` | единая точка создания уведомлений и обёртки под события | `notify`, `notify_comment`, `notify_reply`, `notify_reaction`, `notify_moderation_decision`, `notify_achievement`, `notify_price_drop`, `notify_basket_checked`, `notify_challenge`, `notify_system`, `unread_count`, `mark_all_read`, `types_of` |
| `mealplan_service.py` | генерация меню под бюджет с КБЖУ и диетами | `build_candidates`, `generate_plan_items`, `summarize_plan`, `is_vegetarian`, `meal_type_for` |
| `achievement_service.py` | правила ачивок, начисление баллов и уровней | `check_achievements`, `catalog`, `user_level`; словарь `ACHIEVEMENTS` (11 кодов) |
| `trends_service.py` | динамика цен по городу и сезонные подборки | `load_price_history`, `build_trends`, `_daily_best`, `_seasonal_out` |

### `pricing_service` — как считается стоимость

Пайплайн (подробно разобран в [`ARCHITECTURE.md`](ARCHITECTURE.md#4-сборка-сметы-по-рецепту)):

1. `build_product_index(db)` — словарь `{нормализованное имя или алиас: Product}`; справочник
   небольшой (сид — 72 продукта), поэтому грузится в память.
2. `recipe_positions(recipe, index)` — список `RecipePosition` (`name`, `quantity`, `unit`,
   `product`, `grams`); количество разбирается регуляркой `QUANTITY_RE`.
3. `load_price_map(db, city_id, product_ids)` — берёт **только** `PriceQuote.status == 'confirmed'`,
   сортирует по `checked_at desc` и оставляет первую цену на пару «продукт + магазин».
4. `build_options(positions, prices, shops, max_shops=3)` — возвращает `single` и `split`:
   - `single` — магазин с максимальным покрытием, при равенстве — с меньшей суммой;
   - `split` — жадный алгоритм: каждой позиции назначается самый дешёвый магазин, затем
     количество магазинов сокращается до `max_shops`, отбрасывая магазин с наименьшими потерями;
   - `_quantity_multiplier()` учитывает фасовку: «400 г макарон» = 1 упаковка,
     «4 шт» яиц при упаковке 10 шт = 0,4 упаковки.
5. `nutrition(positions, servings)` — КБЖУ на порцию по сопоставленным продуктам.
6. `compute_ri(reactions, price_per_serving, city_avg_per_serving)` — индекс 0–100.
   Формула: качество (вкус 0,5 + выгода 0,3 + простота 0,2) × 0,75 + ценовая выгода × 0,25,
   затем сглаживание `n/(n+5)`. Голос с `cooked=True` весит ×2.
7. `recipe_cost_summary(db, recipe, city_id, product_index, max_shops)` — итоговая смета:
   `single`, `split`, `best_total`, `price_per_serving`, `savings`, `nutrition`.

### `product_service` — нормализация и КБЖУ

- `normalize_product_name()` приводит «творог9 процентов» и «ТВОРОГ 9 %» к «Творог 9%»:
  слова «процентов/проц.» → `%`, пробелы между буквой и цифрой, латинские двойники кириллицы
  (`Tворог` → `Творог`) только внутри русских названий.
- `find_similar()` использует `SequenceMatcher` с порогом 0,72; разные числовые модификаторы
  («Творог 9%» и «Творог 5%») считаются разными продуктами (похожесть × 0,5).
- `nutrition_summary()` берёт **медиану** записей `ProductNutrition`, иначе справочные поля
  `Product.kcal_per_100` и соседние; возвращает `samples` и `source`
  (`users` / `reference` / `unknown`).
- `find_or_create()` сначала ищет точное совпадение, затем создаёт продукт; при наличии
  nutrition-данных добавляет запись `ProductNutrition` и для существующего продукта.

### `moderation_service` — правила

- `TRUST_THRESHOLD = 60`: ниже порога контент уходит в очередь.
- Автофлаги: `link`, `phone`, `messenger`, `spam`, `profanity`, `short_text` (< 25 символов),
  `no_photo`.
- `enqueue_if_needed()` возвращает `True`, если задача создана. Если `trust >= 60` и флагов нет,
  задача не создаётся — контент публикуется сразу.
- `apply_decision()` поддерживает `recipe`, `price`, `promo`; для остальных типов возвращает
  `False` (статусов в моделях нет).
- `shift_trust()` меняет доверие в границах 0–100: `+2` за одобрение, `-5` за отклонение.
- `log_action()` пишет JSON-payload в `audit_log`.

### `notification_service` — правила

- `notify()` **не коммитит** транзакцию и не создаёт уведомление, если получатель совпадает с
  актором.
- Вызывающий код обязан обернуть вызов в `try/except` и сделать `db.rollback()` при ошибке,
  чтобы сбой уведомления не сломал основную операцию (так сделано в комментариях, реакциях,
  модерации, ачивках).
- `mark_all_read()` коммитит сам — это самостоятельная массовая операция.

### `mealplan_service` — генерация меню

- Кандидаты — только `recipes.status == 'published'`, у которых есть сопоставленные продукты и
  ненулевая смета.
- Диеты: `any`, `pp` (ккал ≤ 550 и белок ≥ 12 на порцию), `vegetarian` (эвристика по словам-
  маркерам мяса/рыбы в названии, описании и ингредиентах), `high_protein` (белок ≥ 25).
- `generate_plan_items()` раскладывает блюда по слотам (`breakfast`/`lunch`/`dinner`/`snack`),
  не повторяет блюдо в один день, старается не превышать бюджет и цель по калориям; при недоборе
  белка добавляет белковый перекус.
- `summarize_plan()` считает итог, ₽/день и средние КБЖУ в день.

## Роутеры (`app/api/routes/`)

21 роутер в 20 файлах; все подключаются в `app/main.py`. Полный список эндпоинтов с параметрами —
[`API.md`](API.md).

| Файл | Префикс и тег | Зона ответственности |
|---|---|---|
| `auth.py` | `/auth`, «Авторизация» | регистрация, вход, `GET /auth/me`; JWT выдаётся на 30 минут |
| `recipes.py` | `/recipes`, «Рецепты» | загрузка фото, создание рецепта с ингредиентами и шагами, публичная лента только `published`, «мои», поиск по названию, карточка с проверкой доступа, удаление владельцем |
| `comments.py` | `/comments`, «Комментарии» | последние комментарии, создание с ответом (`parent_id`) и уведомлениями, список, удаление автором |
| `favorites.py` | `/favorites`, «Избранное» | добавить/убрать/список избранных рецептов |
| `profile.py` | `/profile`, «Профиль» | свой профиль, обновление (PUT и PATCH), аватар (image/* до 2 МБ), ачивки, публичный профиль, смена пароля |
| `reviews.py` | `/reviews`, «Отзывы» | отзывы, лайки, комментарии к отзывам; **UI этот раздел не использует** |
| `geo.py` | `/geo`, «География» | города с поиском и ранжированием, добавление города (без авторизации), магазины города + личные магазины, добавление/удаление «магазина у дома» |
| `catalog.py` | `/catalog`, «Бюджетный подбор» | подбор под бюджет, полки, смета рецепта, сезонные продукты, история цен, тренды; источник — `price_quotes` |
| `baskets.py` | `/baskets`, «Наборы» | ленты наборов и блюд, создание из рецепта или вручную, предпросмотр, карточка, «что приготовить», обновление цен, лайки, комментарии и реакции, видимость, отметка позиций, оптимизация, шаринг, удаление |
| `go.py` | `/go`, «Партнёрские ссылки» | ссылка на магазин без перехода и редирект `302` с записью `PurchaseClick` |
| `mealplans.py` | `/mealplans`, «План питания» | предпросмотр (без сохранения), создание, список, карточка, удаление |
| `pantry.py` | `/pantry`, «Остатки дома» | список остатков, добавление с привязкой к продукту, удаление, подбор рецептов с расчётом докупки |
| `reactions.py` | без префикса, «Реакции» | `POST/DELETE/GET /recipes/{id}/reactions`, загрузка фото «что получилось» |
| `challenges.py` | `/challenges` + `/achievements` | челленджи, лидерборд, участие; ачивки, каталог, пересчёт |
| `admin.py` | `/admin`, «Модерация» | `whoami`, метрики, очередь, approve/reject/needs-changes, жалобы, санкции, журнал |
| `notifications.py` | `/notifications`, «Уведомления» | лента, счётчик непрочитанных, отметки, удаление |
| `reports.py` | `/reports`, «Жалобы» | справочник причин, создание жалобы, «мои жалобы» |
| `prices.py` | `/prices`, «Цены» | автодополнение продуктов, создание цены, «мои цены», свежие цены города, загрузка фото ценника, подтверждение модератором |
| `dashboard.py` | `/dashboard`, «Моя неделя» | сводка: активный план, наборы, траты, экономия, сравнение с доставкой, уровень |
| `promos.py` | `/promos`, «Акции» | лента акций, «мои», загрузка фото, создание с модерацией, карточка, лайки, удаление |

### Детали, которые важно знать

- **Создание рецепта** (`recipes.py`): схема `RecipeCreate` принимает `title`, `description`,
  `instructions`, `ingredients[]`, `steps[]`, `photo_url` — **без** `servings`, `category`,
  `cook_time_min`, `difficulty` и КБЖУ. Эти поля заполняют сиды (`seed_recipes_plain.py`,
  `seed_demo.py`) или миграция; через API их задать нельзя.
- **Проверка доступа к рецепту** — `can_view_recipe()`: неопубликованное видят автор и
  модераторы, остальным `404` (а не `403`), чтобы ссылка не подтверждала существование контента.
- **Комментарии** открыты только для `published`; автор и модераторы могут обсуждать
  неопубликованное (`_can_discuss`). Удалить комментарий к рецепту может только автор —
  у модератора такого права в этом роутере нет (в комментариях набора — есть).
- **Цены** (`prices.py`): автор с `trust_score >= 60` или ролью `moderator`/`admin` публикует
  цену сразу со `status='confirmed'`; остальные — `pending` + задача модерации. Санити-проверка:
  новая цена не должна отличаться от предыдущей более чем в 3 раза за последние 60 дней.
  Фото ценника: jpg/jpeg/png/webp, до 5 МБ, чтение порциями по 1 МБ.
- **Акции** (`promos.py`): `new_price` обязана быть ниже `old_price`; если город не передан,
  берётся `users.city_id`; публикация сразу — только при `trust_score >= 60` и отсутствии
  автофлагов.
- **Наборы** (`baskets.py`): удаление отвязывает рецепт (`recipes.basket_id = NULL`), чтобы блюдо
  осталось в разделе «Рецепты»; `share_token` генерируется `secrets.token_urlsafe(12)`;
  семейный режим разрешает отмечать позиции не только автору, но и любому пользователю
  (набор должен быть `is_public` или иметь `share_token`).
- **Админка** (`admin.py`): очередь сортируется по `priority desc, created_at desc`; превью
  объектов подгружаются пакетно (`_build_previews`), чтобы не было N+1; санкция `mute` по
  умолчанию ставится на 7 дней, `ban` выставляет `users.is_banned`.
- **Жалобы** (`reports.py`): одна открытая жалоба на объект от пользователя (повтор — `409`),
  не более 15 жалоб в сутки (иначе `429`), на себя жаловаться нельзя.
- **`/catalog/*`** — единственные эндпоинты, которые считают смету «на лету» по `price_quotes`.
  Если для выбранного города подтверждённых цен нет, используется город с наибольшим объёмом
  цен, а в ответе выставляется `prices_estimated = true`.
- **`/reviews`** зарегистрирован в `main.py`, хотя комментарий в `frontend/src/services/api.js`
  называет отзывы отключёнными: API живо, но фронтенд его не вызывает.

## Схемы, ядро и сборка приложения

### `app/schemas/`

| Файл | Основные классы |
|---|---|
| `user.py` | `UserCreate`, `UserLogin`, `UserUpdate`, `UserResponse`, `Token`, `TokenData` |
| `recipe.py` | `IngredientCreate/Response`, `RecipeStepCreate/Response`, `RecipeCreate/Response` |
| `comment.py` | `CommentCreate`, `CommentResponse` |
| `favorite.py` | `FavoriteResponse` |
| `achievement.py` | `AchievementResponse` |
| `reaction.py` | `ReactionIn`, `ReactionOut`, `RiOut`, `RecipeReactionsOut` |
| `review.py` | `ReviewCreate/Response`, `ReviewCommentCreate/Response`, `ReviewLikeResponse` |
| `mealplan.py` | `MealPlanGenerateIn`, `MealPlanOut`, `MealPlanItemOut`, `MealPlanDayOut`, `PantryItemIn/Out`, `PantrySuggestionOut` |
| `price.py` | `PriceQuoteCreateIn`, `PriceQuoteOut`, `ProductSearchOut` |
| `promo.py` | `PromoCreateIn`, `PromoOut`, `PromoListOut` |
| `report.py` | `REPORT_REASONS`, `ReportCreateIn`, `ReportOut` |
| `like.py` | `LikeResponse` |
| `smeta.py` | `Basket*` (создание, позиции, цены, комментарии, превью, лента), `CityOut/CityCreateIn`, `ShopOut/ShopCreateIn`, `RecipeCostOut`, `ShelfOut`, `BudgetSelectionOut`, `NutritionOut`, `TrendsOut`, `AffiliateLinkOut` |

В `smeta.py` есть дубли объявлений: `BasketItemIn` определён трижды, `BasketCreateIn` и
`BasketCommentIn` — по два раза. Python оставляет последнее объявление; это технический долг,
который стоит почистить при следующей правке схем.

### `app/core/`

- `database.py` — `DATABASE_URL` из окружения (fallback — `postgresql://recartly:recartly123@db:5432/recartly`),
  `create_engine`, `SessionLocal` (`autocommit=False`, `autoflush=False`), `Base`, `get_db()`.
  Здесь же опционально вызывается `load_dotenv()`: если пакет `python-dotenv` не установлен,
  `.env` игнорируется. В Docker переменные приходят из `environment` в compose, а не из `.env`.
- `security.py` — `SECRET_KEY` (fallback `recartly-super-secret-key-2026`), `ALGORITHM = "HS256"`,
  `ACCESS_TOKEN_EXPIRE_MINUTES = 30`, `verify_password`, `get_password_hash`,
  `create_access_token`, `decode_access_token`. В токене только `sub = email`.
- `config.py` — пуст; выделенного слоя настроек нет.

### `app/api/deps.py`

| Зависимость | Поведение |
|---|---|
| `get_current_user` | необязательная авторизация: без токена или с неверным токеном вернёт `None` |
| `get_current_user_required` | `401`, если нет/неверен токен или пользователь не найден |
| `get_current_moderator` | `403`, если роль не `moderator`/`admin` |
| `get_current_admin` | `403`, если роль не `admin` |

Роль всегда читается из БД (`User.role`), а не из JWT — блокировка или смена роли действуют
сразу, без перевыпуска токена.

### `app/main.py`

1. Создаёт `FastAPI(title="Recartly API", version="1.0.0")`.
2. Добавляет `CORSMiddleware` с `allow_origin_regex` для localhost и приватных сетей,
   `allow_credentials=True`, `allow_methods=["*"]`, `allow_headers=["*"]`.
3. Подключает 21 роутер (см. таблицу выше).
4. Создаёт каталог `uploads` при старте и монтирует `StaticFiles` на `/uploads`.
5. Отдаёт `GET /` (`{"message": "Welcome to Recartly API"}`) и `GET /health` (`{"status": "ok"}`).

Обработчиков исключений, middleware логирования и версионирования API нет. Swagger доступен по
`/docs`, OpenAPI — по `/openapi.json`.

## Скрипты (`backend/scripts/`)

Все скрипты запускаются из корня репозитория через `.venv\Scripts\python.exe backend\scripts\<имя>.py`
или внутри контейнера `docker compose exec backend python scripts/<имя>.py`. Большинство
подключается к `DATABASE_URL`, а при его отсутствии — к
`postgresql://recartly:recartly123@localhost:5432/recartly` (см. [`DEPLOY.md`](DEPLOY.md)).

| Скрипт | Что делает | Безопасность повторного запуска |
|---|---|---|
| `migrate_smeta.py` | главная миграция: `Base.metadata.create_all`; `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` для `recipes`, `users`, `products`, `meal_plans`, `comments`, `baskets`, `basket_items`, `shops`, `ingredients`; индексы и внешние ключи; перенос старых корзин в наборы (`migrate_legacy_carts`); нормализация продуктов; раскладка `instructions` по шагам; города (8 с ценами + полный справочник из `data/russian_cities.json`); 14 магазинов с профилями цен; 72 продукта; фасовка; стартовые цены (сначала удаляет `price_quotes.source='seed'`); исторические снапшоты за 30, 21, 14 и 7 дней; 4 стартовых челленджа | идемпотентен |
| `seed_baskets.py` | для каждого опубликованного рецепта собирает набор по ценам магазинов (или публикует существующий), ставит `recipe.basket_id`, удаляет тестовые наборы с названиями из `JUNK_TITLES` | идемпотентен по рецепту (проверяет существующий набор) |
| `seed_recipes_plain.py` | добавляет два рецепта без набора («Сырники классические», «Овсяная каша на молоке») от первого пользователя БД | пропускает существующие по названию |
| `seed_demo.py` | демо-рецепты с ингредиентами, КБЖУ и сметой | идемпотентен по названию |
| `build_cities.py` | читает `backend/data/russian_cities_raw.csv`, формирует `russian_cities.json` (название, регион, округ, население, slug) | перезаписывает JSON |
| `grant_admin.py` | назначает роль пользователю: `grant_admin.py <email> [роль]`, по умолчанию `smeta.tester@recartly.ru` / `admin`; печатает id и новую роль | безопасен |
| `check_db.py` | список таблиц, версия Alembic, количество строк в ключевых таблицах (в списке ещё старые `shopping_carts`/`cart_items` — они помечаются как отсутствующие) | только чтение |
| `check_schema.py` | проверяет наличие таблиц `basket_comment_reactions`, `user_shops`, `baskets`, `shops` и колонок `receipt_photo_url`, `photo_url`, `is_custom`, `created_by` | только чтение |
| `check_uploads.py` | берёт до трёх фото ингредиентов и проверяет, что `/uploads/...` отдаётся по HTTP с `localhost:8000` | только чтение |
| `summary.py` | количество строк в `baskets`, `basket_items`, `basket_likes`, `basket_comments`, `product_nutrition`, `recipes`, `products`, `users` | только чтение |
| `diagnose_recipes.py` | последние 8 рецептов: статус, причина отклонения, автор, доверие, роль, число шагов и ингредиентов | только чтение |
| `smoke_pricing.py` | прогоняет `pricing_service` на реальных рецептах и городе, печатает расчёт | только чтение |
| `smoke_mealplan.py` | запускает `mealplan_service.build_candidates` и генерацию, печатает трейсбек при ошибке | только чтение |
| `smoke_dashboard.py` | вызывает `week_summary` напрямую для тестового пользователя | только чтение |
| `audit_gaps.py` | сквозной аудит через HTTP (`localhost:8000`): публикация на модерации, краудсорсинг цен, жалобы, скорость подбора; требует запущенный API и пользователя `smeta.tester@recartly.ru` / `test1234` | создаёт тестовые данные |
| `cleanup_junk_recipes.py` | удаляет рецепты с ID 1 и 6 вместе со связями (`JUNK_IDS`) | **разрушительный**, ID зашиты |
| `cleanup_test_recipe.py` | удаляет рецепт «Тест шагов» и связанные записи | **разрушительный** |
| `cleanup_test_data.py` | убирает служебных пользователей `notif%`/`notifc%`, их контент и рецепты аудита; без `--apply` только показывает план | **разрушительный** при `--apply` |
| `cleanup_user_shops.py` | удаляет все `user_shops` и магазины с `is_custom = true` | **разрушительный** |

## Соглашения и технический долг

- **Модели — источник правды о схеме.** `migrate_smeta.py` создаёт таблицы через
  `Base.metadata.create_all` и догоняет существующие БД через `ADD COLUMN IF NOT EXISTS`.
  Alembic используется формально: в `backend/alembic/versions` только `001_add_photo_url.py`.
  При добавлении поля в модель нужно добавить его и в список колонок миграции, иначе на уже
  существующей БД колонка не появится.
- **Часть полей рецепта недоступна через API** (`servings`, `category`, `cook_time_min`,
  `difficulty`, КБЖУ). Если они нужны при создании — расширяйте `RecipeCreate` и
  `RecipeService.create_recipe`.
- **Нет отдельного слоя репозиториев.** Роуты работают с `Session` напрямую; сложные запросы
  вынесены в сервисы (`pricing_service`, `trends_service`, `mealplan_service`).
- **Даты.** В моделях — `DateTime(timezone=True)`; в коде встречаются и `datetime.utcnow()`, и
  `datetime.now(timezone.utc)`. При сравнении дат из БД в админке используется приведение к
  naive-UTC (`_as_utc_naive`).
- **Счётчики.** `likes_count`, `views_count`, `reactions_count`, `cooked_count`, `ri_score`
  обновляются вручную; при прямых правках БД их нужно пересчитывать (RI — через
  `recalculate_recipe_ri` или `POST /achievements/check` для ачивок).
- **Логирование** — точечное (`logging.getLogger(__name__)` в сервисах и части роутов), без
  единой конфигурации и структурных логов.
