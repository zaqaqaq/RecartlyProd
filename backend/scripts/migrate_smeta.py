"""Миграция и наполнение БД Recartly под концепцию «Смета».

Что делает (идемпотентно, можно запускать повторно):
  1. создаёт отсутствующие таблицы (города, магазины, продукты, цены, реакции, сметы,
     модерация, планы питания, челленджи);
  2. добавляет новые колонки в существующие recipes и users (ADD COLUMN IF NOT EXISTS);
  3. создаёт индексы и внешние ключи для новых колонок;
  4. наполняет справочники: города, магазины, присутствие магазинов в городах,
     продукты с КБЖУ и сезонностью, а также стартовые цены по магазинам и городам
     и исторические снапшоты цен (30, 21, 14 и 7 дней назад) — без них не работает
     динамика «что подешевело».

Запуск (с хоста, Postgres проброшен на localhost:5432):
    .venv\\Scripts\\python.exe backend\\scripts\\migrate_smeta.py
Запуск в контейнере:
    docker compose exec backend python scripts/migrate_smeta.py
"""

import hashlib
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine, text

# Чтобы импортировался пакет app при запуске из любой папки
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.database import Base  # noqa: E402
import app.models  # noqa: E402,F401  — регистрирует все модели в metadata

DATABASE_URL = os.getenv(
    'DATABASE_URL',
    'postgresql://recartly:recartly123@localhost:5432/recartly',
)

# ---------- Новые колонки существующих таблиц ----------

RECIPE_COLUMNS = [
    ('servings', 'integer NOT NULL DEFAULT 2'),
    ('cook_time_min', 'integer'),
    ('difficulty', 'integer'),
    ('category', 'varchar'),
    ('city_id', 'integer'),
    ('season_months', 'varchar'),
    ('kcal_per_serving', 'double precision'),
    ('protein_per_serving', 'double precision'),
    ('fat_per_serving', 'double precision'),
    ('carbs_per_serving', 'double precision'),
    ('ri_score', 'double precision'),
    ('reactions_count', 'integer NOT NULL DEFAULT 0'),
    ('cooked_count', 'integer NOT NULL DEFAULT 0'),
    ('status', "varchar NOT NULL DEFAULT 'published'"),
    ('reject_reason', 'varchar'),
    ('moderated_by', 'integer'),
    ('moderated_at', 'timestamp with time zone'),
    ('is_verified', 'boolean NOT NULL DEFAULT false'),
    # Блюдо готовится из набора; без набора живёт в разделе «Рецепты»
    ('basket_id', 'integer'),
]

USER_COLUMNS = [
    ('role', "varchar NOT NULL DEFAULT 'user'"),
    ('trust_score', 'double precision NOT NULL DEFAULT 50'),
    ('city_id', 'integer'),
    ('is_banned', 'boolean NOT NULL DEFAULT false'),
    ('muted_until', 'timestamp with time zone'),
    ('points', 'integer NOT NULL DEFAULT 0'),
    ('level', 'integer NOT NULL DEFAULT 1'),
]

PRODUCT_COLUMNS = [
    ('pack_size', 'double precision'),
    ('pack_units', 'double precision'),
    # Нормализованное название: защита от дублей и основа автодополнения
    ('normalized_name', 'varchar'),
]

# Набор — центральная сущность: публичный контент с ценами и датой покупки
BASKET_COLUMNS = [
    ('description', 'text'),
    ('photo_url', 'varchar'),
    # Фото чека — подтверждение цен, отдельно от картинки набора
    ('receipt_photo_url', 'varchar'),
    ('servings', 'integer NOT NULL DEFAULT 2'),
    ('prices_date', 'timestamp with time zone'),
    ('status', "varchar NOT NULL DEFAULT 'published'"),
    ('reject_reason', 'varchar'),
    ('likes_count', 'integer NOT NULL DEFAULT 0'),
    ('views_count', 'integer NOT NULL DEFAULT 0'),
    ('is_public', 'boolean NOT NULL DEFAULT false'),
    ('created_at', 'timestamp with time zone DEFAULT now()'),
    ('updated_at', 'timestamp with time zone'),
]

BASKET_ITEM_COLUMNS = [
    # Цена до обновления — из неё получается «было 55 ₽, стало 48 ₽»
    ('prev_price', 'double precision'),
    # Фото покупки (как выглядит продукт)
    ('photo_url', 'varchar'),
]

# Магазины, добавленные пользователями («магазин у дома»)
SHOP_COLUMNS = [
    ('is_custom', 'boolean NOT NULL DEFAULT false'),
    ('created_by', 'integer'),
]

# Ингредиенты: фото продукта и порядок в списке
INGREDIENT_COLUMNS = [
    ('photo_url', 'varchar'),
    ('position', 'integer NOT NULL DEFAULT 0'),
]

MEALPLAN_COLUMNS = [
    ('servings', 'integer NOT NULL DEFAULT 2'),
]

# Ответы на комментарии: ссылка на родительский комментарий
COMMENT_COLUMNS = [
    ('parent_id', 'integer'),
]

# Типовая фасовка по категориям (граммы и штуки в упаковке) — чтобы считать
# стоимость «400 г макарон», а не «400 упаковок».
PACK_BY_CATEGORY = {
    'Овощи': (300.0, 1.0),
    'Фрукты': (300.0, 1.0),
    'Мясо': (400.0, 1.0),
    'Рыба': (300.0, 1.0),
    'Молочное': (200.0, 1.0),
    'Бакалея': (400.0, 1.0),
    'Напитки': (500.0, 1.0),
    'Заморозка': (400.0, 1.0),
}

