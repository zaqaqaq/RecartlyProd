from sqlalchemy.orm import Session
from app.models.recipe import Recipe, RecipeStep
from app.models.ingredient import Ingredient
from app.models.comment import Comment
from app.models.favorite import Favorite
from app.schemas.recipe import RecipeCreate


def split_instructions(text: str) -> list:
    """Раскладывает инструкцию из одного текста на шаги.

    Нужно для совместимости: старые рецепты и клиенты передают `instructions`
    одной строкой («1. Сделать то\\n2. Сделать это»). Каждая непустая строка
    становится отдельным шагом, нумерация в начале строки убирается.
    """
    import re

    if not text:
        return []

    steps = []
    for raw_line in text.split('\n'):
        line = raw_line.strip()
        if not line:
            continue
        # Убираем ведущий номер: «1. », «2) », «Шаг 3: »
        line = re.sub(r'^(?:шаг\s*)?\d+\s*[.):\-]?\s*', '', line, flags=re.IGNORECASE).strip()
        if line:
            steps.append(line)
    return steps


class RecipeService:

    @staticmethod
    def create_recipe(db: Session, recipe_data: RecipeCreate, user_id: int) -> Recipe:
        """Создание рецепта с ингредиентами и шагами приготовления."""
        # Создаём рецепт
        new_recipe = Recipe(
            title=recipe_data.title,
            description=recipe_data.description,
            instructions=recipe_data.instructions,
            user_id=user_id
        )
        db.add(new_recipe)
        db.flush()  # Получаем ID рецепта без коммита

        # Ингредиенты: у каждого может быть фото продукта
        for index, ing_data in enumerate(recipe_data.ingredients):
            ingredient = Ingredient(
                name=ing_data.name,
                quantity=ing_data.quantity,
                price=ing_data.price,
                photo_url=ing_data.photo_url,
                position=index,
                recipe_id=new_recipe.id
            )
            db.add(ingredient)

        # Шаги: если клиент прислал список — берём его, иначе раскладываем текст
        steps = recipe_data.steps
        if steps:
            for index, step_data in enumerate(steps):
                db.add(
                    RecipeStep(
                        recipe_id=new_recipe.id,
                        position=index,
                        text=step_data.text.strip(),
                        photo_url=step_data.photo_url,
                    )
                )
        else:
            for index, line in enumerate(split_instructions(recipe_data.instructions)):
                db.add(
                    RecipeStep(recipe_id=new_recipe.id, position=index, text=line)
                )

        db.commit()
        db.refresh(new_recipe)
        return new_recipe

    @staticmethod
    def get_recipe(db: Session, recipe_id: int) -> Recipe:
        """Получение рецепта по ID"""
        return db.query(Recipe).filter(Recipe.id == recipe_id).first()

    @staticmethod
    def get_recipes(db: Session, skip: int = 0, limit: int = 20, status: str = 'published') -> list[Recipe]:
        """Публичная лента рецептов.

        По умолчанию отдаём только опубликованное: контент на модерации
        (`pending`), отклонённый или черновик не должен попадать в общую ленту,
        иначе смысл модерации теряется. Передайте `status=None`, чтобы получить всё.
        """
        query = db.query(Recipe)
        if status:
            query = query.filter(Recipe.status == status)
        return query.order_by(Recipe.created_at.desc()).offset(skip).limit(limit).all()

    @staticmethod
    def get_recipes_by_user(db: Session, user_id: int, skip: int = 0, limit: int = 20) -> list[Recipe]:
        """Получение рецептов пользователя"""
        return db.query(Recipe).filter(Recipe.user_id == user_id).order_by(Recipe.created_at.desc()).offset(skip).limit(
            limit).all()

    @staticmethod
    def calculate_total_price(recipe: Recipe) -> float:
        """Подсчёт общей стоимости блюда"""
        total = 0
        for ingredient in recipe.ingredients:
            if ingredient.price:
                total += ingredient.price
        return round(total, 2)

    @staticmethod
    def delete_recipe(db: Session, recipe_id: int, user_id: int) -> bool:
        """Удаление рецепта (только владелец)"""
        recipe = db.query(Recipe).filter(Recipe.id == recipe_id, Recipe.user_id == user_id).first()
        if recipe:
            db.delete(recipe)
            db.commit()
            return True
        return False