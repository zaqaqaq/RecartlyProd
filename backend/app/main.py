from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
from app.api.routes import auth_router, recipes_router, favorites_router, comments_router, profile_router, reviews_router
from app.api.routes import geo_router, catalog_router, baskets_router, go_router
from app.api.routes import mealplans_router, pantry_router
from app.api.routes import reactions_router
from app.api.routes import challenges_router, achievements_router
from app.api.routes import admin_router
from app.api.routes import notifications_router
from app.api.routes import reports_router
from app.api.routes import prices_router
from app.api.routes import dashboard_router
from app.api.routes import promos_router

app = FastAPI(title="Recartly API", version="1.0.0")

# CORS
app.add_middleware(
    CORSMiddleware,
    # localhost:3000 — обычная разработка.
    # Остальные адреса — чтобы проверять мобильную версию/PWA с телефона
    # по локальному IP машины (http://192.168.x.x:3000 и т.п.).
    allow_origin_regex=(
        r"https?://(localhost|127\.0\.0\.1|"
        r"10\.\d{1,3}\.\d{1,3}\.\d{1,3}|"
        r"192\.168\.\d{1,3}\.\d{1,3}|"
        r"172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})"
        r"(:\d+)?"
    ),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Подключаем роутеры
app.include_router(auth_router)
app.include_router(recipes_router)
app.include_router(favorites_router)
app.include_router(comments_router)
app.include_router(profile_router)
app.include_router(reviews_router)

# «Смета»: бюджетный подбор, география, личные сметы и партнёрские переходы
app.include_router(geo_router)
app.include_router(catalog_router)
app.include_router(baskets_router)
app.include_router(go_router)
app.include_router(mealplans_router)
app.include_router(pantry_router)
app.include_router(reactions_router)
app.include_router(challenges_router)
app.include_router(achievements_router)
app.include_router(admin_router)
app.include_router(notifications_router)
app.include_router(reports_router)
app.include_router(prices_router)
app.include_router(dashboard_router)
app.include_router(promos_router)

# Раздаём статические файлы (фото)
uploads_dir = "uploads"
if not os.path.exists(uploads_dir):
    os.makedirs(uploads_dir)
app.mount("/uploads", StaticFiles(directory=uploads_dir), name="uploads")

@app.get("/")
def root():
    return {"message": "Welcome to Recartly API"}

@app.get("/health")
def health():
    return {"status": "ok"}