# Точечные уточнения: (граммы в упаковке / масса штуки, штук в упаковке)
PACK_OVERRIDES = {
    # Весовые продукты, которые в рецептах указывают штуками: масса одной штуки
    'Картофель': (150.0, 1.0),
    'Морковь': (100.0, 1.0),
    'Лук репчатый': (120.0, 1.0),
    'Помидоры': (150.0, 1.0),
    'Огурцы': (120.0, 1.0),
    'Огурцы солёные': (100.0, 1.0),
    'Перец болгарский': (150.0, 1.0),
    'Кабачок': (400.0, 1.0),
    'Свёкла': (200.0, 1.0),
    'Чеснок': (50.0, 1.0),
    'Брокколи': (400.0, 1.0),
    'Капуста белокочанная': (1200.0, 1.0),
    'Шампиньоны': (300.0, 1.0),
    'Яблоки': (180.0, 1.0),
    'Бананы': (150.0, 1.0),
    'Апельсины': (200.0, 1.0),
    'Лимоны': (120.0, 1.0),
    'Клубника': (300.0, 1.0),
    'Виноград': (300.0, 1.0),
    # Штучные и упакованные товары
    'Яйца куриные': (550.0, 10.0),
    'Сосиски': (400.0, 8.0),
    'Колбаса варёная': (400.0, 1.0),
    'Хлеб': (400.0, 1.0),
    'Лаваш': (250.0, 1.0),
    'Шоколад тёмный': (90.0, 1.0),
    'Йогурт натуральный': (150.0, 1.0),
    'Мороженое': (100.0, 1.0),
    'Тунец консервированный': (185.0, 1.0),
    'Фасоль консервированная': (400.0, 1.0),
    'Горошек зелёный консервированный': (400.0, 1.0),
    'Кукуруза консервированная': (400.0, 1.0),
    'Томаты в собственном соку': (400.0, 1.0),
    'Томатная паста': (250.0, 1.0),
    'Соевый соус': (250.0, 1.0),
    'Майонез': (400.0, 1.0),
    'Сметана 20%': (300.0, 1.0),
    'Творог 5%': (200.0, 1.0),
    'Масло сливочное': (180.0, 1.0),
    'Овсяные хлопья': (400.0, 1.0),
    'Макароны': (400.0, 1.0),
    'Пельмени': (800.0, 1.0),
    'Креветки': (400.0, 1.0),
    'Бекон': (200.0, 1.0),
    'Сыр твёрдый': (200.0, 1.0),
    'Зелень свежая': (50.0, 1.0),
}

INDEXES = [
    'CREATE INDEX IF NOT EXISTS ix_recipes_status ON recipes (status)',
    'CREATE INDEX IF NOT EXISTS ix_recipes_ri_score ON recipes (ri_score)',
    'CREATE INDEX IF NOT EXISTS ix_recipes_category ON recipes (category)',
    'CREATE INDEX IF NOT EXISTS ix_users_role ON users (role)',
    'CREATE INDEX IF NOT EXISTS ix_cities_slug ON cities (slug)',
    'CREATE INDEX IF NOT EXISTS ix_cities_name ON cities (name)',
    'CREATE INDEX IF NOT EXISTS ix_cities_population ON cities (population)',
    'CREATE INDEX IF NOT EXISTS ix_shops_slug ON shops (slug)',
    'CREATE INDEX IF NOT EXISTS ix_products_name ON products (name)',
    'CREATE INDEX IF NOT EXISTS ix_comments_parent_id ON comments (parent_id)',
    'CREATE INDEX IF NOT EXISTS ix_notifications_user_read ON notifications (user_id, is_read)',
]

FOREIGN_KEYS = [
    ('recipes', 'fk_recipes_city', 'city_id', 'cities', 'id', 'SET NULL'),
    ('recipes', 'fk_recipes_moderator', 'moderated_by', 'users', 'id', 'SET NULL'),
    ('users', 'fk_users_city', 'city_id', 'cities', 'id', 'SET NULL'),
    ('comments', 'fk_comments_parent', 'parent_id', 'comments', 'id', 'SET NULL'),
]

# ---------- Справочник городов ----------

CITIES = [
    ('Москва', 'moskva', 'Москва', 13_000_000, 1.12),
    ('Санкт-Петербург', 'sankt-peterburg', 'Ленинградская область', 5_600_000, 1.06),
    ('Казань', 'kazan', 'Татарстан', 1_300_000, 1.00),
    ('Екатеринбург', 'ekaterinburg', 'Свердловская область', 1_500_000, 1.02),
    ('Новосибирск', 'novosibirsk', 'Новосибирская область', 1_600_000, 0.98),
    ('Краснодар', 'krasnodar', 'Краснодарский край', 1_100_000, 1.00),
    ('Нижний Новгород', 'nizhniy-novgorod', 'Нижегородская область', 1_200_000, 0.99),
    ('Самара', 'samara', 'Самарская область', 1_100_000, 0.96),
]

