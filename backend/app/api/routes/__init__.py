from app.api.routes.auth import router as auth_router
from app.api.routes.recipes import router as recipes_router
from app.api.routes.favorites import router as favorites_router
from app.api.routes.comments import router as comments_router
from app.api.routes.profile import router as profile_router
from app.api.routes.reviews import router as reviews_router

# «Смета»: география, бюджетный подбор, личные сметы и партнёрские переходы
from app.api.routes.geo import geo_router
from app.api.routes.catalog import catalog_router
from app.api.routes.baskets import baskets_router
from app.api.routes.go import go_router
from app.api.routes.mealplans import mealplans_router
from app.api.routes.pantry import pantry_router
from app.api.routes.reactions import reactions_router
from app.api.routes.challenges import challenges_router, achievements_router
from app.api.routes.admin import admin_router
from app.api.routes.notifications import notifications_router
from app.api.routes.reports import reports_router
from app.api.routes.prices import prices_router
from app.api.routes.dashboard import dashboard_router
from app.api.routes.promos import promos_router