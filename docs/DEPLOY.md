# Запуск и развёртывание Recartly

Документ описывает локальный запуск, Docker-окружения, переменные среды, миграции и сиды,
особенности Windows, PWA и план упаковки в APK. Все команды приведены для PowerShell из корня
репозитория.

## Оглавление

1. [Окружения](#окружения)
2. [Требования](#требования)
3. [Переменные окружения](#переменные-окружения)
4. [Первый запуск по шагам](#первый-запуск-по-шагам)
5. [Docker Compose: dev](#docker-compose-dev)
6. [Docker Compose: prod](#docker-compose-prod)
7. [Особенности Windows](#особенности-windows)
8. [PWA и план упаковки в APK](#pwa-и-план-упаковки-в-apk)
9. [CI](#ci)
10. [Диагностика](#диагностика)

## Окружения

| Окружение | Файл | Что внутри | Адрес приложения |
|---|---|---|---|
| Локальная разработка | `docker-compose.yml` | PostgreSQL, Redis, FastAPI с `--reload`, CRA dev-сервер | `http://localhost:3000` |
| Production-подобное | `docker-compose.prod.yml` | PostgreSQL, Redis, FastAPI без reload, nginx со статикой CRA | `http://localhost:3000` (nginx слушает 80 внутри) |
| Без Docker (фронт) | `npm start` | CRA dev-сервер, API — отдельно на `:8000` | `http://localhost:3000` |
| Без Docker (предпросмотр сборки) | `npm run build` + `npm run serve:build` | мини-сервер `frontend/scripts/serve-build.js` | `http://localhost:5055` |

## Требования

- Python 3.11+ (CI использует 3.11, Docker-образ — `python:3.11-slim`);
- Node.js 18+ (Docker-образы — `node:18-alpine`);
- Docker Desktop с Docker Compose v2;
- свободные порты: `3000`, `8000`, `5432`, `6379`, `5055` (предпросмотр сборки).

## Переменные окружения

### Корневой `.env`

```dotenv
DATABASE_URL=postgresql://recartly:recartly123@db:5432/recartly
REDIS_URL=redis://redis:6379/0
SECRET_KEY=recartly-super-secret-key-2026
```

Важно: `docker-compose.yml` **не использует** `env_file` и не подставляет значения из `.env`
(в нём нет `${...}`). Переменные контейнерам заданы явно в секции `environment`. Поэтому корневой
`.env` нужен для локального запуска без Docker и для ручного экспорта; на compose он не влияет.

### Переменные контейнера бэкенда

| Переменная | Значение в dev-compose | Значение в prod-compose | Комментарий |
|---|---|---|---|
| `DATABASE_URL` | `postgresql://recartly:recartly123@db:5432/recartly` | то же | хост `db` — имя сервиса compose |
| `REDIS_URL` | `redis://redis:6379/0` | то же | зарезервировано, код Redis не использует |
| `SECRET_KEY` | `your-super-secret-key-change-me` | то же | подпись JWT; **замените перед публикацией** |

`SECRET_KEY` в compose перекрывает значение из `.env`, потому что переменная уже есть в
окружении процесса (`load_dotenv` не перезаписывает существующие переменные). Если
`python-dotenv` не установлен, `.env` не читается вовсе — `database.py` использует fallback
`postgresql://recartly:recartly123@db:5432/recartly`.

### Фронтенд

`frontend/.env`:

```dotenv
REACT_APP_API_URL=http://localhost:8000
```

- значение **вшивается на этапе сборки** CRA: после `npm run build` менять его бесполезно,
  нужна пересборка;
- если значение пустое или содержит `localhost`/`127.0.0.1`, клиент подставляет хост страницы и
  порт `8000` (см. [`FRONTEND.md`](FRONTEND.md#как-вычисляется-api_url));
- для публикации на домене укажите реальный адрес API и пересоберите фронтенд.

### CORS

`backend/app/main.py` разрешает источники по регулярному выражению: `localhost`, `127.0.0.1`,
`10.*`, `192.168.*`, `172.16–31.*` с любым портом. Публичного домена в списке нет: при деплое
на внешний адрес добавьте его в `allow_origin_regex` (это единственное место) и перезапустите
бэкенд.

## Первый запуск по шагам

### Вариант А: всё в Docker

```powershell
# 1. База и Redis
docker compose up -d db redis

# 2. Сборка и запуск бэкенда и фронтенда
docker compose up -d backend frontend

# 3. Миграция и справочники (внутри контейнера, хост db резолвится)
docker compose exec backend python scripts/migrate_smeta.py

# 4. Проверка
curl.exe -s http://localhost:8000/health
# {"status":"ok"}
```

Дальше создайте пользователя через интерфейс (`http://localhost:3000/register`) или API, затем
наполните демо-данными:

```powershell
# демо-рецепты с ингредиентами и КБЖУ
docker compose exec backend python scripts/seed_demo.py

# два рецепта без набора
docker compose exec backend python scripts/seed_recipes_plain.py

# наборы для всех опубликованных рецептов
docker compose exec backend python scripts/seed_baskets.py

# роль администратора для проверки модерации
docker compose exec backend python scripts/grant_admin.py user@example.com admin
```

Порядок важен: `seed_recipes_plain.py` берёт первого пользователя из БД, а `seed_baskets.py`
работает по уже существующим опубликованным рецептам.

### Вариант Б: база в Docker, приложение локально

```powershell
# 1. Только база (и Redis, если нужен)
docker compose up -d db redis

# 2. Python-окружение (один раз)
python -m venv .venv
.venv\Scripts\pip install -r backend\requirements.txt

# 3. Миграция с хоста (Postgres проброшен на localhost:5432)
.venv\Scripts\python.exe backend\scripts\migrate_smeta.py

# 4. Бэкенд
cd backend
..\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# 5. Фронтенд (в отдельном терминале)
cd frontend
npm install
npm start
```

При локальном запуске бэкенда без Docker `DATABASE_URL` нужно задать явно — иначе сработает
fallback на хост `db`, которого на хосте нет:

```powershell
$env:DATABASE_URL = 'postgresql://recartly:recartly123@localhost:5432/recartly'
```

Скрипты из `backend/scripts` наоборот по умолчанию используют `localhost` — им переопределение
не нужно, если переменная не задана в сессии.

## Docker Compose: dev

`docker-compose.yml`:

| Сервис | Образ / сборка | Порты | Особенности |
|---|---|---|---|
| `db` | `postgres:15`, контейнер `recartly_db` | `5432:5432` | пользователь/пароль/БД `recartly` / `recartly123` / `recartly`; том `postgres_data` |
| `redis` | `redis:7`, контейнер `recartly_redis` | `6379:6379` | приложением не используется |
| `backend` | `build: ./backend`, контейнер `recartly_backend` | `8000:8000` | `uvicorn --reload`, bind-mount `./backend:/app` |
| `frontend` | `build: ./frontend`, контейнер `recartly_frontend` | `3000:3000` | `npm start`, bind-mount `./frontend:/app` + анонимный том `/app/node_modules`, `REACT_APP_API_URL=http://localhost:8000` |

Остановка и удаление:

```powershell
docker compose stop                 # остановить
docker compose down                 # удалить контейнеры, данные БД останутся в томе
docker compose down -v              # удалить и том с данными (разрушительно)
```

## Docker Compose: prod

`docker-compose.prod.yml`:

| Сервис | Образ / сборка | Порты | Отличия от dev |
|---|---|---|---|
| `db` | `postgres:15`, контейнер `recartly_db_prod` | **не публикуется** | том `postgres_data_prod`; снаружи БД недоступна |
| `redis` | `redis:7`, контейнер `recartly_redis_prod` | не публикуется | — |
| `backend` | `build: ./backend`, контейнер `recartly_backend_prod` | `8000:8000` | без `--reload` |
| `frontend` | `frontend/Dockerfile.prod`, контейнер `recartly_frontend_prod` | `3000:80` | multi-stage: `npm ci` + `npm run build` → nginx |

Запуск:

```powershell
docker compose -f docker-compose.prod.yml up --build
# приложение: http://localhost:3000
```

Так как порт БД не опубликован, миграцию с хоста выполнить нельзя — только в контейнере:

```powershell
docker compose -f docker-compose.prod.yml exec backend python scripts/migrate_smeta.py
```

Что важно для реального продакшена (сейчас не сделано):

- `SECRET_KEY` и пароль БД зашиты в compose — вынесите в секреты/переменные окружения;
- нет TLS: nginx слушает только 80, HTTPS обычно терминируется внешним прокси;
- нет healthcheck и политики рестарта (`restart: unless-stopped`);
- CORS не содержит публичного домена;
- фронтенд собирается с `REACT_APP_API_URL` из `frontend/.env`; для домена значение нужно
  изменить до сборки;
- каталог `uploads` живёт внутри контейнера бэкенда (bind-mount `./backend:/app`), поэтому файлы
  сохраняются на хосте в `backend/uploads`, но не отдаются nginx напрямую — только через API.

## Особенности Windows

1. **Bind-mount и правки кода.** Docker Desktop на Windows не всегда передаёт события файловой
   системы в контейнер, поэтому `uvicorn --reload` и `react-scripts start` могут не увидеть
   изменения. После правок:
   ```powershell
   docker restart recartly_backend
   docker restart recartly_frontend
   ```
2. **Надёжнее держать фронтенд локально.** `npm start` вне контейнера работает с hot-reload
   предсказуемо, а бэкенд остаётся в Docker:
   ```powershell
   cd frontend
   npm install
   npm start
   ```
3. **Проверка production-сборки без Docker.**
   ```powershell
   cd frontend
   npm run build
   npm run serve:build     # http://localhost:5055
   ```
   Для проверки с телефона задайте порт, разрешённый CORS: `$env:PORT=3000; npm run serve:build`.
4. **Пути и регистр.** Скрипты запускайте из корня репозитория; `uploads` монтируется относительно
   рабочего каталога процесса (`backend/uploads` в контейнере).
5. **Первая сборка** `docker compose up --build` занимает время: `npm install` в контейнере
   фронтенда и `pip install` в бэкенде выполняются при сборке образа.
6. **Кодировка.** Файлы проекта — UTF-8; при выводе русских строк в старом `cmd.exe` возможны
   кракозябры, в PowerShell 7 проблемы нет.

## PWA и план упаковки в APK

### PWA (уже работает)

- `frontend/public/manifest.json` — имя, `standalone`, портретная ориентация, иконки, shortcuts;
- `frontend/public/sw.js` — офлайн-оболочка: навигация network-first с фолбэком на `index.html`,
  статика stale-while-revalidate, API и `/uploads` — только сеть;
- `frontend/src/serviceWorkerRegistration.js` — регистрация **только в production**;
- `frontend/nginx.conf` — `no-cache` для `sw.js`, `manifest.json`, `index.html`, долгий кэш для
  `/static/`;
- установка: Android/Chrome — «Установить приложение», iOS/Safari — «На экран “Домой”».
  Для установки нужен HTTPS или localhost; по локальному IP удобно поднять туннель.

Проверка PWA: `docker compose -f docker-compose.prod.yml up --build` или
`npm run build && npm run serve:build`.

### APK (план)

В репозитории **нет** конфигурации Capacitor — это заложенный, но не реализованный этап. План
из `CONCEPT.md`:

1. веб + PWA — текущее состояние;
2. хостинг и домен для API;
3. упаковка готового веб-билда в APK через **Capacitor**;
4. публикация в **RuStore** как основном канале + прямая ссылка на APK с сайта;
5. App Store — только при появлении нативных функций (Apple отклоняет «просто сайт»).

Что уже учтено в коде под будущую упаковку:

- API задаётся абсолютным адресом (`REACT_APP_API_URL`), относительных путей к API нет;
- внешние переходы (магазины) идут через `/go/{shop_id}` — в приложении их можно открывать
  системным браузером;
- загрузка фото реализована через `<input type="file">`, что в WebView заменяется камерой;
- мобильная вёрстка, safe-area, нижняя навигация, офлайн-заглушка;
- точки для пуш-уведомлений (сейчас уведомления только внутри приложения).

## CI

`.github/workflows/ci.yml` на push/PR в `main`/`master`:

1. ставит Python 3.11 и зависимости `backend/requirements.txt` + Playwright Chromium;
2. поднимает `docker compose` (`db`, `redis`, затем `backend`, `frontend`);
3. пытается создать legacy-таблицы через `psql` (шаг с `continue-on-error: true`);
4. запускает `pytest tests/ --alluredir=allure-results -v`;
5. генерирует и публикует Allure-отчёт артефактами.

Шаг с ручным `CREATE TABLE` описывает старую схему (`password_hash`, `ingredients TEXT`) и оставлен
как исторический; актуальная схема создаётся `migrate_smeta.py`. При падении тестов в CI сначала
проверьте, что контейнеры поднялись и БД доступна.

## Диагностика

| Симптом | Что проверить |
|---|---|
| `Failed to fetch` на фронте | API запущен на `:8000`; `REACT_APP_API_URL` или хост страницы; CORS |
| `401` после работы | истёк JWT (30 минут) — войдите заново |
| `404` на `/uploads/...` | файл лежит в рабочем каталоге процесса (`backend/uploads`), а не в корневом `uploads/` |
| Правки не видны в контейнере | `docker restart recartly_backend` / `recartly_frontend`; на Windows — запускать фронт локально |
| Ошибка миграции про существующую колонку | миграция идемпотентна (`IF NOT EXISTS`); проверьте, что запускается именно `migrate_smeta.py`, а не Alembic |
| Пустая лента наборов | нет опубликованных наборов: выполните `seed_baskets.py`; проверьте `is_public` и `status` |
| Публикация не видна другим | `status = pending` (модерация) — проверьте `/admin/queue` или `trust_score` автора |
| Нужно посмотреть состояние БД | `check_db.py`, `summary.py`, `diagnose_recipes.py`, `check_schema.py` |

Полезные команды:

```powershell
docker compose logs -f backend
docker compose ps
docker compose exec db psql -U recartly -d recartly -c "select count(*) from baskets;"
```

Резервная копия БД (вручную, вне приложения; `-f` внутри контейнера, чтобы PowerShell не менял
кодировку файла):

```powershell
docker compose exec db pg_dump -U recartly -f /tmp/backup.sql recartly
docker compose cp db:/tmp/backup.sql backup.sql
```