# ---------- Справочник магазинов ----------
# (название, slug, эмодзи, цвет, онлайн, шаблон партнёрской ссылки, базовый коэффициент, партнёр,
#  профиль по категориям — за счёт него и возникает выгода «разложить по магазинам»)
SHOPS = [
    ('Пятёрочка', 'pyaterochka', '🏪', '#00a13a', False, 'https://5ka.ru/search/?q={query}', 0.95, True,
     {'Овощи': 0.95, 'Фрукты': 0.98, 'Мясо': 1.05, 'Рыба': 1.05, 'Молочное': 1.0, 'Бакалея': 0.95, 'Напитки': 1.0, 'Заморозка': 0.98}),
    ('Магнит', 'magnit', '🔴', '#e4002b', False, 'https://magnit.ru/search/?q={query}', 0.93, True,
     {'Овощи': 0.92, 'Фрукты': 0.95, 'Мясо': 1.0, 'Рыба': 1.02, 'Молочное': 0.98, 'Бакалея': 0.9, 'Напитки': 0.98, 'Заморозка': 0.95}),
    ('Лента', 'lenta', '🔵', '#004b93', False, 'https://lenta.com/search/?q={query}', 1.00, True,
     {'Овощи': 1.0, 'Фрукты': 1.0, 'Мясо': 0.9, 'Рыба': 0.94, 'Молочное': 1.0, 'Бакалея': 0.98, 'Напитки': 1.0, 'Заморозка': 1.0}),
    ('Перекрёсток', 'perekrestok', '🟢', '#009a49', False, 'https://www.perekrestok.ru/search?q={query}', 1.08, False,
     {'Овощи': 1.08, 'Фрукты': 1.1, 'Мясо': 1.05, 'Рыба': 1.08, 'Молочное': 1.08, 'Бакалея': 1.05, 'Напитки': 1.1, 'Заморозка': 1.08}),
    ('ВкусВилл', 'vkusvill', '🥗', '#1c8a4b', False, 'https://vkusvill.ru/search/?q={query}', 1.25, False,
     {'Овощи': 1.2, 'Фрукты': 1.25, 'Мясо': 1.35, 'Рыба': 1.4, 'Молочное': 1.35, 'Бакалея': 1.2, 'Напитки': 1.3, 'Заморозка': 1.25}),
    ('Ашан', 'auchan', '🛒', '#e2001a', False, 'https://www.auchan.ru/search/?q={query}', 0.97, False,
     {'Овощи': 0.95, 'Фрукты': 0.97, 'Мясо': 0.98, 'Рыба': 1.0, 'Молочное': 0.96, 'Бакалея': 0.9, 'Напитки': 0.95, 'Заморозка': 0.94}),
    ('METRO', 'metro', '🏬', '#003d7c', False, 'https://metro-cc.ru/search/?q={query}', 0.92, False,
     {'Овощи': 0.98, 'Фрукты': 1.0, 'Мясо': 0.86, 'Рыба': 0.88, 'Молочное': 0.94, 'Бакалея': 0.88, 'Напитки': 0.92, 'Заморозка': 0.9}),
    ('Чижик', 'chizhik', '🐥', '#f5a524', False, 'https://chizhik.ru/search?q={query}', 0.88, True,
     {'Овощи': 0.88, 'Фрукты': 0.92, 'Мясо': 1.05, 'Рыба': 1.12, 'Молочное': 0.9, 'Бакалея': 0.84, 'Напитки': 0.95, 'Заморозка': 0.88}),
    ('Ярче!', 'yarche', '☀️', '#f2a93b', False, None, 0.94, False,
     {'Овощи': 0.94, 'Фрукты': 0.96, 'Мясо': 1.0, 'Рыба': 1.05, 'Молочное': 0.95, 'Бакалея': 0.92, 'Напитки': 0.98, 'Заморозка': 0.95}),
    ('SPAR', 'spar', '🟠', '#e8541f', False, None, 1.05, False,
     {'Овощи': 1.02, 'Фрукты': 1.05, 'Мясо': 1.05, 'Рыба': 1.08, 'Молочное': 1.05, 'Бакалея': 1.05, 'Напитки': 1.08, 'Заморозка': 1.05}),
    ('Ozon', 'ozon', '📦', '#005bff', True, 'https://www.ozon.ru/search/?text={query}', 1.00, True,
     {'Овощи': 1.05, 'Фрукты': 1.0, 'Мясо': 0.98, 'Рыба': 0.94, 'Молочное': 1.02, 'Бакалея': 0.92, 'Напитки': 0.95, 'Заморозка': 0.98}),
    ('Wildberries', 'wildberries', '🟣', '#cb11ab', True, 'https://www.wildberries.ru/catalog/0/search.aspx?search={query}', 0.98, True,
     {'Овощи': 1.0, 'Фрукты': 0.95, 'Мясо': 1.0, 'Рыба': 1.0, 'Молочное': 1.05, 'Бакалея': 0.9, 'Напитки': 0.92, 'Заморозка': 0.95}),
    ('Яндекс Лавка', 'yandex-lavka', '🟡', '#fc3f1d', True, 'https://lavka.yandex.ru/search?text={query}', 1.15, True,
     {'Овощи': 1.15, 'Фрукты': 1.15, 'Мясо': 1.2, 'Рыба': 1.2, 'Молочное': 1.15, 'Бакалея': 1.15, 'Напитки': 1.2, 'Заморозка': 1.15}),
    ('Самокат', 'samokat', '🛴', '#ff335f', True, 'https://samokat.ru/search?query={query}', 1.18, True,
     {'Овощи': 1.18, 'Фрукты': 1.2, 'Мясо': 1.22, 'Рыба': 1.25, 'Молочное': 1.18, 'Бакалея': 1.15, 'Напитки': 1.22, 'Заморозка': 1.2}),
]

# ---------- Продукты ----------
# (название, категория, единица, ккал/100, белки, жиры, углеводы, сезон, алиасы, базовая цена ₽)

