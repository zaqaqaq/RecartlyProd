import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { generateMealPlan } from '../services/smeta';
import BudgetRail from '../components/BudgetRail';

const money = (value, digits = 0) =>
    typeof value === 'number'
        ? `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value)} ₽`
        : '—';

const DIETS = [
    { value: 'any', label: 'Любое', emoji: '🍽' },
    { value: 'pp', label: 'ПП', emoji: '🥗' },
    { value: 'vegetarian', label: 'Вегетарианское', emoji: '🌱' },
    { value: 'high_protein', label: 'Белковое', emoji: '💪' },
];

const MEAL_LABELS = {
    breakfast: 'Завтрак',
    lunch: 'Обед',
    dinner: 'Ужин',
    snack: 'Перекус',
};

const DAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/**
 * План питания в рамках бюджета: «7 ужинов на 3000 ₽» с расчётом КБЖУ.
 * ПП-режим дополнительно целится в калории и белок.
 */
function MealPlanPage() {
    const navigate = useNavigate();
    const [days, setDays] = useState(7);
    const [mealsPerDay, setMealsPerDay] = useState(3);
    const [servings, setServings] = useState(2);
    const [budget, setBudget] = useState(() => Number(localStorage.getItem('recartly_budget')) || 3000);
    const [diet, setDiet] = useState('any');
    const [kcalTarget, setKcalTarget] = useState('');
    const [proteinTarget, setProteinTarget] = useState('');

    const [plan, setPlan] = useState(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const buildPayload = () => ({
        city_id: Number(localStorage.getItem('recartly_city_id')) || null,
        days,
        meals_per_day: mealsPerDay,
        servings,
        budget: budget || null,
        diet,
        kcal_target: kcalTarget ? Number(kcalTarget) : null,
        protein_target: proteinTarget ? Number(proteinTarget) : null,
    });

    const handleGenerate = async () => {
        setLoading(true);
        setError('');
        try {
            const result = await generateMealPlan(buildPayload(), false);
            setPlan(result);
        } catch (err) {
            setError(err.message || 'Не удалось собрать меню');
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        if (!localStorage.getItem('access_token')) {
            navigate('/login');
            return;
        }
        setSaving(true);
        setError('');
        try {
            const saved = await generateMealPlan(buildPayload(), true);
            setPlan(saved);
        } catch (err) {
            setError(err.message || 'Не удалось сохранить план');
        } finally {
            setSaving(false);
        }
    };

    const itemsByDay = (plan?.items || []).reduce((acc, item) => {
        const key = item.day_index;
        if (!acc[key]) acc[key] = [];
        acc[key].push(item);
        return acc;
    }, {});

    return (
        <div className="max-w-4xl mx-auto animate-fade-in pb-bottom-nav">
            <header className="mb-4">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary-100 dark:bg-primary-900/25 text-primary-700 dark:text-primary-300 text-[11px] font-bold uppercase tracking-wide">
                    🗓 меню на неделю
                </span>
                <h1 className="heading-1 mt-2">Соберите меню под бюджет</h1>
                <p className="text-sm text-ink-500 dark:text-ink-400 mt-1.5">
                    Укажите сумму и режим питания — рассчитаем блюда, стоимость и КБЖУ на каждый день.
                </p>
            </header>

            {/* Параметры */}
            <section className="card p-3.5 sm:p-5 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                        <label className="label" htmlFor="mp-budget">Бюджет, ₽</label>
                        <input
                            id="mp-budget"
                            type="text"
                            inputMode="numeric"
                            className="input tabular"
                            value={budget}
                            onChange={(e) => setBudget(Number(e.target.value.replace(/[^\d]/g, '')) || 0)}
                        />
                    </div>
                    <div>
                        <label className="label" htmlFor="mp-servings">Порций на приём</label>
                        <input
                            id="mp-servings"
                            type="number"
                            min="1"
                            max="20"
                            className="input tabular"
                            value={servings}
                            onChange={(e) => setServings(Math.max(1, Number(e.target.value) || 1))}
                        />
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <span className="label">Дней</span>
                        <div className="flex gap-1">
                            {[3, 5, 7].map((value) => (
                                <button
                                    key={value}
                                    type="button"
                                    onClick={() => setDays(value)}
                                    aria-pressed={days === value}
                                    className={`chip flex-1 justify-center !min-h-[44px] ${days === value ? 'chip-active' : ''}`}
                                >
                                    {value}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div>
                        <span className="label">Приёмов в день</span>
                        <div className="flex gap-1">
                            {[1, 2, 3, 4].map((value) => (
                                <button
                                    key={value}
                                    type="button"
                                    onClick={() => setMealsPerDay(value)}
                                    aria-pressed={mealsPerDay === value}
                                    className={`chip flex-1 justify-center !min-h-[44px] ${mealsPerDay === value ? 'chip-active' : ''}`}
                                >
                                    {value}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div>
                    <span className="label">Режим питания</span>
                    <div className="hscroll">
                        {DIETS.map((option) => (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => setDiet(option.value)}
                                aria-pressed={diet === option.value}
                                className={`chip ${diet === option.value ? 'chip-active' : ''}`}
                            >
                                {option.emoji} {option.label}
                            </button>
                        ))}
                    </div>
                </div>

                {diet === 'pp' && (
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="label" htmlFor="mp-kcal">Калорий в день</label>
                            <input
                                id="mp-kcal"
                                type="number"
                                inputMode="numeric"
                                placeholder="2000"
                                className="input tabular"
                                value={kcalTarget}
                                onChange={(e) => setKcalTarget(e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="label" htmlFor="mp-protein">Белка в день, г</label>
                            <input
                                id="mp-protein"
                                type="number"
                                inputMode="numeric"
                                placeholder="120"
                                className="input tabular"
                                value={proteinTarget}
                                onChange={(e) => setProteinTarget(e.target.value)}
                            />
                        </div>
                    </div>
                )}

                <div className="flex flex-col sm:flex-row gap-2">
                    <button type="button" onClick={handleGenerate} disabled={loading} className="btn-primary flex-1">
                        {loading ? 'Считаем…' : '🗓 Собрать меню'}
                    </button>
                    {plan && (
                        <button type="button" onClick={handleSave} disabled={saving} className="btn-secondary flex-1">
                            {saving ? 'Сохраняем…' : '💾 Сохранить план'}
                        </button>
                    )}
                </div>

                {error && <p className="text-sm text-hot-600 dark:text-hot-400">{error}</p>}
            </section>

            {/* Результат */}
            {plan && (
                <>
                    <section className="card p-3.5 sm:p-5 mt-4">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <h2 className="section-title">Итог плана</h2>
                                <p className="text-xs text-ink-500 dark:text-ink-400 mt-1">
                                    {plan.days} дн. · {plan.servings} порц. ·{' '}
                                    {DIETS.find((d) => d.value === plan.diet)?.label}
                                </p>
                            </div>
                            <span className="price price-lg whitespace-nowrap">{money(plan.total_price)}</span>
                        </div>

                        {plan.budget ? (
                            <div className="mt-3">
                                <BudgetRail budget={plan.budget} total={plan.total_price} />
                            </div>
                        ) : null}

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                            <div className="metric">
                                <span className="metric-value">{money(plan.price_per_day)}</span>
                                <span className="metric-label">в день</span>
                            </div>
                            <div className="metric">
                                <span className="metric-value">{Math.round(plan.kcal_per_day || 0)}</span>
                                <span className="metric-label">ккал в день</span>
                            </div>
                            <div className="metric">
                                <span className="metric-value">{Math.round(plan.protein_per_day || 0)} г</span>
                                <span className="metric-label">белка</span>
                            </div>
                            <div className="metric">
                                <span className="metric-value">
                                    {Math.round(plan.fat_per_day || 0)} / {Math.round(plan.carbs_per_day || 0)}
                                </span>
                                <span className="metric-label">жиры / углеводы</span>
                            </div>
                        </div>

                        {plan.kcal_target && (
                            <p className="text-xs text-ink-500 dark:text-ink-400 mt-3">
                                Цель {plan.kcal_target} ккал: {plan.kcal_per_day >= plan.kcal_target * 0.85 ? '✅ близко' : '⚠️ ниже цели'}
                                {plan.protein_target
                                    ? ` · белок ${Math.round(plan.protein_per_day)} из ${plan.protein_target} г`
                                    : ''}
                            </p>
                        )}
                    </section>

                    <section className="mt-4 space-y-3">
                        <h2 className="section-title">Меню по дням</h2>
                        {Object.keys(itemsByDay)
                            .map(Number)
                            .sort((a, b) => a - b)
                            .map((day) => {
                                const dayItems = itemsByDay[day];
                                const daySummary = (plan.per_day || []).find((d) => d.day_index === day);
                                return (
                                    <div key={day} className="card p-3">
                                        <div className="flex items-center justify-between gap-2">
                                            <h3 className="font-display font-bold text-sm text-ink-800 dark:text-ink-100">
                                                День {day + 1}
                                                <span className="text-ink-400 dark:text-ink-500 font-normal">
                                                    {' · '}{DAY_NAMES[day % 7]}
                                                </span>
                                            </h3>
                                            {daySummary && (
                                                <span className="text-xs text-ink-500 dark:text-ink-400 tabular">
                                                    {money(daySummary.price)} · {Math.round(daySummary.kcal)} ккал
                                                </span>
                                            )}
                                        </div>

                                        <div className="mt-2 divide-y divide-ink-100 dark:divide-ink-800">
                                            {dayItems.map((item, index) => (
                                                <Link
                                                    key={`${item.recipe_id}-${index}`}
                                                    to={`/recipe/${item.recipe_id}`}
                                                    className="flex items-center gap-3 min-h-[44px] py-1.5 hover:bg-ink-100 dark:hover:bg-ink-800 rounded-xl px-1 transition-colors"
                                                >
                                                    <span className="text-[11px] font-bold uppercase tracking-wide text-ink-400 dark:text-ink-500 w-16 flex-shrink-0">
                                                        {MEAL_LABELS[item.meal_type] || item.meal_type}
                                                    </span>
                                                    <span className="flex-1 min-w-0">
                                                        <span className="block text-sm font-medium text-ink-800 dark:text-ink-100 truncate">
                                                            {item.title}
                                                        </span>
                                                        <span className="block text-[11px] text-ink-400 tabular">
                                                            {Math.round(item.kcal || 0)} ккал · Б {Math.round(item.protein || 0)} г
                                                        </span>
                                                    </span>
                                                    <span className="tabular text-sm font-semibold text-ink-700 dark:text-ink-200 whitespace-nowrap">
                                                        {money(item.price)}
                                                    </span>
                                                </Link>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                    </section>
                </>
            )}
        </div>
    );
}

export default MealPlanPage;
