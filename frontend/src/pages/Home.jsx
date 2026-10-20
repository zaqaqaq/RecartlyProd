import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getRecipes } from '../services/api';
import { getBasketFeed, getDishFeed } from '../services/smeta';
import BasketCard from '../components/BasketCard';
import DishCard from '../components/DishCard';
import RecipeCard from '../components/RecipeCard';

/**
 * Лента сообщества: что публикуют люди.
 *
 * Наборы — свежие закупки с ценами и датой, блюда — то, что из них готовится,
 * рецепты — блюда без набора. Главная страница при этом остаётся инструментом
 * подбора по бюджету; сюда приходят смотреть, что делают другие.
 */

const TABS = [
    { key: 'baskets', label: '🧺 Наборы' },
    { key: 'dishes', label: '🍲 Блюда' },
    { key: 'recipes', label: '📖 Рецепты' },
];

/* Ровно столько скелетонов, сколько помещается в ряд на десктопе (2 ряда) */
const SKELETON_KEYS = [0, 1, 2, 3, 4, 5];

/**
 * Скелетон карточки набора/блюда. Повторяет структуру карточки один в один —
 * медиа, служебная строка, заголовок, подпись, метаданные, ряд тегов,
 * футер-кнопка, — с теми же высотами блоков (в карточках это min-h-значения),
 * поэтому при загрузке высота ленты не меняется.
 */
function FeedCardSkeleton() {
    return (
        <article className="card overflow-hidden flex flex-col" aria-hidden="true">
            <div className="skeleton w-full h-40 sm:h-44 rounded-t-2xl rounded-b-none" />
            <div className="p-3.5 flex flex-col flex-1">
                {/* Служебная строка: автор / категория */}
                <div className="skeleton min-h-[20px] h-8 w-2/3" />
                {/* Заголовок — ровно две строки */}
                <div className="skeleton min-h-[2.6em] w-full mt-2" />
                {/* Подпись */}
                <div className="skeleton min-h-[2.4em] w-4/5 mt-1" />
                {/* Метаданные: цена */}
                <div className="skeleton min-h-[28px] w-1/2 mt-3" />
                {/* Ряд тегов и метки свежести цен */}
                <div className="skeleton min-h-[54px] w-2/3 mt-2" />
                {/* Футер-кнопка */}
                <div className="skeleton min-h-[44px] w-full mt-auto" />
            </div>
        </article>
    );
}

