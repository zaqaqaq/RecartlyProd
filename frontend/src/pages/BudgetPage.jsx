import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getBasketFeed, getDishFeed } from '../services/smeta';
import BasketCard, { formatMoney, pluralRu } from '../components/BasketCard';
import DishCard from '../components/DishCard';
import BudgetRail from '../components/BudgetRail';
import GuestsLanding from '../components/GuestsLanding';

/* ============================================================
   Главный экран.
   Основная единица продукта — НАБОР (корзина продуктов с ценами и датой),
   а блюда показываются как то, что из набора готовится.
   Города на главной нет: цены подбираются без привязки к фильтру города.

   Экран зависит от входа:
   — ГОСТЬ (нет токена) видит презентацию сервиса (GuestsLanding) с кнопками
     «Зарегистрироваться» / «Войти»: инструмент подбора для него бесполезен,
     а его запросы к API давали «Не удалось загрузить подбор. Failed to fetch»;
   — ВОШЕДШИЙ получает тот же инструмент подбора, что и раньше (BudgetTool).
   ============================================================ */

const QUICK_BUDGETS = [300, 500, 800, 1000, 1500];
const SERVING_OPTIONS = [1, 2, 4, 6];
const SORTS = [
    { value: 'popular', label: 'Сначала популярные' },
    { value: 'cheap', label: 'Сначала дешёвые' },
    { value: 'expensive', label: 'Сначала дорогие' },
    { value: 'fresh', label: 'Недавно обновили цены' },
];
const TABS = [
    { key: 'baskets', label: 'Корзины', emoji: '🧺' },
    { key: 'dishes', label: 'Блюда', emoji: '🍲' },
];
const PAGE_LIMIT = 30;
const MAX_BUDGET = 100000;

/** «1, 2 или 4» — перечисление выбранных значений по-русски. */
function joinRu(values) {
    const list = values.map(String);
    if (list.length <= 1) return list.join('');
    return `${list.slice(0, -1).join(', ')} или ${list[list.length - 1]}`;
}

/**
 * Подпись к мультивыбору «на сколько человек»: сразу видно, что фильтр
 * складывается из нескольких значений. Согласование — по последнему числу.
 */
export function servingsCaption(servings) {
    if (!servings || servings.length === 0) return 'Показать наборы на любое число человек';
    return `Показать наборы на ${joinRu(servings)} ${pluralRu(
        servings[servings.length - 1],
        'человека',
        'человека',
        'человек'
    )}`;
}

/** Скелетон карточки набора/блюда, пока считаем цены.
 *  Повторяет структуру BasketCard/DishCard: медиа h-40 sm:h-44, тело p-3.5 и
 *  блоки тех же высот (служебная строка, заголовок, подпись, метаданные, ряд
 *  тегов, футер-кнопка), поэтому выдача не «прыгает». */
function CardSkeleton() {
    return (
        <article className="card overflow-hidden flex flex-col" aria-hidden="true">
            <div className="skeleton w-full h-40 sm:h-44 rounded-t-2xl rounded-b-none" />
            <div className="p-3.5 flex flex-col flex-1">
                <div className="skeleton min-h-[20px] h-8 w-2/3" />
                <div className="skeleton min-h-[2.6em] w-full mt-2" />
                <div className="skeleton min-h-[2.4em] w-4/5 mt-1" />
                <div className="skeleton min-h-[28px] w-1/2 mt-3" />
                <div className="skeleton min-h-[54px] w-2/3 mt-2" />
                <div className="skeleton min-h-[44px] w-full mt-auto" />
            </div>
        </article>
    );
}

/**
 * Инструмент подбора по бюджету — только для вошедших.
 * Логика, фильтры и выдача не менялись: компонент просто переехал сюда целиком.
 */