PRODUCTS = [
    # Овощи
    ('Картофель', 'Овощи', 'кг', 77, 2.0, 0.1, 17.0, '7,8,9', 'картошка,картофель молодой', 45),
    ('Морковь', 'Овощи', 'кг', 35, 1.3, 0.1, 7.0, '6,7,8,9,10', 'морковка', 55),
    ('Лук репчатый', 'Овощи', 'кг', 41, 1.4, 0.2, 10.4, '6,7,8,9,10', 'лук,луковица', 45),
    ('Помидоры', 'Овощи', 'кг', 20, 1.1, 0.2, 3.7, '7,8,9', 'томаты,помидор', 220),
    ('Огурцы', 'Овощи', 'кг', 15, 0.8, 0.1, 2.8, '6,7,8', 'огурец,огурчики', 180),
    ('Капуста белокочанная', 'Овощи', 'кг', 28, 1.8, 0.1, 4.7, '8,9,10,11', 'капуста', 40),
    ('Свёкла', 'Овощи', 'кг', 43, 1.5, 0.1, 8.8, '8,9,10', 'свекла,буряк', 50),
    ('Перец болгарский', 'Овощи', 'кг', 27, 1.3, 0.1, 5.3, '7,8,9', 'перец сладкий,паприка', 260),
    ('Кабачок', 'Овощи', 'кг', 24, 0.6, 0.3, 4.6, '7,8,9', 'цукини', 120),
    ('Брокколи', 'Овощи', 'кг', 34, 2.8, 0.4, 6.6, None, 'капуста брокколи', 320),
    ('Шампиньоны', 'Овощи', 'кг', 27, 4.3, 1.0, 0.1, None, 'грибы,шампиньон', 290),
    ('Чеснок', 'Овощи', 'кг', 149, 6.5, 0.5, 29.9, '7,8', 'чесночок', 350),
    ('Зелень свежая', 'Овощи', 'пучок', 36, 2.6, 0.5, 5.0, '5,6,7,8,9', 'укроп,петрушка,зеленый лук,кинза', 80),
    ('Огурцы солёные', 'Овощи', 'кг', 13, 0.8, 0.1, 2.2, None, 'соленья,маринованные огурцы', 200),
    # Фрукты и ягоды
    ('Яблоки', 'Фрукты', 'кг', 52, 0.4, 0.4, 13.8, '8,9,10', 'яблоко', 130),
    ('Бананы', 'Фрукты', 'кг', 89, 1.5, 0.2, 21.0, None, 'банан', 120),
    ('Апельсины', 'Фрукты', 'кг', 47, 0.9, 0.1, 11.8, None, 'апельсин', 160),
    ('Лимоны', 'Фрукты', 'кг', 29, 1.1, 0.3, 9.3, None, 'лимон', 180),
    ('Клубника', 'Фрукты', 'кг', 41, 0.8, 0.4, 7.5, '6,7', 'земляника', 400),
    ('Виноград', 'Фрукты', 'кг', 69, 0.6, 0.2, 16.8, '8,9,10', None, 220),
    # Мясо, птица
    ('Куриная грудка', 'Мясо', 'кг', 165, 31.0, 3.6, 0.0, None, 'куриное филе,грудка курицы', 420),
    ('Куриное бедро', 'Мясо', 'кг', 209, 26.0, 11.0, 0.0, None, 'бедро курицы,окорочок', 320),
    ('Фарш свино-говяжий', 'Мясо', 'кг', 300, 17.0, 25.0, 0.0, None, 'фарш,мясной фарш', 450),
    ('Говядина', 'Мясо', 'кг', 218, 26.0, 12.0, 0.0, None, 'говядина лопатка,говяжья вырезка', 700),
    ('Свинина', 'Мясо', 'кг', 343, 21.0, 27.0, 0.0, None, 'свинина шея,свиная лопатка', 500),
    ('Индейка филе', 'Мясо', 'кг', 104, 21.0, 1.5, 0.0, None, 'индейка,филе индейки', 450),
    ('Колбаса варёная', 'Мясо', 'кг', 257, 13.0, 22.0, 1.5, None, 'докторская,колбаса', 400),
    ('Сосиски', 'Мясо', 'упак', 277, 11.0, 25.0, 1.5, None, 'сардельки', 350),
    ('Бекон', 'Мясо', 'упак', 500, 37.0, 40.0, 1.0, None, 'грудинка', 600),
    # Рыба
    ('Лосось', 'Рыба', 'кг', 208, 20.0, 13.0, 0.0, None, 'семга,форель,красная рыба', 1200),
    ('Треска', 'Рыба', 'кг', 82, 18.0, 0.6, 0.0, None, 'минтай,белая рыба', 500),
    ('Сельдь', 'Рыба', 'кг', 158, 17.0, 10.0, 0.0, None, 'селедка', 400),
    ('Креветки', 'Рыба', 'кг', 87, 20.0, 0.5, 0.0, None, 'креветка', 900),
    ('Тунец консервированный', 'Рыба', 'шт', 96, 22.0, 1.0, 0.0, None, 'тунец в собственном соку', 180),
    # Молочное и яйца
    ('Яйца куриные', 'Молочное', 'упак', 143, 12.6, 9.5, 0.7, None, 'яйцо,яйца С1', 130),
    ('Молоко 2,5%', 'Молочное', 'л', 52, 2.8, 2.5, 4.7, None, 'молоко', 90),
    ('Кефир 1%', 'Молочное', 'л', 40, 3.0, 1.0, 4.0, None, 'кефир', 85),
    ('Сметана 20%', 'Молочное', 'упак', 206, 2.8, 20.0, 3.2, None, 'сметана', 180),
    ('Творог 5%', 'Молочное', 'упак', 121, 17.0, 5.0, 1.8, None, 'творог', 220),
    ('Сыр твёрдый', 'Молочное', 'кг', 364, 25.0, 29.0, 0.0, None, 'сыр,гауда,российский сыр', 750),
    ('Масло сливочное', 'Молочное', 'упак', 748, 0.5, 82.5, 0.8, None, 'сливочное масло', 200),
    ('Йогурт натуральный', 'Молочное', 'шт', 70, 5.0, 2.5, 6.0, None, 'йогурт,греческий йогурт', 70),
    # Бакалея
    ('Масло растительное', 'Бакалея', 'л', 899, 0.0, 99.9, 0.0, None, 'подсолнечное масло,оливковое масло', 150),
    ('Мука пшеничная', 'Бакалея', 'кг', 342, 10.3, 1.1, 70.0, None, 'мука', 60),
    ('Сахар', 'Бакалея', 'кг', 399, 0.0, 0.0, 99.7, None, 'сахарный песок', 80),
    ('Соль', 'Бакалея', 'кг', 0, 0.0, 0.0, 0.0, None, 'соль поваренная', 25),
    ('Рис', 'Бакалея', 'кг', 344, 6.7, 0.7, 78.0, None, 'рис круглый,рис длиннозерный', 120),
    ('Макароны', 'Бакалея', 'упак', 350, 12.8, 1.5, 70.0, None, 'паста,спагетти,вермишель', 110),
    ('Гречка', 'Бакалея', 'кг', 343, 12.6, 3.3, 62.0, None, 'гречневая крупа', 130),
    ('Овсяные хлопья', 'Бакалея', 'упак', 342, 12.0, 6.0, 60.0, None, 'овсянка,геркулес', 100),
    ('Хлеб', 'Бакалея', 'шт', 250, 8.0, 3.0, 48.0, None, 'булка,батон', 45),
    ('Лаваш', 'Бакалея', 'шт', 275, 8.0, 1.0, 55.0, None, 'пита,тортилья', 60),
    ('Фасоль консервированная', 'Бакалея', 'шт', 92, 6.8, 0.5, 15.0, None, 'фасоль в банке', 110),
    ('Горошек зелёный консервированный', 'Бакалея', 'шт', 55, 3.6, 0.2, 9.0, None, 'зеленый горошек', 90),
    ('Кукуруза консервированная', 'Бакалея', 'шт', 88, 3.3, 1.2, 17.0, None, 'кукуруза в банке', 95),
    ('Томаты в собственном соку', 'Бакалея', 'шт', 32, 1.6, 0.2, 6.0, None, 'резаные томаты,пассата', 120),
    ('Томатная паста', 'Бакалея', 'шт', 82, 4.8, 0.5, 15.0, None, 'паста томатная', 130),
    ('Соевый соус', 'Бакалея', 'шт', 58, 8.0, 0.0, 6.0, None, 'соевый', 180),
    ('Майонез', 'Бакалея', 'упак', 600, 1.0, 65.0, 2.0, None, 'майонез провансаль', 150),
    ('Мёд', 'Бакалея', 'кг', 304, 0.3, 0.0, 82.0, None, 'мед', 500),
    ('Орехи грецкие', 'Бакалея', 'кг', 654, 15.0, 65.0, 14.0, None, 'грецкий орех,орехи', 900),
    ('Изюм', 'Бакалея', 'кг', 264, 2.9, 0.6, 66.0, None, 'сушеный виноград', 350),
    ('Шоколад тёмный', 'Бакалея', 'шт', 545, 5.0, 35.0, 48.0, None, 'шоколад', 120),
    ('Какао-порошок', 'Бакалея', 'упак', 289, 24.0, 15.0, 10.0, None, 'какао', 250),
    ('Дрожжи сухие', 'Бакалея', 'упак', 100, 12.0, 2.0, 12.0, None, 'дрожжи', 40),
    ('Разрыхлитель', 'Бакалея', 'упак', 90, 0.0, 0.0, 20.0, None, 'сода,пекарский порошок', 60),
    # Напитки и заморозка
    ('Вода минеральная', 'Напитки', 'л', 0, 0.0, 0.0, 0.0, None, 'вода питьевая', 40),
    ('Чай чёрный', 'Напитки', 'упак', 0, 0.0, 0.0, 0.0, None, 'чай', 300),
    ('Кофе молотый', 'Напитки', 'упак', 200, 12.0, 12.0, 4.0, None, 'кофе', 700),
    ('Сок апельсиновый', 'Напитки', 'л', 45, 0.7, 0.1, 10.4, None, 'сок', 120),
    ('Пельмени', 'Заморозка', 'упак', 330, 12.0, 14.0, 38.0, None, 'пельмени заморозка', 400),
    ('Мороженое', 'Заморозка', 'шт', 200, 3.5, 11.0, 24.0, None, 'мороженое пломбир', 120),
]