/** Скелетон карточки-рецепта: у RecipeCard нет медиа-блока, высоты те же. */
function RecipeCardSkeleton() {
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

function Home() {
    const [tab, setTab] = useState('baskets');
    const [baskets, setBaskets] = useState([]);
    const [dishes, setDishes] = useState([]);
    const [recipes, setRecipes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [reloadKey, setReloadKey] = useState(0);

    /* Переключение таба сразу включает скелетон: без этого один кадр успевал
       показать «пусто» нового таба, и лента дёргалась */
    const selectTab = (key) => {
        if (key === tab) return;
        setLoading(true);
        setTab(key);
    };

    const retry = () => {
        setLoading(true);
        setReloadKey((value) => value + 1);
    };

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            setLoading(true);
            setError('');
            try {
                if (tab === 'baskets') {
                    const data = await getBasketFeed({ sort: 'fresh', limit: 18 });
                    if (!cancelled) setBaskets(data.items || []);
                } else if (tab === 'dishes') {
                    const data = await getDishFeed({ sort: 'fresh', limit: 18 });
                    if (!cancelled) setDishes(data.items || []);
                } else {
                    const data = await getRecipes(0, 40);
                    const list = Array.isArray(data) ? data : data?.items || [];
                    // В «Рецептах» показываем только блюда без набора
                    if (!cancelled) setRecipes(list.filter((item) => !item.basket_id));
                }
            } catch (err) {
                if (!cancelled) setError(err.message || 'Не удалось загрузить ленту');
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        load();
        return () => {
            cancelled = true;
        };
    }, [tab, reloadKey]);

    const renderBody = () => {
        if (loading) {
            // Скелетон повторяет форму того таба, который грузится: высота сетки
            // до и после прихода данных совпадает.
            const Skeleton = tab === 'recipes' ? RecipeCardSkeleton : FeedCardSkeleton;
            return (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-stretch">
                    {SKELETON_KEYS.map((key) => (
                        <Skeleton key={key} />
                    ))}
                </div>
            );
        }

        if (error) {
            return (
                <div className="card p-6 text-center">
                    <div className="w-14 h-14 mx-auto rounded-3xl bg-hot-50 dark:bg-hot-500/15 flex items-center justify-center text-2xl mb-3">
                        ⚠️
                    </div>
                    <p className="text-sm font-semibold text-ink-700 dark:text-ink-200">
                        Не удалось загрузить ленту
                    </p>
                    <p className="text-xs text-hot-600 dark:text-hot-400 mt-1 mb-4 break-words">
                        {error}
                    </p>
                    <button
                        type="button"
                        onClick={retry}
                        className="btn-secondary btn-block sm:w-auto"
                    >
                        Повторить
                    </button>
                </div>
            );
        }

        const isEmpty =
            (tab === 'baskets' && baskets.length === 0) ||
            (tab === 'dishes' && dishes.length === 0) ||
            (tab === 'recipes' && recipes.length === 0);

        if (isEmpty) {
            return (
                <div className="card p-8 text-center">
                    <div className="w-14 h-14 mx-auto rounded-3xl bg-primary-100 dark:bg-primary-900/25 flex items-center justify-center text-2xl mb-3">
                        🧺
                    </div>
                    <p className="text-sm font-semibold text-ink-700 dark:text-ink-200">
                        Здесь пока пусто
                    </p>
                    <p className="text-[11px] text-ink-400 dark:text-ink-500 mt-1 mb-4">
                        Станьте первым — соберите набор продуктов и поделитесь им.
                    </p>
                    <Link to="/create-basket" className="btn-primary btn-block sm:w-auto sm:inline-flex">
                        Создать набор
                    </Link>
                </div>
            );
        }

        return (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-stretch">
                {tab === 'baskets' &&
                    baskets.map((basket) => <BasketCard key={basket.id} basket={basket} />)}
                {tab === 'dishes' && dishes.map((dish) => <DishCard key={dish.recipe_id} dish={dish} />)}
                {tab === 'recipes' &&
                    recipes.map((recipe) => <RecipeCard key={recipe.id} recipe={recipe} />)}
            </div>
        );
    };

    return (
        <div className="max-w-5xl mx-auto animate-fade-in pb-bottom-nav">
            <header className="mb-4">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 mb-2 rounded-full bg-primary-100 dark:bg-primary-900/25 text-primary-700 dark:text-primary-300 text-[11px] font-bold uppercase tracking-wide">
                    📣 Сообщество
                </span>
                <h1 className="heading-1">Что готовят и покупают</h1>
                <p className="text-ink-500 dark:text-ink-400 mt-2">
                    Свежие наборы продуктов с ценами, блюда из них и просто рецепты.
                    Хотите подобрать под свой бюджет — это на{' '}
                    <Link to="/" className="text-primary-600 dark:text-primary-400 font-semibold">
                        главной
                    </Link>
                    .
                </p>
            </header>

            <div className="hscroll mb-4" role="tablist" aria-label="Что показывать в ленте">
                {TABS.map((item) => (
                    <button
                        key={item.key}
                        type="button"
                        role="tab"
                        aria-selected={tab === item.key}
                        onClick={() => selectTab(item.key)}
                        className={`tab-pill !min-h-[44px] ${tab === item.key ? 'tab-pill-active' : ''}`}
                    >
                        {item.label}
                    </button>
                ))}
            </div>

            {/* Контейнер выдачи: min-h держит высоту страницы, пока грузятся
                данные и при переключении табов — подвал и кнопки не дёргаются */}
            <div className="min-h-[60vh]">{renderBody()}</div>
        </div>
    );
}

export default Home;
