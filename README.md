# Recartly — бюджет на еду

**Recartly — инструмент бюджета на еду, а не сайт рецептов.** Человек говорит, сколько у него денег
(«1000 ₽ на ужин на четверых»), и получает **набор продуктов** с ценами и датой покупки, а также
**блюда, которые из этого набора готовятся**. Ядро продукта — связка «деньги → закупка → готовые
блюда»; отсюда главный экран-витрина, набор как основная единица контента и цена, которая живёт
в наборе, а не в рецепте.

Проект состоит из FastAPI-бэкенда с PostgreSQL, React-приложения (Create React App + Tailwind),
Docker-окружения для разработки и production-сборки, раздаваемой nginx как PWA.

## Стек

| Слой | Технологии |
|---|---|
| Бэкенд | Python 3.11, FastAPI 0.104, SQLAlchemy 2.0, Pydantic 2, PostgreSQL 15, JWT (`python-jose`), bcrypt (`passlib`) |
| Фронтенд | React 18, React Router 6, Create React App 5, Tailwind CSS 3, `fetch` (без axios в коде) |
| Инфраструктура | Docker Compose (dev и prod), nginx (prod-статика), Redis 7 в compose (в коде не используется) |
| PWA | `manifest.json`, `sw.js` (офлайн-оболочка), `offline.html`, установка на домашний экран |
| Тесты | pytest + Playwright + Allure (`backend/tests`), CI в `.github/workflows/ci.yml` |

## Быстрый старт

### 1. Требования

- Python **3.11+** (в CI используется 3.11);
- Node.js **18+** и npm (CRA 5 и `node:18-alpine` в Dockerfile);
- Docker Desktop с Docker Compose;
- свободные порты `3000` (фронт), `8000` (API), `5432` (PostgreSQL), `6379` (Redis).

### 2. Поднять базу и бэкенд

```powershell
# из корня репозитория
docker compose up -d
```

Если контейнеры уже создавались ранее и Docker Desktop перезапускался:

```powershell
docker start recartly_db recartly_redis recartly_backend
```

Проверка: `http://localhost:8000/health` → `{"status":"ok"}`, документация API —
`http://localhost:8000/docs`.

### 3. Миграции и справочники