def hash_price(base: float, product: str, shop: str, city: str) -> float:
    """Детерминированный разброс цены ±8 % — одинаковый при каждом запуске."""
    seed = f'{product}|{shop}|{city}'.encode('utf-8')
    digest = hashlib.md5(seed).hexdigest()
    factor = 0.92 + (int(digest[:8], 16) % 1600) / 10000.0  # 0.92 .. 1.08
    price = base * factor
    # Округляем до 10 копеек — как в ценниках
    return round(price * 10) / 10


# Сколько дней назад делаем исторические снапшоты цен (кроме текущего).
HISTORY_DAYS = (30, 21, 14, 7)


def drift_price(base: float, product_id: int, shop_id: int, city_id: int, days_back: int) -> float:
    """Детерминированный дрейф цены ±12 % для исторического снапшота.

    Зависит от пары (продукт, магазин, город) и глубины снапшота, поэтому
    история цен одинакова при каждом запуске миграции и в ней есть и рост, и падение.
    """
    seed = f'{product_id}|{shop_id}|{city_id}|{days_back}'.encode('utf-8')
    digest = hashlib.md5(seed).hexdigest()
    factor = 0.88 + (int(digest[:8], 16) % 2400) / 10000.0  # 0.88 .. 1.12
    return round(base * factor * 10) / 10


CITIES_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    'data',
    'russian_cities.json',
)


def seed_cities_from_file(conn) -> int:
    """Доливает полный справочник городов России.

    Существующие города (к ним привязаны цены) не пересоздаются — только уточняются
    регион и население. Новые добавляются по slug, дубликаты пропускаются.
    """
    if not os.path.exists(CITIES_FILE):
        return 0

    with open(CITIES_FILE, encoding='utf-8') as handle:
        data = json.load(handle)

    existing = {
        row[0].lower(): row[1]
        for row in conn.execute(text('SELECT name, id FROM cities')).fetchall()
    }

    added = 0
    for item in data:
        key = (item.get('name') or '').lower()
        if not key:
            continue

        if key in existing:
            conn.execute(
                text(
                    'UPDATE cities SET region = COALESCE(:region, region), '
                    'population = COALESCE(:population, population) WHERE id = :id'
                ),
                {
                    'region': item.get('region'),
                    'population': item.get('population'),
                    'id': existing[key],
                },
            )
            continue

        row = conn.execute(
            text(
                'INSERT INTO cities (name, slug, region, population, is_active) '
                'VALUES (:name, :slug, :region, :population, true) '
                'ON CONFLICT (slug) DO NOTHING RETURNING id'
            ),
            {
                'name': item['name'],
                'slug': item['slug'],
                'region': item.get('region'),
                'population': item.get('population'),
            },
        ).scalar()
        if row:
            existing[key] = row
            added += 1

    return added


