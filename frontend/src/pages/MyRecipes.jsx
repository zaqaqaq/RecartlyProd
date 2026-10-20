import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getMyRecipes, deleteRecipe } from '../services/api';
import { mediaUrl } from '../utils/media';

/* Скелетон строки рецепта: миниатюра, заголовок, дата, описание и футер.
   Повторяет разметку карточки один в один — при загрузке список не дёргается. */
function MyRecipeRowSkeleton() {
    return (
        <article className="card overflow-hidden" aria-hidden="true">
            <div className="flex gap-3 p-3 sm:p-4">
                <div className="skeleton w-20 h-20 xs:w-24 xs:h-24 rounded-2xl flex-shrink-0" />
                <div className="flex-1 min-w-0">
                    <div className="skeleton min-h-[2.6em] w-full" />
                    <div className="skeleton min-h-[20px] w-1/3 mt-1" />
                    <div className="skeleton min-h-[2.4em] w-4/5 mt-1.5" />
                    <div className="mt-2 flex items-center justify-between gap-2">
                        <div className="skeleton min-h-[20px] w-24" />
                        <div className="skeleton min-h-[28px] w-20" />
                    </div>
                </div>
            </div>
            <div className="flex px-3 sm:px-4 py-1.5 border-t border-ink-100 dark:border-ink-800">
                <div className="skeleton min-h-[44px] w-full sm:w-28 sm:ml-auto" />
            </div>
        </article>
    );
}