function BudgetTool() {
    const [tab, setTab] = useState('baskets');
    const [budgetInput, setBudgetInput] = useState('');
    const [budget, setBudget] = useState(null);
    const [servings, setServings] = useState([]);
    const [sort, setSort] = useState('popular');
    const [data, setData] = useState({ total: 0, items: [] });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [reloadKey, setReloadKey] = useState(0);

    // Мультивыбор «на сколько человек»: ключ для зависимостей, чтобы массив не дёргал эффект зря
    const servingsKey = useMemo(() => servings.join(','), [servings]);

    useEffect(() => {
        let cancelled = false;
        const timer = setTimeout(() => {
            setLoading(true);
            setError('');

            const servingsList = servingsKey ? servingsKey.split(',').map(Number) : [];
            const params = {
                budget: budget || undefined,
                servings: servingsList.length ? servingsList : undefined,
                sort,
                limit: PAGE_LIMIT,
            };

            const promise = tab === 'dishes' ? getDishFeed(params) : getBasketFeed(params);

            promise
                .then((result) => {
                    if (cancelled) return;
                    setData({
                        total: Number(result?.total) || 0,
                        items: result?.items || [],
                    });
                })
                .catch((err) => {
                    if (cancelled) return;
                    setData({ total: 0, items: [] });
                    setError(err.message || 'Не удалось загрузить подбор');
                })
                .finally(() => {
                    if (!cancelled) setLoading(false);
                });
        }, 300);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [tab, budget, servingsKey, sort, reloadKey]);

    const handleBudgetChange = useCallback((raw) => {
        // В поле живут только цифры: «800 ₽», «8о0» и пробелы одинаково понятны
        const digits = String(raw).replace(/[^\d]/g, '').slice(0, 6);
        setBudgetInput(digits);
        const parsed = Number(digits);
        setBudget(Number.isFinite(parsed) && parsed > 0 ? Math.min(MAX_BUDGET, parsed) : null);
    }, []);

    const pickBudget = useCallback((value) => {
        setBudgetInput(String(value));
        setBudget(value);
    }, []);

    const resetBudget = useCallback(() => {
        setBudgetInput('');
        setBudget(null);
    }, []);

    const resetAll = useCallback(() => {
        setBudgetInput('');
        setBudget(null);
        setServings([]);
        setSort('popular');
    }, []);

    const toggleServings = useCallback((value) => {
        setServings((prev) => {
            const next = prev.includes(value)
                ? prev.filter((item) => item !== value)
                : [...prev, value];
            return next.sort((a, b) => a - b);
        });
    }, []);

    const items = data.items;
    const isBaskets = tab === 'baskets';

    // «Потрачено X из Y ₽» — считаем по самой дешёвой закупке в подборке
    const sampleTotal = useMemo(() => {
        const totals = items
            .map((item) => Number(isBaskets ? item.total_price : item.basket_total))
            .filter((value) => Number.isFinite(value) && value > 0);
        return totals.length ? Math.min(...totals) : 0;
    }, [items, isBaskets]);

    const railState = useMemo(() => {
        const left = Number(budget) - sampleTotal;
        const ratio = Number(budget) > 0 ? sampleTotal / Number(budget) : 0;
        const className =
            ratio > 1 ? 'budget-pill budget-over' : ratio >= 0.8 ? 'budget-pill budget-warn' : 'budget-pill budget-ok';
        return { left, className };
    }, [budget, sampleTotal]);

    const caption = servingsCaption(servings);
    const totalLabel = isBaskets ? 'наборов' : 'блюд';

    return (
        <div className="max-w-5xl mx-auto animate-fade-in pb-bottom-nav">
            {/* Приветствие: главный вопрос продукта */}
            <section className="rounded-3xl bg-gradient-to-br from-primary-600 via-primary-700 to-ink-900 text-white p-4 sm:p-6 shadow-brand">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15 text-[11px] font-bold uppercase tracking-wide">
                    🧺 подбор по бюджету
                </span>
                <h1 className="mt-3 text-2xl sm:text-3xl font-extrabold tracking-tight">
                    Сколько у вас на еду?
                </h1>
                <p className="mt-1.5 text-sm text-white/85 max-w-xl">
                    Сервис собирает набор продуктов под вашу сумму и показывает, что из него можно
                    приготовить. Смотрите наборы целиком или сразу блюда — цены у каждого набора свои.
                </p>
            </section>

            {/* Фильтры: бюджет, число человек, сортировка */}
            <section className="card p-3.5 sm:p-4 mt-4 space-y-4">
                <div>
                    <label className="label" htmlFor="budget-input">
                        Ваш бюджет на закупку
                    </label>
                    <div className="flex items-stretch gap-2">
                        <div className="relative flex-1">
                            <input
                                id="budget-input"
                                type="text"
                                inputMode="numeric"
                                autoComplete="off"
                                value={budgetInput}
                                onChange={(event) => handleBudgetChange(event.target.value)}
                                placeholder="Например, 800"
                                className="input pr-10 text-lg font-display font-extrabold tabular"
                                aria-describedby="budget-hint"
                            />
                            <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-ink-400 dark:text-ink-500 font-bold pointer-events-none">
                                ₽
                            </span>
                        </div>
                        <button
                            type="button"
                            onClick={resetBudget}
                            disabled={!budget && !budgetInput}
                            className="btn-ghost flex-shrink-0 disabled:opacity-40"
                        >
                            Сбросить
                        </button>
                    </div>

                    <div className="hscroll mt-2">
                        {QUICK_BUDGETS.map((value) => (
                            <button
                                key={value}
                                type="button"
                                onClick={() => pickBudget(value)}
                                aria-pressed={budget === value}
                                className={`chip !min-h-[44px] ${budget === value ? 'chip-active' : ''}`}
                            >
                                {formatMoney(value)} ₽
                            </button>
                        ))}
                    </div>

                    <p id="budget-hint" className="text-[11px] text-ink-400 dark:text-ink-500 mt-1.5">
                        Бюджет можно не указывать — тогда покажем все наборы.
                    </p>
                </div>

                <div className="pt-3 border-t border-ink-100 dark:border-ink-800">
                    <p className="label !mb-1">На сколько человек</p>
                    <p className="text-[11px] text-ink-400 dark:text-ink-500 mb-1.5">{caption}</p>
                    <div className="hscroll">
                        {SERVING_OPTIONS.map((value) => {
                            const active = servings.includes(value);
                            return (
                                <button
                                    key={value}
                                    type="button"
                                    onClick={() => toggleServings(value)}
                                    aria-pressed={active}
                                    className={`chip !min-h-[44px] ${active ? 'chip-active' : ''}`}
                                >
                                    {active && <span aria-hidden="true">✓</span>}
                                    {value}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="pt-3 border-t border-ink-100 dark:border-ink-800">
                    <p className="label !mb-1.5">Сортировка</p>
                    <div className="hscroll">
                        {SORTS.map((option) => (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => setSort(option.value)}
                                aria-pressed={sort === option.value}
                                className={`chip !min-h-[44px] ${sort === option.value ? 'chip-active' : ''}`}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                </div>
            </section>

            {/* Переключатель «Корзины | Блюда» */}
            <div className="hscroll mt-4" role="tablist" aria-label="Что показывать">
                {TABS.map((item) => (
                    <button
                        key={item.key}
                        type="button"
                        role="tab"
                        aria-selected={tab === item.key}
                        onClick={() => setTab(item.key)}
                        className={`tab-pill !min-h-[44px] ${tab === item.key ? 'tab-pill-active' : ''}`}
                    >
                        <span aria-hidden="true">{item.emoji}</span>
                        {item.label}
                    </button>
                ))}
            </div>

            {/* Полоса бюджета: сколько стоит самая дешёвая закупка из подборки */}
            {budget && !loading && !error && items.length > 0 && (
                <section className="card p-3.5 mt-3">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-ink-500 dark:text-ink-400">
                            {isBaskets ? 'Самый дешёвый набор в подборке' : 'Самая дешёвая закупка в подборке'}
                        </span>
                        <span className={railState.className}>
                            {railState.left >= 0
                                ? `остаток ${formatMoney(railState.left)} ₽`
                                : `перебор ${formatMoney(Math.abs(railState.left))} ₽`}
                        </span>
                    </div>
                    <p className="text-sm font-bold text-ink-700 dark:text-ink-200 tabular mt-1.5">
                        Потрачено {formatMoney(sampleTotal)} из {formatMoney(budget)} ₽,{' '}
                        {railState.left >= 0
                            ? `остаток ${formatMoney(railState.left)} ₽`
                            : `перебор ${formatMoney(Math.abs(railState.left))} ₽`}
                    </p>
                    <BudgetRail
                        budget={budget}
                        total={sampleTotal}
                        size="md"
                        showLabels={false}
                        className="mt-2"
                    />
                </section>
            )}

            {/* Счётчик выдачи: min-h, чтобы появление кнопки «Сбросить фильтры»
                не сдвигало сетку вниз */}
            {!error && (
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mt-4 min-h-[44px]">
                    <p className="text-sm text-ink-600 dark:text-ink-300 min-w-0">
                        {loading
                            ? 'Считаем цены…'
                            : budget
                              ? `В бюджет до ${formatMoney(budget)} ₽ попадает ${data.total} ${totalLabel}`
                              : `Найдено ${data.total} ${totalLabel}`}
                    </p>
                    {(budget || servings.length > 0) && (
                        <button
                            type="button"
                            onClick={resetAll}
                            className="text-xs font-bold text-primary-600 dark:text-primary-400 hover:underline min-h-[44px]"
                        >
                            Сбросить фильтры
                        </button>
                    )}
                </div>
            )}

            {error && (
                <div className="card p-6 mt-3 text-center border-hot-500/40">
                    <div className="w-14 h-14 mx-auto rounded-3xl bg-hot-50 dark:bg-hot-500/15 flex items-center justify-center text-2xl mb-3">
                        ⚠️
                    </div>
                    <p className="text-sm font-semibold text-ink-700 dark:text-ink-200">
                        Не удалось загрузить подбор
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

            {/* Выдача: наборы или блюда из наборов. min-h держит высоту страницы,
                пока считаются цены и при переключении «Корзины | Блюда» */}
            <div className="mt-3 min-h-[60vh]">
                {!error && loading && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-stretch">
                        {[0, 1, 2, 3, 4, 5].map((key) => (
                            <CardSkeleton key={key} />
                        ))}
                    </div>
                )}

                {!error && !loading && items.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-stretch">
                        {items.map((item) =>
                            isBaskets ? (
                                <BasketCard key={item.id} basket={item} budget={budget} />
                            ) : (
                                <DishCard key={`${item.recipe_id}-${item.basket_id}`} dish={item} />
                            )
                        )}
                    </div>
                )}

                {!error && !loading && items.length === 0 && (
                    <div className="card p-6 text-center">
                        <div className="w-14 h-14 mx-auto rounded-3xl bg-primary-100 dark:bg-primary-900/25 flex items-center justify-center text-2xl mb-3">
                            🧺
                        </div>
                        <p className="text-sm font-semibold text-ink-700 dark:text-ink-200">
                            Ничего не нашлось — увеличьте бюджет
                        </p>
                        <p className="text-[11px] text-ink-400 dark:text-ink-500 mt-1 mb-4">
                            Или снимите фильтр «на сколько человек»: подбор станет шире.
                        </p>
                        <button
                            type="button"
                            onClick={resetAll}
                            className="btn-primary btn-block sm:w-auto sm:inline-flex"
                        >
                            Сбросить фильтры
                        </button>
                    </div>
                )}
            </div>

            {/* Единственная ссылка на ленту сообщества — без карточек обсуждений */}
            <Link
                to="/feed"
                className="mt-4 flex items-center justify-center gap-1.5 min-h-[44px] text-sm font-bold text-primary-600 dark:text-primary-400 hover:underline"
            >
                Что обсуждают сегодня →
            </Link>
        </div>
    );
}

/**
 * Точка входа главной: решаем, что показать.
 *
 * Проверка та же, что в остальном приложении: токен в `localStorage`.
 * Гостю вместо инструмента отдаём презентацию — так он не увидит ошибку
 * загрузки подбора и сразу поймёт, зачем регистрироваться.
 */
function BudgetPage() {
    const isAuthenticated = Boolean(localStorage.getItem('access_token'));

    if (!isAuthenticated) {
        return <GuestsLanding />;
    }

    return <BudgetTool />;
}

export default BudgetPage;