def migrate_legacy_carts(conn) -> dict:
    """Переносит старые «корзины сообщества» в наборы и удаляет дублирующие таблицы.

    До переделки было две сущности об одном и том же: `ShoppingCart` (публичная
    корзина) и `Basket` (личная смета). Теперь сущность одна — набор.
    Функция идемпотентна: после первого запуска таблиц уже нет, переносить нечего.
    """
    counts = {'baskets': 0, 'items': 0, 'comments': 0, 'likes': 0}

    exists = conn.execute(text("SELECT to_regclass('public.shopping_carts')")).scalar()
    if not exists:
        return counts

    mapping = {}
    carts = conn.execute(
        text(
            'SELECT id, user_id, title, description, total_price, created_at '
            'FROM shopping_carts'
        )
    ).fetchall()

    for cart in carts:
        new_id = conn.execute(
            text(
                'INSERT INTO baskets '
                '(user_id, title, description, total_price, is_public, status, servings, strategy, created_at) '
                "VALUES (:user_id, :title, :description, :total, true, 'published', 2, 'single', :created_at) "
                'RETURNING id'
            ),
            {
                'user_id': cart.user_id,
                'title': cart.title,
                'description': cart.description,
                'total': cart.total_price or 0,
                'created_at': cart.created_at,
            },
        ).scalar()
        mapping[cart.id] = new_id
        counts['baskets'] += 1

    items = conn.execute(text('SELECT cart_id, name, quantity, price FROM cart_items')).fetchall()
    for index, item in enumerate(items):
        basket_id = mapping.get(item.cart_id)
        if basket_id is None:
            continue

        # Старое количество — свободный текст («2 кг»): выделяем число и единицу
        raw = (item.quantity or '').strip()
        match = re.match(r'^([\d.,]+)\s*(.*)$', raw)
        quantity = None
        unit = None
        if match:
            try:
                quantity = float(match.group(1).replace(',', '.'))
            except ValueError:
                quantity = None
            unit = match.group(2).strip() or None

        conn.execute(
            text(
                'INSERT INTO basket_items (basket_id, name, quantity, unit, price, position) '
                'VALUES (:basket_id, :name, :quantity, :unit, :price, :position)'
            ),
            {
                'basket_id': basket_id,
                'name': item.name,
                'quantity': quantity,
                'unit': unit,
                'price': item.price,
                'position': index,
            },
        )
        counts['items'] += 1

    comments = conn.execute(
        text('SELECT cart_id, user_id, text, created_at FROM cart_comments')
    ).fetchall()
    for comment in comments:
        basket_id = mapping.get(comment.cart_id)
        if basket_id is None:
            continue
        conn.execute(
            text(
                'INSERT INTO basket_comments (basket_id, user_id, text, created_at) '
                'VALUES (:basket_id, :user_id, :text, :created_at)'
            ),
            {
                'basket_id': basket_id,
                'user_id': comment.user_id,
                'text': comment.text,
                'created_at': comment.created_at,
            },
        )
        counts['comments'] += 1

    likes = conn.execute(text('SELECT cart_id, user_id FROM cart_likes')).fetchall()
    for like in likes:
        basket_id = mapping.get(like.cart_id)
        if basket_id is None:
            continue
        conn.execute(
            text('INSERT INTO basket_likes (basket_id, user_id) VALUES (:basket_id, :user_id)'),
            {'basket_id': basket_id, 'user_id': like.user_id},
        )
        counts['likes'] += 1

    # Пересчитываем счётчики лайков у перенесённых наборов
    conn.execute(
        text(
            'UPDATE baskets SET likes_count = ('
            '  SELECT COUNT(*) FROM basket_likes WHERE basket_likes.basket_id = baskets.id'
            ')'
        )
    )
    conn.execute(text('UPDATE baskets SET prices_date = created_at WHERE prices_date IS NULL'))

    for table in ('cart_likes', 'cart_comments', 'cart_items', 'shopping_carts'):
        conn.execute(text(f'DROP TABLE IF EXISTS {table}'))

    return counts


def normalize_products(conn) -> int:
    """Заполняет `products.normalized_name` — название в едином виде."""
    from app.services.product_service import normalize_product_name

    updated = 0
    rows = conn.execute(text('SELECT id, name FROM products')).fetchall()
    for row in rows:
        value = normalize_product_name(row.name)
        conn.execute(
            text('UPDATE products SET normalized_name = :value WHERE id = :id'),
            {'value': value, 'id': row.id},
        )
        updated += 1
    return updated


def seed_recipe_steps(conn) -> int:
    """Раскладывает текст инструкции на шаги для рецептов, у которых шагов нет.

    Раньше шаги хранились одной строкой (`recipes.instructions`). Теперь каждый
    шаг — отдельная запись, чтобы к нему можно было приложить фото.
    """
    from app.services.recipe_service import split_instructions

    created = 0
    rows = conn.execute(
        text(
            'SELECT r.id, r.instructions FROM recipes r '
            'WHERE r.instructions IS NOT NULL AND r.instructions <> \'\' '
            'AND NOT EXISTS (SELECT 1 FROM recipe_steps s WHERE s.recipe_id = r.id)'
        )
    ).fetchall()

    for row in rows:
        for index, line in enumerate(split_instructions(row.instructions)):
            conn.execute(
                text(
                    'INSERT INTO recipe_steps (recipe_id, position, text) '
                    'VALUES (:recipe_id, :position, :text)'
                ),
                {'recipe_id': row.id, 'position': index, 'text': line},
            )
            created += 1
    return created


