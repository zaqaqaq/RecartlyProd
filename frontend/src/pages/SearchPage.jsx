import React, { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { searchRecipes, addFavorite, removeFavorite, getFavorites } from '../services/api';
import { mediaUrl } from '../utils/media';
import RiBadge from '../components/RiBadge';

/* Скелетонов ровно столько, сколько помещается в ряд на десктопе */
const SKELETON_KEYS = [0, 1, 2, 3, 4, 5];

/* Скелетон результата поиска повторяет разметку карточки: миниатюра,
   заголовок, служебная строка, подпись, цена и футер с кнопками. */
function SearchResultSkeleton() {
    return (
        <article className="card overflow-hidden h-full flex flex-col" aria-hidden="true">
            <div className="flex gap-3 p-3 min-w-0 flex-1">
                <div className="skeleton w-24 h-24 sm:w-28 sm:h-28 rounded-2xl flex-shrink-0" />
                <div className="flex-1 min-w-0 flex flex-col">
                    <div className="skeleton min-h-[2.6em] w-full" />
                    <div className="skeleton min-h-[20px] w-1/2 mt-1" />
                    <div className="skeleton min-h-[2.4em] w-4/5 mt-1" />
                    <div className="skeleton min-h-[28px] w-1/2 mt-auto pt-2" />
                </div>
            </div>
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-ink-100 dark:border-ink-800">
                <div className="skeleton min-h-[44px] w-20" />
                <div className="skeleton min-h-[44px] w-24" />
            </div>
        </article>
    );
}

function SearchPage() {
    const [searchParams] = useSearchParams();
    const query = searchParams.get('q') || '';
    const [recipes, setRecipes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [minPrice, setMinPrice] = useState('');
    const [maxPrice, setMaxPrice] = useState('');
    const [favorites, setFavorites] = useState(new Set());

    useEffect(() => {
        if (query) {
            loadSearchResults();
        }
    }, [query, minPrice, maxPrice]);

    const loadSearchResults = async () => {
        setLoading(true);
        setError('');
        try {
            const data = await searchRecipes(
                query,
                minPrice ? parseFloat(minPrice) : null,
                maxPrice ? parseFloat(maxPrice) : null
            );
            setRecipes(data || []);

            // Загружаем избранное текущего пользователя
            try {
                const favoritesData = await getFavorites();
                const favSet = new Set(favoritesData.map(fav => fav.id));
                setFavorites(favSet);
            } catch (err) {
                console.error('Error loading favorites:', err);
            }
        } catch (err) {
            console.error('Ошибка поиска:', err);
            setRecipes([]);
            setError(err.message || 'Не удалось выполнить поиск');
        } finally {
            setLoading(false);
        }
    };

    const handleFavoriteUpdate = async (recipeId, isFavorited) => {
        setRecipes(prev => prev.map(recipe =>
            recipe.id === recipeId
                ? { ...recipe, favorites_count: (recipe.favorites_count || 0) + (isFavorited ? 1 : -1) }
                : recipe
        ));

        if (isFavorited) {
            setFavorites(prev => new Set([...prev, recipeId]));
        } else {
            setFavorites(prev => {
                const newSet = new Set(prev);
                newSet.delete(recipeId);
                return newSet;
            });
        }
    };

    /* Двусторонняя граница цены — только подсказка, запрос не меняется */
    const invalidRange = !!(minPrice && maxPrice) && parseFloat(minPrice) > parseFloat(maxPrice);

    return (
        <div className="max-w-4xl mx-auto animate-fade-in pb-bottom-nav">
            {/* Заголовок */}
            <header className="mb-4">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 mb-2 rounded-full bg-primary-100 dark:bg-primary-900/25 text-primary-700 dark:text-primary-300 text-[11px] font-bold uppercase tracking-wide">
                    🔍 Поиск
                </span>
                <h1 className="heading-1 line-clamp-2 break-words">
                    Результаты поиска: "{query}"
                </h1>
                <p className="text-sm text-ink-500 dark:text-ink-400 mt-1.5 min-h-[20px]">
                    {loading ? 'Ищем подходящие рецепты…' : `Найдено: ${recipes.length}`}
                </p>
            </header>

            {/* Фильтр по цене */}
            <section className="card p-3.5 sm:p-5 mb-4">
                <div className="grid grid-cols-1 xs:grid-cols-2 gap-3 sm:gap-4">
                    <div className="min-w-0">
                        <label
                            htmlFor="search-min-price"
                            className="label"
                        >
                            Цена от
                        </label>
                        <input
                            id="search-min-price"
                            type="number"
                            inputMode="numeric"
                            value={minPrice}
                            onChange={(e) => setMinPrice(e.target.value)}
                            placeholder="0"
                            className={`input ${invalidRange ? 'input-error' : ''}`}
                        />
                    </div>
                    <div className="min-w-0">
                        <label
                            htmlFor="search-max-price"
                            className="label"
                        >
                            Цена до
                        </label>
                        <input
                            id="search-max-price"
                            type="number"
                            inputMode="numeric"
                            value={maxPrice}
                            onChange={(e) => setMaxPrice(e.target.value)}
                            placeholder="1000"
                            className={`input ${invalidRange ? 'input-error' : ''}`}
                        />
                    </div>
                </div>

                {invalidRange && (
                    <p className="mt-2 text-xs font-semibold text-hot-600 dark:text-hot-400">
                        «Цена от» больше, чем «Цена до»
                    </p>
                )}

                <button
                    type="button"
                    onClick={loadSearchResults}
                    className="btn-primary btn-block sm:w-auto sm:inline-flex mt-3.5"
                >
                    ⚙️ Применить
                </button>
            </section>

            {/* Ошибка: единая плашка с иконкой, пояснением и «Повторить» */}
            {error && (
                <div className="card p-6 mb-4 text-center border-hot-500/40">
                    <div className="w-14 h-14 mx-auto rounded-3xl bg-hot-50 dark:bg-hot-500/15 flex items-center justify-center text-2xl mb-3">
                        ⚠️
                    </div>
                    <p className="text-sm font-semibold text-ink-700 dark:text-ink-200">
                        Не удалось выполнить поиск
                    </p>
                    <p className="text-xs text-hot-600 dark:text-hot-400 mt-1 mb-4 break-words">{error}</p>
                    <button
                        type="button"
                        onClick={loadSearchResults}
                        className="btn-secondary btn-block sm:w-auto"
                    >
                        Повторить
                    </button>
                </div>
            )}

            {/* Выдача: min-h держит высоту страницы при смене фильтров */}
            <div className="min-h-[60vh]">
                {error ? null : loading ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-stretch">
                        {SKELETON_KEYS.map((key) => (
                            <SearchResultSkeleton key={key} />
                        ))}
                    </div>
                ) : recipes.length === 0 ? (
                    <div className="card p-6 text-center">
                        <div className="w-14 h-14 mx-auto rounded-3xl bg-ink-100 dark:bg-ink-800 flex items-center justify-center text-2xl mb-3">
                            🔍
                        </div>
                        <p className="text-sm font-semibold text-ink-700 dark:text-ink-200">
                            Ничего не найдено
                        </p>
                        <p className="text-[11px] text-ink-400 dark:text-ink-500 mt-1 mb-4">
                            Попробуйте изменить запрос или расширить диапазон цены.
                        </p>
                        <Link
                            to="/"
                            className="btn-outline btn-block sm:w-auto sm:inline-flex"
                        >
                            ← В ленту рецептов
                        </Link>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-stretch">
                        {recipes.map((recipe, index) => (
                            <div
                                key={recipe.id}
                                className="min-w-0 animate-fade-in-up"
                                style={{ animationDelay: `${Math.min(index, 6) * 45}ms` }}
                            >
                                <SearchResultCard
                                    recipe={recipe}
                                    isFavorited={favorites.has(recipe.id)}
                                    onFavoriteUpdate={handleFavoriteUpdate}
                                />
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function SearchResultCard({ recipe, isFavorited, onFavoriteUpdate }) {
    const [favorited, setFavorited] = useState(isFavorited || false);
    const [favoritesCount, setFavoritesCount] = useState(recipe.favorites_count || 0);
    const [isProcessing, setIsProcessing] = useState(false);
    const [imgError, setImgError] = useState(false);
    const isAuthenticated = !!localStorage.getItem('access_token');

    useEffect(() => {
        setFavorited(isFavorited || false);
    }, [isFavorited]);

    const handleFavorite = async () => {
        if (!isAuthenticated) {
            window.location.href = '/login';
            return;
        }
        if (isProcessing) return;
        setIsProcessing(true);
        try {
            if (favorited) {
                await removeFavorite(recipe.id);
                setFavorited(false);
                setFavoritesCount(prev => prev - 1);
                if (onFavoriteUpdate) onFavoriteUpdate(recipe.id, false);
            } else {
                await addFavorite(recipe.id);
                setFavorited(true);
                setFavoritesCount(prev => prev + 1);
                if (onFavoriteUpdate) onFavoriteUpdate(recipe.id, true);
            }
        } catch (err) {
            console.error('Ошибка избранного:', err);
        } finally {
            setIsProcessing(false);
        }
    };

    const photoUrl = recipe.photo_url && !imgError
        ? mediaUrl(recipe.photo_url)
        : null;

    return (
        <article className="card card-hover overflow-hidden h-full flex flex-col">
            <Link to={`/recipe/${recipe.id}`} className="flex gap-3 p-3 min-w-0 flex-1">
                <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl overflow-hidden bg-ink-100 dark:bg-ink-800 flex-shrink-0">
                    {photoUrl ? (
                        <img
                            src={photoUrl}
                            alt={recipe.title}
                            loading="lazy"
                            className="w-full h-full object-cover"
                            onError={() => setImgError(true)}
                        />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-2xl text-ink-300 dark:text-ink-600">
                            🍲
                        </div>
                    )}
                </div>

                <div className="flex-1 min-w-0 flex flex-col">
                    <h2 className="font-bold text-[15px] sm:text-base leading-snug text-ink-900 dark:text-white line-clamp-2 break-words">
                        {recipe.title}
                    </h2>

                    <p className="text-xs text-ink-400 dark:text-ink-500 mt-1 truncate">
                        {recipe.username} • {recipe.time_ago}
                    </p>

                    {recipe.description && (
                        <p className="text-sm text-ink-500 dark:text-ink-400 mt-1 line-clamp-2">
                            {recipe.description}
                        </p>
                    )}

                    <div className="mt-auto pt-2 flex items-end justify-between gap-2 min-w-0">
                        {recipe.total_price ? (
                            <span className="price text-lg sm:text-xl whitespace-nowrap">
                                {recipe.total_price}
                                <span className="text-sm"> ₽</span>
                            </span>
                        ) : (
                            <span className="text-xs text-ink-400">Цена не указана</span>
                        )}
                        <RiBadge value={recipe.ri_score} className="flex-shrink-0" />
                    </div>
                </div>
            </Link>

            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-t border-ink-100 dark:border-ink-800">
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        onClick={handleFavorite}
                        disabled={isProcessing}
                        aria-label={favorited ? 'Убрать из избранного' : 'Добавить в избранное'}
                        aria-pressed={favorited}
                        className={`inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 rounded-xl text-sm font-semibold transition-colors
                        ${favorited
                                ? 'text-hot-600 bg-hot-50 dark:bg-hot-600/10'
                                : 'text-ink-500 dark:text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800'}`}
                    >
                        <span>{favorited ? '❤️' : '🤍'}</span>
                        <span className="tabular-nums">{favoritesCount}</span>
                    </button>

                    <span className="inline-flex items-center gap-1.5 min-h-[44px] px-2 text-sm font-semibold text-ink-500 dark:text-ink-400">
                        💬 <span className="tabular-nums">{recipe.comments_count || 0}</span>
                    </span>
                </div>

                <Link
                    to={`/recipe/${recipe.id}`}
                    className="inline-flex items-center min-h-[44px] px-3 rounded-xl text-sm font-bold text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
                >
                    Открыть →
                </Link>
            </div>
        </article>
    );
}

export default SearchPage;