`backend/scripts/migrate_smeta.py` идемпотентно создаёт таблицы, добавляет колонки, индексы и
внешние ключи, заливает города, магазины, продукты и стартовые цены (подробнее —
[`docs/BACKEND.md`](docs/BACKEND.md#скрипты-backendscripts)).

Важно про подключение: скрипты по умолчанию используют
`postgresql://recartly:recartly123@localhost:5432/recartly`. Если переменная `DATABASE_URL` уже
задана в окружении, приоритет у неё. Внутри контейнера используется хост `db`, поэтому надёжный
вариант — выполнить миграцию в контейнере:

```powershell
docker compose exec backend python scripts/migrate_smeta.py
```

Запуск с хоста (Postgres проброшен на `localhost:5432`):

```powershell
.venv\Scripts\python.exe backend\scripts\migrate_smeta.py
```

Если в текущей сессии `DATABASE_URL` указывает на `db`, переопределите его:

```powershell
$env:DATABASE_URL = 'postgresql://recartly:recartly123@localhost:5432/recartly'
.venv\Scripts\python.exe backend\scripts\migrate_smeta.py
```

### 4. Демо-данные

```powershell
# наборы для всех опубликованных рецептов + привязка recipe.basket_id
.venv\Scripts\python.exe backend\scripts\seed_baskets.py

# два простых рецепта без набора — чтобы раздел «Рецепты» не был пустым
.venv\Scripts\python.exe backend\scripts\seed_recipes_plain.py

# (опционально) демо-рецепты с ингредиентами и КБЖУ, идемпотентно
.venv\Scripts\python.exe backend\scripts\seed_demo.py
```

Все три скрипта по умолчанию работают с `postgresql://recartly:recartly123@localhost:5432/recartly`;
переменная `DATABASE_URL` имеет приоритет.

### 5. Фронтенд

```powershell
cd frontend
npm install
npm start                 # http://localhost:3000, dev-сервер CRA
```

Адрес API берётся из `frontend/.env` (`REACT_APP_API_URL=http://localhost:8000`), но если там
`localhost`/`127.0.0.1`, клиент подставляет хост страницы и порт `8000` — так работает проверка
с телефона по локальному IP (см. [`docs/FRONTEND.md`](docs/FRONTEND.md#утилиты)).

Production-сборка и предпросмотр PWA:

```powershell
npm run build             # статика в frontend/build
npm run serve:build       # http://localhost:5055, SPA-fallback + PWA
```

Либо production-стек целиком:

```powershell
docker compose -f docker-compose.prod.yml up --build
# приложение: http://localhost:3000
```

### 6. Первый администратор

```powershell
.venv\Scripts\python.exe backend\scripts\grant_admin.py user@example.com admin
```

## Структура репозитория

```
recartly/
├── backend/
│   ├── app/
│   │   ├── main.py              сборка FastAPI: CORS, 21 роутер, /uploads, /health
│   │   ├── api/
│   │   │   ├── deps.py          зависимости авторизации: get_current_user(_required), модератор, админ
│   │   │   └── routes/          20 файлов роутеров (117 эндпоинтов), см. docs/API.md
│   │   ├── core/
│   │   │   ├── database.py      engine, SessionLocal, Base, get_db
│   │   │   ├── security.py      JWT (HS256, 30 мин), bcrypt
│   │   │   └── config.py        пустой файл — настройки читаются через os.getenv
│   │   ├── models/              18 файлов, 37 таблиц (SQLAlchemy)
│   │   ├── schemas/             13 файлов Pydantic-схем запросов и ответов
│   │   └── services/            9 сервисов: цены, продукты, рецепты, модерация, уведомления и др.
│   ├── scripts/                 19 скриптов: миграция, сиды, диагностика, очистка, smoke-тесты
│   ├── data/                    russian_cities.json и исходный CSV для build_cities.py
│   ├── alembic/                 Alembic (фактически одна ревизия 001_add_photo_url)
│   ├── tests/                   pytest + Playwright page objects (backend/pages)
│   ├── uploads/                 файлы, которые раздаёт /uploads (аватары и т. п.)
│   ├── Dockerfile               python:3.11-slim + uvicorn --reload
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.js               маршруты приложения (24 экрана)
│   │   ├── pages/               24 страницы
│   │   ├── components/          25 компонентов (карточки, навигация, онбординг, формы)
│   │   ├── services/
│   │   │   ├── api.js           базовый REST-клиент, авторизация, рецепты, профиль, админка
│   │   │   └── smeta.js         все функции «Сметы»: наборы, каталог, гео, меню, акции, цены
│   │   ├── utils/               media.js, promo.js, shopColors.js, hscroll.js, useSmartBack.js
│   │   ├── index.css            дизайн-система «Смета» (компонентные классы)
│   │   └── index.js             точка входа + регистрация service worker
│   ├── public/                  manifest.json, sw.js, offline.html, icons/
│   ├── DESIGN.md                дизайн-система и правила мобильной вёрстки
│   ├── README.md                заметки по фронтенду (частично устарели, см. docs/FRONTEND.md)
│   ├── nginx.conf               конфиг prod-раздачи
│   ├── Dockerfile               dev-образ (npm start)
│   └── Dockerfile.prod          build CRA → nginx
├── docs/                        документация проекта (этот набор)
├── docker-compose.yml           dev: db, redis, backend, frontend
├── docker-compose.prod.yml      prod: db, redis, backend, frontend (nginx-статика)
├── CONCEPT.md                   утверждённая концепция продукта
├── FEATURES_REVIEW.md           ревизия функционала: что оставить/переделать/вырезать
└── .env                         DATABASE_URL, REDIS_URL, SECRET_KEY для локального запуска
```

Каталоги `config/`, `utils/`, `test_data/`, `screenshots/`, `allure-*` относятся к тестовой
инфраструктуре и к работе приложения не подключены.

## Документация

| Документ | Что внутри |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | общая схема, потоки данных, диаграммы, принятые решения |
| [`docs/BACKEND.md`](docs/BACKEND.md) | модели, сервисы, роутеры, схемы, скрипты |
| [`docs/FRONTEND.md`](docs/FRONTEND.md) | маршруты, страницы, компоненты, сервисы, дизайн-система, PWA |
| [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) | таблицы, связи, ER-диаграмма, индексы и история цен |
| [`docs/API.md`](docs/API.md) | справочник эндпоинтов и примеры запросов |
| [`docs/DEPLOY.md`](docs/DEPLOY.md) | запуск, окружения, миграции, особенности Windows, PWA/APK |
| [`CONCEPT.md`](CONCEPT.md) | зачем продукт и как он устроен по замыслу |
| [`FEATURES_REVIEW.md`](FEATURES_REVIEW.md) | решения по составу функционала |
| [`frontend/DESIGN.md`](frontend/DESIGN.md) | токены и правила вёрстки |

## Переменные окружения (кратко)

| Переменная | Где | Назначение |
|---|---|---|
| `DATABASE_URL` | `.env`, docker-compose, окружение | строка подключения SQLAlchemy; по умолчанию `postgresql://recartly:recartly123@db:5432/recartly` |
| `SECRET_KEY` | `.env`, docker-compose | подпись JWT; в `security.py` есть fallback-значение |
| `REDIS_URL` | `.env`, docker-compose | зарезервировано: Redis поднят, но код его не использует |
| `REACT_APP_API_URL` | `frontend/.env` | адрес API, вшивается в сборку CRA |

Подробности и порядок первого запуска — [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Что важно знать о текущем состоянии

- **Цена в наборе.** `basket_items.price` — авторская цена покупки, `prev_price` — предыдущая
  (для «было 55 ₽, стало 48 ₽»), `baskets.prices_date` — дата, на которую цены собраны.
- **Справочник цен тоже жив.** `price_quotes` используется для автосборки набора из рецепта и
  эндпоинтами `/catalog/*`; в расчёты попадают только записи со `status='confirmed'`.
  Витрина при этом работает на готовых наборах (`/baskets/feed`, `/baskets/dishes`).
- **Города скрыты из основных сценариев**, но модели, API `/geo/*` и `CityCombobox` живы
  (город используется в форме акции).
- **Модерация включается по доверию.** Публикация уходит в очередь, если `trust_score < 60`
  или автофлаги нашли ссылки/телефоны/спам; иначе публикуется сразу.
- **Alembic не является основным механизмом миграций**: схема живёт в моделях и
  `migrate_smeta.py`, в Alembic есть только ревизия `001_add_photo_url`.
