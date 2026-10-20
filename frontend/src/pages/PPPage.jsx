import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getDishFeed } from '../services/smeta';
import DishCard from '../components/DishCard';

/**
 * Раздел «Правильное питание».
 *
 * Блюда здесь берутся только из наборов (`GET /baskets/dishes`): фильтры по
 * калориям и белку — это фильтры по блюдам, у которых уже посчитан набор и цена.
 * Города в интерфейсе нет: цены авторские, набор стоит столько, сколько указал автор.
 */

const money = (value, digits = 0) =>
    typeof value === 'number'
        ? `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value)} ₽`
        : '—';

/* Пресеты ПП: каждый задаёт пару фильтров КБЖУ */
const PRESETS = [
    { key: 'light', label: 'Лёгкое', emoji: '🥗', maxKcal: 400, minProtein: null },
    { key: 'protein', label: 'Много белка', emoji: '💪', maxKcal: null, minProtein: 25 },
    { key: 'filling', label: 'Сытное', emoji: '🍲', maxKcal: null, minProtein: 15 },
    { key: 'all', label: 'Всё', emoji: '✨', maxKcal: null, minProtein: null },
];

const SORTS = [
    { key: 'popular', label: 'Популярные' },
    { key: 'cheap', label: 'Дешёвые' },
    { key: 'fresh', label: 'Свежие цены' },
];

/* Границы ползунков: верхнее значение = «без ограничения» */
const KCAL_MIN = 100;
const KCAL_MAX = 900;
const KCAL_STEP = 50;
const PROTEIN_MIN = 0;
const PROTEIN_MAX = 50;
const PROTEIN_STEP = 5;

/* Саму карточку блюда — с фото, ценой набора и меткой свежести цен —
   рисует общий компонент components/DishCard.jsx. */

/* Скелетон повторяет структуру DishCard один в один: медиа h-40 sm:h-44,
   тело p-3.5 и блоки тех же высот (в карточке это min-h-значения) —
   ряд тегов, заголовок, подпись, метаданные, метки свежести, футер-кнопка.
   Поэтому сетка не «прыгает» при загрузке. */
const SKELETON_KEYS = [0, 1, 2, 3, 4, 5];