function MyRecipes() {
    const [recipes, setRecipes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        loadRecipes();
    }, [reloadKey]);

    const loadRecipes = async () => {
        setLoading(true);
        setError('');
        try {
            const data = await getMyRecipes();
            setRecipes(data || []);
        } catch (err) {
            setError('Ошибка загрузки рецептов');
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (recipeId) => {
        if (window.confirm('Вы уверены, что хотите удалить этот рецепт?')) {
            try {
                await deleteRecipe(recipeId);
                setRecipes(recipes.filter(r => r.id !== recipeId));
            } catch (err) {
                alert('Ошибка удаления');
            }
        }
    };

    return (
        <div className="max-w-4xl mx-auto pb-bottom-nav animate-fade-in">
            {/* Шапка рендерится всегда: при загрузке она не «появляется» скачком */}
            <header className="mb-4">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 mb-2 rounded-full bg-primary-100 dark:bg-primary-900/25 text-primary-700 dark:text-primary-300 text-[11px] font-bold uppercase tracking-wide">
                    📝 мои рецепты
                </span>
                <h1 className="heading-1">Мои рецепты</h1>
                <p className="text-ink-500 dark:text-ink-400 mt-1.5 text-sm sm:text-base tabular-nums">
                    Всего рецептов: {recipes.length}
                </p>
            </header>

            {/* Ошибка: единая плашка с иконкой, пояснением и «Повторить» */}
            {error && (
                <div className="card p-6 mb-4 text-center border-hot-500/40">
                    <div className="w-14 h-14 mx-auto rounded-3xl bg-hot-50 dark:bg-hot-500/15 flex items-center justify-center text-2xl mb-3">
                        ⚠️
                    </div>
                    <p className="text-sm font-semibold text-ink-700 dark:text-ink-200">
                        Не удалось загрузить рецепты
                    </p>
                    <p className="text-xs text-hot-600 dark:text-hot-400 mt-1 mb-4 break-words">{error}</p>
                    <button
                        type="button"
                        onClick={() => setReloadKey((value) => value + 1)}
                        className="btn-secondary btn-block sm:w-auto"
                    >
                        Повторить
                    </button>
                </div>
            )}

            {/* Список: min-h держит высоту страницы при загрузке и удалении */}
            <div className="min-h-[60vh] space-y-3 sm:space-y-4">
                {loading ? (
                    <>
                        <MyRecipeRowSkeleton />
                        <MyRecipeRowSkeleton />
                        <MyRecipeRowSkeleton />
                    </>
                ) : recipes.length === 0 ? (
                    <div className="card p-6 text-center">
                        <div className="w-14 h-14 mx-auto rounded-3xl bg-primary-100 dark:bg-primary-900/25 flex items-center justify-center text-2xl mb-3">
                            📝
                        </div>
                        <p className="text-sm font-semibold text-ink-700 dark:text-ink-200">
                            У вас пока нет рецептов
                        </p>
                        <p className="text-[11px] text-ink-400 dark:text-ink-500 mt-1 mb-4">
                            Опубликуйте первый рецепт — он появится здесь и в ленте.
                        </p>
                        <Link to="/create" className="btn-primary btn-block sm:w-auto sm:inline-flex">
                            Создать первый рецепт
                        </Link>
                    </div>
                ) : (
                    recipes.map((recipe, index) => (
                        <article
                            key={recipe.id}
                            className="card card-hover overflow-hidden animate-fade-in-up"
                            style={{ animationDelay: `${Math.min(index, 6) * 45}ms` }}
                        >
                            <div className="flex gap-3 p-3 sm:p-4">
                                {recipe.photo_url && (
                                    <div className="w-20 h-20 xs:w-24 xs:h-24 rounded-2xl overflow-hidden bg-ink-100 dark:bg-ink-800 flex-shrink-0">
                                        <img
                                            src={mediaUrl(recipe.photo_url)}
                                            alt={recipe.title}
                                            loading="lazy"
                                            className="w-full h-full object-cover"
                                        />
                                    </div>
                                )}
                                <div className="flex-1 min-w-0">
                                    {/* Статус публикации: автор должен видеть, что рецепт
                                        ушёл на проверку и потому его нет в общей ленте */}
                                    {recipe.status && recipe.status !== 'published' && (
                                        <span
                                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold mb-1 ${
                                                recipe.status === 'rejected'
                                                    ? 'bg-hot-50 text-hot-700 dark:bg-hot-600/15 dark:text-hot-400'
                                                    : 'bg-secondary-50 text-secondary-700 dark:bg-secondary-500/15 dark:text-secondary-300'
                                            }`}
                                        >
                                            {recipe.status === 'pending' && '⏳ на проверке'}
                                            {recipe.status === 'rejected' && '🚫 отклонён'}
                                            {recipe.status === 'needs_changes' && '✏️ нужна доработка'}
                                            {recipe.status === 'draft' && '📝 черновик'}
                                        </span>
                                    )}
                                    <Link to={`/recipe/${recipe.id}`} className="block min-w-0">
                                        <h2 className="font-bold text-[15px] sm:text-lg leading-snug text-ink-900 dark:text-white hover:text-primary-600 dark:hover:text-primary-400 transition-colors line-clamp-2 break-words">
                                            {recipe.title}
                                        </h2>
                                    </Link>
                                    <p className="text-ink-400 dark:text-ink-500 text-xs mt-1">
                                        {new Date(recipe.created_at).toLocaleDateString('ru-RU')}
                                    </p>
                                    <p className="text-ink-500 dark:text-ink-400 text-sm mt-1.5 line-clamp-2">
                                        {recipe.description || 'Без описания'}
                                    </p>
                                    <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
                                        <div className="flex items-center gap-3 text-sm text-ink-500 dark:text-ink-400">
                                            <span className="inline-flex items-center gap-1 tabular-nums">❤️ {recipe.likes_count || 0}</span>
                                            <span className="inline-flex items-center gap-1 tabular-nums">💬 {recipe.comments_count || 0}</span>
                                        </div>
                                        <span className="price text-base sm:text-lg whitespace-nowrap">{recipe.total_price} ₽</span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex px-3 sm:px-4 py-1.5 border-t border-ink-100 dark:border-ink-800">
                                <button
                                    type="button"
                                    onClick={() => handleDelete(recipe.id)}
                                    className="inline-flex items-center justify-center gap-1.5 w-full sm:w-auto sm:ml-auto min-h-[44px] px-3 rounded-xl text-sm font-semibold text-hot-600 dark:text-hot-400 hover:bg-hot-50 dark:hover:bg-hot-600/10 active:scale-[0.98] transition-all"
                                >
                                    🗑️ Удалить
                                </button>
                            </div>
                        </article>
                    ))
                )}
            </div>
        </div>
    );
}

export default MyRecipes;