def main() -> int:
    engine = create_engine(DATABASE_URL)
    print(f'Подключение: {DATABASE_URL.split("@")[-1]}')

    # 1. Таблицы
    Base.metadata.create_all(engine)
    print('Таблицы: create_all выполнен')

    with engine.begin() as conn:
        # 2. Новые колонки в существующих таблицах
        for column, ddl in RECIPE_COLUMNS:
            conn.execute(text(f'ALTER TABLE recipes ADD COLUMN IF NOT EXISTS {column} {ddl}'))
        for column, ddl in USER_COLUMNS:
            conn.execute(text(f'ALTER TABLE users ADD COLUMN IF NOT EXISTS {column} {ddl}'))
        for column, ddl in PRODUCT_COLUMNS:
            conn.execute(text(f'ALTER TABLE products ADD COLUMN IF NOT EXISTS {column} {ddl}'))
        for column, ddl in MEALPLAN_COLUMNS:
            conn.execute(text(f'ALTER TABLE meal_plans ADD COLUMN IF NOT EXISTS {column} {ddl}'))
        for column, ddl in COMMENT_COLUMNS:
            conn.execute(text(f'ALTER TABLE comments ADD COLUMN IF NOT EXISTS {column} {ddl}'))
        for column, ddl in BASKET_COLUMNS:
            conn.execute(text(f'ALTER TABLE baskets ADD COLUMN IF NOT EXISTS {column} {ddl}'))
        for column, ddl in BASKET_ITEM_COLUMNS:
            conn.execute(text(f'ALTER TABLE basket_items ADD COLUMN IF NOT EXISTS {column} {ddl}'))
        for column, ddl in SHOP_COLUMNS:
            conn.execute(text(f'ALTER TABLE shops ADD COLUMN IF NOT EXISTS {column} {ddl}'))
        for column, ddl in INGREDIENT_COLUMNS:
            conn.execute(text(f'ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS {column} {ddl}'))

        # Одноразовый перенос: старые корзины сообщества становятся наборами,
        # после чего дублирующие таблицы удаляются
        moved = migrate_legacy_carts(conn)
        if any(moved.values()):
            print(
                'Перенос корзин в наборы: '
                f'{moved["baskets"]} наборов, {moved["items"]} позиций, '
                f'{moved["comments"]} комментариев, {moved["likes"]} лайков'
            )

        # Нормализованные названия продуктов — основа автодополнения и защиты от дублей
        normalized = normalize_products(conn)
        print(f'Нормализация продуктов: {normalized}')

        # Шаги приготовления из старых текстовых инструкций
        steps_added = seed_recipe_steps(conn)
        if steps_added:
            print(f'Шаги приготовления: разложено {steps_added}')
        print(
            f'Колонки: recipes +{len(RECIPE_COLUMNS)}, '
            f'users +{len(USER_COLUMNS)}, products +{len(PRODUCT_COLUMNS)}'
        )

        # 3. Индексы
        for statement in INDEXES:
            conn.execute(text(statement))

        # 4. Внешние ключи (в Postgres нет ADD CONSTRAINT IF NOT EXISTS — проверяем каталог)
        for table, name, column, ref_table, ref_column, on_delete in FOREIGN_KEYS:
            exists = conn.execute(
                text('SELECT 1 FROM pg_constraint WHERE conname = :name'),
                {'name': name},
            ).scalar()
            if not exists:
                conn.execute(
                    text(
                        f'ALTER TABLE {table} ADD CONSTRAINT {name} '
                        f'FOREIGN KEY ({column}) REFERENCES {ref_table}({ref_column}) '
                        f'ON DELETE {on_delete}'
                    )
                )
        print('Индексы и внешние ключи готовы')

        # 5. Города
        # В России есть одноимённые города (Киров, Благовещенск), их различает регион,
        # поэтому уникальность названия снимаем — иначе полный список не залить
        conn.execute(text('ALTER TABLE cities DROP CONSTRAINT IF EXISTS cities_name_key'))
        conn.execute(text('ALTER TABLE cities DROP CONSTRAINT IF EXISTS cities_name_key1'))

        city_ids: dict[str, int] = {}
        city_factors: dict[str, float] = {}
        for name, slug, region, population, price_factor in CITIES:
            row = conn.execute(
                text('SELECT id FROM cities WHERE slug = :slug'), {'slug': slug}
            ).scalar()
            if row is None:
                row = conn.execute(
                    text(
                        'INSERT INTO cities (name, slug, region, population, is_active) '
                        'VALUES (:name, :slug, :region, :population, true) RETURNING id'
                    ),
                    {'name': name, 'slug': slug, 'region': region, 'population': population},
                ).scalar()
            city_ids[slug] = row
            city_factors[slug] = price_factor
        print(f'Города с ценами: {len(city_ids)}')

        # 5.1 Полный справочник городов России (открытый датасет hflabs/city)
        added_cities = seed_cities_from_file(conn)
        print(f'Справочник городов: добавлено {added_cities}')

        # 6. Магазины + присутствие в городах
        shop_info: dict[str, dict] = {}
        for (
            name,
            slug,
            emoji,
            color,
            is_online,
            affiliate,
            factor,
            is_partner,
            profile,
        ) in SHOPS:
            row = conn.execute(
                text('SELECT id FROM shops WHERE slug = :slug'), {'slug': slug}
            ).scalar()
            if row is None:
                row = conn.execute(
                    text(
                        'INSERT INTO shops (name, slug, emoji, brand_color, is_online, '
                        'affiliate_template, is_partner) '
                        'VALUES (:name, :slug, :emoji, :color, :is_online, :affiliate, :is_partner) '
                        'RETURNING id'
                    ),
                    {
                        'name': name,
                        'slug': slug,
                        'emoji': emoji,
                        'color': color,
                        'is_online': is_online,
                        'affiliate': affiliate,
                        'is_partner': is_partner,
                    },
                ).scalar()
            shop_info[slug] = {
                'id': row,
                'factor': factor,
                'name': name,
                'profile': profile,
            }

            for city_slug, city_id in city_ids.items():
                conn.execute(
                    text(
                        'INSERT INTO shop_cities (shop_id, city_id, is_active) '
                        'VALUES (:shop_id, :city_id, true) '
                        'ON CONFLICT (shop_id, city_id) DO NOTHING'
                    ),
                    {'shop_id': row, 'city_id': city_id},
                )
        print(f'Магазины: {len(shop_info)}, присутствие в городах заполнено')

        # 7. Продукты
        existing_products = {
            row[0] for row in conn.execute(text('SELECT name FROM products')).fetchall()
        }
        product_prices: dict[str, float] = {}
        created = 0
        for (
            name,
            category,
            unit,
            kcal,
            protein,
            fat,
            carbs,
            season,
            aliases,
            base_price,
        ) in PRODUCTS:
            product_prices[name] = base_price
            if name in existing_products:
                continue
            conn.execute(
                text(
                    'INSERT INTO products (name, category, unit, kcal_per_100, protein_per_100, '
                    'fat_per_100, carbs_per_100, season_months, aliases, is_verified) '
                    'VALUES (:name, :category, :unit, :kcal, :protein, :fat, :carbs, '
                    ':season, :aliases, true)'
                ),
                {
                    'name': name,
                    'category': category,
                    'unit': unit,
                    'kcal': kcal,
                    'protein': protein,
                    'fat': fat,
                    'carbs': carbs,
                    'season': season,
                    'aliases': aliases,
                },
            )
            created += 1
        print(f'Продукты: добавлено {created}, всего в справочнике {len(PRODUCTS)}')

        # 7.1 Фасовка продуктов: сначала по категориям, затем точечные уточнения
        for category, (pack_size, pack_units) in PACK_BY_CATEGORY.items():
            conn.execute(
                text(
                    'UPDATE products SET pack_size = :pack_size, pack_units = :pack_units '
                    'WHERE pack_size IS NULL AND category = :category'
                ),
                {'pack_size': pack_size, 'pack_units': pack_units, 'category': category},
            )
        for product_name, (pack_size, pack_units) in PACK_OVERRIDES.items():
            conn.execute(
                text(
                    'UPDATE products SET pack_size = :pack_size, pack_units = :pack_units '
                    'WHERE name = :name'
                ),
                {'pack_size': pack_size, 'pack_units': pack_units, 'name': product_name},
            )
        conn.execute(
            text(
                'UPDATE products SET pack_size = COALESCE(pack_size, 300), '
                'pack_units = COALESCE(pack_units, 1)'
            )
        )

        # 8. Стартовые цены.
        # Свои сид-цены всегда пересобираем заново (профили магазинов могли измениться),
        # цены пользователей (source='user') не трогаем.
        deleted = conn.execute(text("DELETE FROM price_quotes WHERE source = 'seed'")).rowcount
        if deleted:
            print(f'Цены: удалено {deleted} устаревших сид-записей')

        rows = []
        product_rows = conn.execute(text('SELECT id, name, category FROM products')).fetchall()
        for product_id, product_name, category in product_rows:
            base = product_prices.get(product_name)
            if base is None:
                continue
            for city_slug, city_id in city_ids.items():
                city_factor = city_factors.get(city_slug, 1.0)
                for shop_slug, shop in shop_info.items():
                    # Профиль магазина по категории важнее базового коэффициента:
                    # именно из-за него выгодно разложить корзину по разным магазинам
                    factor = (shop.get('profile') or {}).get(category, shop['factor'])
                    price = hash_price(
                        base * factor * city_factor, product_name, shop_slug, city_slug
                    )
                    rows.append(
                        {
                            'product_id': product_id,
                            'shop_id': shop['id'],
                            'city_id': city_id,
                            'price': price,
                            'source': 'seed',
                            'status': 'confirmed',
                        }
                    )
        insert_sql = text(
            'INSERT INTO price_quotes (product_id, shop_id, city_id, price, unit_amount, '
            "source, status, checked_at) VALUES (:product_id, :shop_id, :city_id, "
            ":price, 1, :source, :status, :checked_at)"
        )
        # Единая точка отсчёта для всех снапшотов: текущий и «N дней назад»
        now = datetime.now(timezone.utc)
        if rows:
            conn.execute(insert_sql, [{**row, 'checked_at': now} for row in rows])
        print(f'Цены: добавлено {len(rows)} записей (текущий снапшот)')

        # 8.1 Исторические снапшоты: без них нечего показывать в «что подешевело».
        # Цена снапшота — текущая цена с детерминированным дрейфом ±12 %,
        # магазины и статусы те же, отличается только checked_at.
        history_total = 0
        for days_back in HISTORY_DAYS:
            snapshot = [
                {
                    **row,
                    'price': drift_price(
                        row['price'],
                        row['product_id'],
                        row['shop_id'],
                        row['city_id'],
                        days_back,
                    ),
                    'checked_at': now - timedelta(days=days_back),
                }
                for row in rows
            ]
            if snapshot:
                conn.execute(insert_sql, snapshot)
            history_total += len(snapshot)
        print(
            f'Цены: добавлено {history_total} записей '
            f'({len(HISTORY_DAYS)} исторических снапшота)'
        )

        # 9. Существующие рецепты получают статус published и город по умолчанию
        conn.execute(text("UPDATE recipes SET status = 'published' WHERE status IS NULL"))
        conn.execute(
            text(
                'UPDATE recipes SET servings = 2 WHERE servings IS NULL'
            )
        )

        # 10. Стартовые челленджи бюджета
        challenges = [
            ('Ужин за 300 ₽', 'uzhin-za-300', 'Приготовьте ужин на двоих и уложитесь в 300 рублей.', '💸', 300.0, 2),
            ('Обед за 500 ₽', 'obed-za-500', 'Сытный обед на двоих в пределах 500 рублей.', '🍲', 500.0, 2),
            ('Семейный ужин за 700 ₽', 'semeyniy-uzhin-700', 'Ужин на четверых за 700 рублей.', '👨‍👩‍👧', 700.0, 4),
            ('Неделя ужинов за 3000 ₽', 'nedelya-uzhinov-3000', 'Семь ужинов, которые вместе стоят не больше 3000 рублей.', '🗓', 3000.0, 2),
        ]
        for title, slug, description, emoji, budget, servings in challenges:
            exists = conn.execute(
                text('SELECT id FROM challenges WHERE slug = :slug'), {'slug': slug}
            ).scalar()
            if exists is None:
                conn.execute(
                    text(
                        'INSERT INTO challenges (title, slug, description, emoji, budget, servings, is_active) '
                        'VALUES (:title, :slug, :description, :emoji, :budget, :servings, true)'
                    ),
                    {
                        'title': title,
                        'slug': slug,
                        'description': description,
                        'emoji': emoji,
                        'budget': budget,
                        'servings': servings,
                    },
                )
        print(f'Челленджи: {len(challenges)}')

    print('Готово.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
