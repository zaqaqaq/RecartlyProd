import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getRecipes } from '../services/api';
import RecipeCard from '../components/RecipeCard';

/* ============================================================
   Раздел «Рецепты» — блюда без набора.
   Рецепты, у которых есть basket_id, живут в бюджетном подборе,
   поэтому здесь они не показываются. Если бэкенд вообще не отдаёт
   basket_id, показываем все опубликованные рецепты — это допустимо.
   ============================================================ */

const PAGE_LIMIT = 60;

/* Скелетонов ровно столько, сколько помещается в ряд на десктопе */
const SKELETON_KEYS = [0, 1, 2, 3, 4, 5];

/**
 * Скелетон карточки-рецепта. RecipeCard рисуется без медиа-блока, поэтому и
 * скелетон без него: те же отступы (p-4 sm:p-5) и те же высоты блоков —
 * служебная строка, заголовок, подпись и футер. Лента не «прыгает».
 */
function RecipeSkeleton() {
    return (
        <article className="card overflow-hidden flex flex-col" aria-hidden="true">
            <div className="p-4 sm:p-5 flex flex-col flex-1">
                <div className="min-h-[40px] flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <div className="skeleton w-10 h-10 rounded-full flex-shrink-0" />
                        <div className="skeleton min-h-[20px] w-24" />
                    </div>
                    <div className="skeleton min-h-[20px] w-16 flex-shrink-0" />
                </div>
                <div className="skeleton min-h-[2.6em] w-full mt-3" />
                <div className="skeleton min-h-[2.4em] w-4/5 mt-1" />
                <div className="mt-auto pt-3 min-h-[44px] flex items-center justify-between gap-2 border-t border-ink-100 dark:border-ink-800">
                    <div className="skeleton min-h-[20px] w-20" />
                    <div className="skeleton min-h-[44px] w-28" />
                </div>
            </div>
        </article>
    );
}

function RecipesPage() {
    const [recipes, setRecipes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [query, setQuery] = useState('');
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError('');

        getRecipes(0, PAGE_LIMIT)
            .then((list) => {
                if (cancelled) return;
                setRecipes(Array.isArray(list) ? list : []);
            })
            .catch((err) => {
                if (cancelled) return;
                setRecipes([]);
                setError(err.message || 'Не удалось загрузить рецепты');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [reloadKey]);

    const visible = useMemo(() => {
        // Только опубликованные (если поле статуса вообще есть в ответе)
        const published = recipes.filter((recipe) => !recipe.status || recipe.status === 'published');

        // Если у рецептов есть basket_id — прячем те, что уже в бюджетном подборе
        const hasBasketField = published.some((recipe) => recipe.basket_id !== undefined);
        const withoutBasket = hasBasketField
            ? published.filter((recipe) => !recipe.basket_id)
            : published;

        const needle = query.trim().toLowerCase();
        if (!needle) return withoutBasket;
        return withoutBasket.filter((recipe) =>
            String(recipe.title || '').toLowerCase().includes(needle)
        );
    }, [recipes, query]);

    return (
        <div className="max-w-5xl mx-auto animate-fade-in pb-bottom-nav">
            <header className="mb-4">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 mb-2 rounded-full bg-primary-100 dark:bg-primary-900/25 text-primary-700 dark:text-primary-300 text-[11px] font-bold uppercase tracking-wide">
                    📖 рецепты
                </span>
                <h1 className="heading-1">Рецепты</h1>
                <p className="text-sm text-ink-500 dark:text-ink-400 mt-1.5 max-w-2xl">
                    Блюда без набора — просто рецепты. Добавьте набор продуктов, и блюдо попадёт
                    в бюджетный подбор.
                </p>
            </header>

            <div className="card p-3.5 sm:p-4">
                <label className="label" htmlFor="recipes-search">
                    Поиск по названию
                </label>
                <div className="relative">
                    <input
                        id="recipes-search"
                        type="search"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Например, суп"
                        autoComplete="off"
                        className="input pl-10"
                    />
                    <span
                        className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400 dark:text-ink-500 pointer-events-none"
                        aria-hidden="true"
                    >
                        🔍
                    </span>
                </div>
                {/* Строка с числом всегда на месте: её высота зарезервирована,
                    поэтому карточка поиска не меняет размер после загрузки */}
                <p className="text-[11px] text-ink-400 dark:text-ink-500 mt-2 min-h-[20px]">
                    {loading || error
                        ? ''
                        : query.trim()
                          ? `По запросу «${query.trim()}» найдено ${visible.length}`
                          : `Доступно рецептов: ${visible.length}`}
                </p>
            </div>

            {error && (
                <div className="card p-6 mt-3 text-center border-hot-500/40">
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

            {/* Выдача: min-h держит высоту страницы при загрузке и поиске */}
            <div className="mt-3 min-h-[60vh]">
                {!error && loading && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-stretch">
                        {SKELETON_KEYS.map((key) => (
                            <RecipeSkeleton key={key} />
                        ))}
                    </div>
                )}

                {!error && !loading && visible.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-stretch">
                        {visible.map((recipe) => (
                            <RecipeCard key={recipe.id} recipe={recipe} />
                        ))}
                    </div>
                )}

                {!error && !loading && visible.length === 0 && (
                    <div className="card p-6 text-center">
                        <div className="w-14 h-14 mx-auto rounded-3xl bg-primary-100 dark:bg-primary-900/25 flex items-center justify-center text-2xl mb-3">
                            📖
                        </div>
                        <p className="text-sm font-semibold text-ink-700 dark:text-ink-200">
                            {query.trim()
                                ? 'По названию ничего не нашлось'
                                : 'Рецептов без набора пока нет'}
                        </p>
                        <p className="text-[11px] text-ink-400 dark:text-ink-500 mt-1 mb-4">
                            {query.trim()
                                ? 'Попробуйте другое слово или очистите поиск.'
                                : 'Все рецепты уже собраны в наборы — смотрите бюджетный подбор.'}
                        </p>
                        {query.trim() ? (
                            <button
                                type="button"
                                onClick={() => setQuery('')}
                                className="btn-secondary btn-block sm:w-auto sm:inline-flex"
                            >
                                Очистить поиск
                            </button>
                        ) : (
                            <Link to="/" className="btn-primary btn-block sm:w-auto sm:inline-flex">
                                К подбору по бюджету
                            </Link>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

export default RecipesPage;