function DishSkeleton() {
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

function PPPage() {
    const [maxKcal, setMaxKcal] = useState(null);
    const [minProtein, setMinProtein] = useState(null);
    const [budget, setBudget] = useState(null);
    const [budgetInput, setBudgetInput] = useState('');
    const [sort, setSort] = useState('popular');

    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [reloadKey, setReloadKey] = useState(0);

    const activePreset = useMemo(
        () => PRESETS.find((preset) => preset.maxKcal === maxKcal && preset.minProtein === minProtein),
        [maxKcal, minProtein]
    );

    const applyPreset = (preset) => {
        setMaxKcal(preset.maxKcal);
        setMinProtein(preset.minProtein);
    };

    const resetFilters = () => {
        applyPreset(PRESETS[PRESETS.length - 1]);
        setBudget(null);
        setBudgetInput('');
        setSort('popular');
    };

    const applyBudgetInput = (raw) => {
        const digits = String(raw).replace(/[^\d]/g, '').slice(0, 6);
        setBudgetInput(digits);
        const value = Number(digits);
        setBudget(Number.isFinite(value) && value > 0 ? Math.min(100000, value) : null);
    };

    /* Небольшая задержка, чтобы ползунки не дёргали API на каждое движение */
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError('');

        const timer = setTimeout(() => {
            getDishFeed({
                budget: budget ?? undefined,
                max_kcal: maxKcal ?? undefined,
                min_protein: minProtein ?? undefined,
                sort,
                limit: 30,
            })
                .then((data) => {
                    if (cancelled) return;
                    setItems(Array.isArray(data?.items) ? data.items : []);
                })
                .catch((err) => {
                    if (cancelled) return;
                    setError(err?.message || 'Не удалось загрузить блюда');
                    setItems([]);
                })
                .finally(() => {
                    if (!cancelled) setLoading(false);
                });
        }, 350);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [budget, maxKcal, minProtein, sort, reloadKey]);

    const retry = useCallback(() => setReloadKey((key) => key + 1), []);

    const kcalValue = maxKcal ?? KCAL_MAX;
    const proteinValue = minProtein ?? PROTEIN_MIN;
    const hasFilters = maxKcal != null || minProtein != null || budget != null;

    return (
        <div className="max-w-5xl mx-auto pb-bottom-nav animate-fade-in">
            {/* Заголовок раздела */}
            <header>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 mb-2 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 text-[11px] font-bold uppercase tracking-wide">
                    🥗 ПП
                </span>
                <h1 className="heading-1">Правильное питание</h1>
                <p className="mt-1.5 max-w-2xl text-sm sm:text-base text-ink-500 dark:text-ink-400">
                    Блюда из наборов, которые влезают в бюджет: фильтруйте по калориям и белку
                </p>
            </header>

            {/* Фильтры */}
            <section className="card p-4 sm:p-5 mt-4 space-y-4">
                <div>
                    <span className="label">Пресеты</span>
                    <div className="hscroll -mx-1 px-1" role="group" aria-label="Пресеты правильного питания">
                        {PRESETS.map((preset) => (
                            <button
                                key={preset.key}
                                type="button"
                                onClick={() => applyPreset(preset)}
                                aria-pressed={activePreset?.key === preset.key}
                                className={`chip min-h-[44px] px-4 mr-1.5 ${
                                    activePreset?.key === preset.key ? 'chip-active' : ''
                                }`}
                            >
                                <span aria-hidden="true">{preset.emoji}</span>
                                {preset.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                    {/* Калории */}
                    <div>
                        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                            <label htmlFor="pp-kcal" className="label !mb-0 min-w-0">
                                Калорий на порцию не больше
                            </label>
                            <span className="text-sm font-bold text-primary-600 dark:text-primary-400 tabular whitespace-nowrap">
                                {maxKcal != null ? `${maxKcal} ккал` : 'без ограничения'}
                            </span>
                        </div>
                        <input
                            id="pp-kcal"
                            type="range"
                            min={KCAL_MIN}
                            max={KCAL_MAX}
                            step={KCAL_STEP}
                            value={kcalValue}
                            onChange={(e) => {
                                const value = Number(e.target.value);
                                setMaxKcal(value >= KCAL_MAX ? null : value);
                            }}
                            className="w-full h-11 cursor-pointer accent-primary-500 dark:accent-primary-400"
                        />
                        <div className="flex justify-between text-[11px] text-ink-400 dark:text-ink-500 tabular">
                            <span>{KCAL_MIN}</span>
                            <span>{KCAL_MAX}+</span>
                        </div>
                    </div>

                    {/* Белок */}
                    <div>
                        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                            <label htmlFor="pp-protein" className="label !mb-0 min-w-0">
                                Белка не меньше, г
                            </label>
                            <span className="text-sm font-bold text-primary-600 dark:text-primary-400 tabular whitespace-nowrap">
                                {minProtein != null ? `от ${minProtein} г` : 'без ограничения'}
                            </span>
                        </div>
                        <input
                            id="pp-protein"
                            type="range"
                            min={PROTEIN_MIN}
                            max={PROTEIN_MAX}
                            step={PROTEIN_STEP}
                            value={proteinValue}
                            onChange={(e) => {
                                const value = Number(e.target.value);
                                setMinProtein(value <= PROTEIN_MIN ? null : value);
                            }}
                            className="w-full h-11 cursor-pointer accent-primary-500 dark:accent-primary-400"
                        />
                        <div className="flex justify-between text-[11px] text-ink-400 dark:text-ink-500 tabular">
                            <span>{PROTEIN_MIN}</span>
                            <span>{PROTEIN_MAX}</span>
                        </div>
                    </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                    {/* Бюджет — необязательный */}
                    <div>
                        <label htmlFor="pp-budget" className="label">
                            Бюджет на набор, ₽ <span className="font-normal text-ink-400">— необязательно</span>
                        </label>
                        <input
                            id="pp-budget"
                            type="text"
                            inputMode="numeric"
                            value={budgetInput}
                            onChange={(e) => applyBudgetInput(e.target.value)}
                            placeholder="Например, 1500"
                            className="input tabular"
                        />
                    </div>

                    {/* Сортировка */}
                    <div>
                        <span className="label">Сортировка</span>
                        <div className="hscroll -mx-1 px-1" role="group" aria-label="Сортировка блюд">
                            {SORTS.map((option) => (
                                <button
                                    key={option.key}
                                    type="button"
                                    onClick={() => setSort(option.key)}
                                    aria-pressed={sort === option.key}
                                    className={`chip min-h-[44px] px-4 mr-1.5 ${sort === option.key ? 'chip-active' : ''}`}
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </section>

            {/* Итог по выдаче. min-h — строка не меняет высоту, когда появляется
                кнопка «Сбросить фильтры» */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 min-h-[44px]">
                <p className="text-sm text-ink-600 dark:text-ink-300 min-w-0">
                    {loading
                        ? 'Подбираем блюда…'
                        : `Найдено блюд: ${items.length}${budget ? ` · бюджет до ${money(budget)}` : ''}`}
                </p>
                {hasFilters && !loading && (
                    <button
                        type="button"
                        onClick={resetFilters}
                        className="btn-ghost min-h-[44px] text-sm"
                    >
                        Сбросить фильтры
                    </button>
                )}
            </div>

            {/* Ошибка: единая плашка с иконкой, пояснением и «Повторить» */}
            {error && !loading && (
                <div className="card p-6 mt-3 text-center border-hot-500/30 dark:border-hot-500/30">
                    <div className="w-14 h-14 mx-auto rounded-3xl bg-hot-50 dark:bg-hot-500/15 flex items-center justify-center text-2xl mb-3">
                        ⚠️
                    </div>
                    <p className="text-sm font-semibold text-ink-700 dark:text-ink-200">
                        Не удалось загрузить блюда
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
            )}

            {/* Выдача: контейнер с min-h, чтобы смена фильтров не дёргала страницу */}
            <div className="mt-3 min-h-[60vh]">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-stretch">
                    {loading
                        ? SKELETON_KEYS.map((i) => <DishSkeleton key={i} />)
                        : items.map((item) => <DishCard key={item.recipe_id} dish={item} />)}
                </div>

                {/* Пустое состояние */}
                {!loading && !error && items.length === 0 && (
                    <div className="card p-6 text-center">
                        <div className="w-14 h-14 mx-auto rounded-3xl bg-primary-100 dark:bg-primary-900/25 flex items-center justify-center text-2xl mb-3">
                            🥗
                        </div>
                        <p className="text-sm font-semibold text-ink-700 dark:text-ink-200">
                            Под такие фильтры ничего не нашлось
                        </p>
                        <p className="text-[11px] text-ink-400 dark:text-ink-500 mt-1 mb-4">
                            Ослабьте калории или белок — покажем больше блюд.
                        </p>
                        <button
                            type="button"
                            onClick={resetFilters}
                            className="btn-primary btn-block sm:w-auto sm:inline-flex"
                        >
                            Показать все блюда
                        </button>
                    </div>
                )}
            </div>

            {/* Пояснение к выдаче — без упоминания городов: цены авторские */}
            {!loading && !error && items.length > 0 && (
                <p className="mt-4 text-xs text-ink-400 dark:text-ink-500">
                    Здесь только блюда, которые готовятся из набора: калории и белок указаны на
                    порцию, цена — авторская цена всего набора.
                </p>
            )}
        </div>
    );
}

export default PPPage;
