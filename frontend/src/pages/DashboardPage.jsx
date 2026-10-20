import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getWeekSummary } from '../services/smeta';
import BudgetRail from '../components/BudgetRail';

const money = (value, digits = 0) =>
    typeof value === 'number'
        ? `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value)} ₽`
        : '—';

const MEAL_LABELS = {
    breakfast: 'Завтрак',
    lunch: 'Обед',
    dinner: 'Ужин',
    snack: 'Перекус',
};

/**
 * «Моя неделя»: что готовлю, что купил и сколько потратил.
 * Смысл — меню и сметы не теряются после генерации, а ведут человека по неделе.
 */
function DashboardPage() {
    const navigate = useNavigate();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!localStorage.getItem('access_token')) {
            navigate('/login');
            return;
        }
        let cancelled = false;
        setLoading(true);
        getWeekSummary(7)
            .then((result) => {
                if (!cancelled) setData(result);
            })
            .catch((err) => {
                if (!cancelled) setError(err.message || 'Не удалось загрузить сводку');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [navigate]);

    if (loading) {
        return (
            <div className="max-w-3xl mx-auto space-y-3">
                <div className="skeleton h-28" />
                <div className="skeleton h-24" />
                <div className="skeleton h-24" />
            </div>
        );
    }

    if (error && !data) {
        return (
            <div className="max-w-3xl mx-auto card p-6 text-center">
                <p className="text-hot-600 dark:text-hot-400 mb-4">{error}</p>
                <Link to="/" className="btn-primary">На витрину</Link>
            </div>
        );
    }

    if (!data) return null;

    const plan = data.plan;
    const delivery = data.delivery || {};
    const recipesStats = data.recipes || {};
    const hasAnything = plan || (data.baskets || []).length > 0 || data.spent > 0;

    return (
        <div className="max-w-3xl mx-auto animate-fade-in pb-bottom-nav">
            <header className="mb-4">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary-100 dark:bg-primary-900/25 text-primary-700 dark:text-primary-300 text-[11px] font-bold uppercase tracking-wide">
                    📅 моя неделя
                </span>
                <h1 className="heading-1 mt-2">Что готовлю и что купил</h1>
                <p className="text-sm text-ink-500 dark:text-ink-400 mt-1.5">
                    Сводка за последние {data.period_days} дней: план, покупки, траты и экономия.
                </p>
            </header>

            {/* Деньги недели */}
            <section className="card p-3.5 sm:p-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="metric">
                        <span className="metric-value">{money(data.spent)}</span>
                        <span className="metric-label">куплено</span>
                    </div>
                    <div className="metric">
                        <span className="metric-value">{money(data.to_buy)}</span>
                        <span className="metric-label">осталось купить</span>
                    </div>
                    <div className="metric">
                        <span className="metric-value">{money(data.savings)}</span>
                        <span className="metric-label">экономия на сплите</span>
                    </div>
                    <div className="metric">
                        <span className="metric-value">Ур. {data.level?.level ?? 1}</span>
                        <span className="metric-label">{data.level?.points ?? 0} баллов</span>
                    </div>
                </div>
            </section>

            {/* Сравнение с доставкой */}
            {delivery.servings_cooked > 0 && (
                <section className="card p-3.5 sm:p-4 mt-3 border-primary-200 dark:border-primary-500/30">
                    <h2 className="section-title !text-sm">🍕 Домашнее против доставки</h2>
                    <p className="text-sm text-ink-600 dark:text-ink-300 mt-2">
                        Вы закрыли домашней едой <strong>{delivery.servings_cooked} порц.</strong>.
                        По цене доставки ({money(delivery.price_per_serving)} за порцию) это обошлось бы
                        в {money(delivery.delivery_estimate)}, а вы потратили {money(delivery.homemade_spent)}.
                    </p>
                    {delivery.saved > 0 && (
                        <p className="budget-pill budget-ok mt-2">
                            экономия {money(delivery.saved)}
                        </p>
                    )}
                </section>
            )}

            {/* Что готовлю */}
            <section className="card p-3.5 sm:p-4 mt-3">
                <div className="flex items-center justify-between gap-2">
                    <h2 className="section-title !text-sm">🗓 Что готовлю</h2>
                    <Link to="/mealplan" className="text-sm font-bold text-primary-600 dark:text-primary-400">
                        {plan ? 'Пересобрать' : 'Собрать план'}
                    </Link>
                </div>

                {!plan ? (
                    <p className="text-sm text-ink-500 dark:text-ink-400 mt-2">
                        Плана пока нет. Соберите меню на неделю под свой бюджет — блюда и КБЖУ посчитаются сами.
                    </p>
                ) : (
                    <>
                        <p className="text-sm font-semibold text-ink-800 dark:text-ink-100 mt-2">
                            {plan.title}
                        </p>
                        <div className="grid grid-cols-3 gap-3 mt-3">
                            <div className="metric">
                                <span className="metric-value">{money(plan.total_price)}</span>
                                <span className="metric-label">на {plan.days} дн.</span>
                            </div>
                            <div className="metric">
                                <span className="metric-value">{Math.round(plan.kcal_per_day || 0)}</span>
                                <span className="metric-label">ккал/день</span>
                            </div>
                            <div className="metric">
                                <span className="metric-value">{Math.round(plan.protein_per_day || 0)} г</span>
                                <span className="metric-label">белка/день</span>
                            </div>
                        </div>

                        <div className="mt-3 divide-y divide-ink-100 dark:divide-ink-800">
                            {(plan.next_items || []).map((item, index) => (
                                <Link
                                    key={`${item.recipe_id}-${index}`}
                                    to={`/recipe/${item.recipe_id}`}
                                    className="flex items-center gap-3 min-h-[44px] px-1 hover:bg-ink-100 dark:hover:bg-ink-800 rounded-xl transition-colors"
                                >
                                    <span className="text-[11px] font-bold uppercase tracking-wide text-ink-400 w-16 flex-shrink-0">
                                        {MEAL_LABELS[item.meal_type] || item.meal_type}
                                    </span>
                                    <span className="flex-1 min-w-0 text-sm text-ink-800 dark:text-ink-100 truncate">
                                        {item.title || 'Рецепт'}
                                    </span>
                                    <span className="text-[11px] text-ink-400 whitespace-nowrap">
                                        день {item.day_index + 1}
                                    </span>
                                </Link>
                            ))}
                        </div>
                    </>
                )}
            </section>

            {/* Что купил */}
            <section className="card p-3.5 sm:p-4 mt-3">
                <div className="flex items-center justify-between gap-2">
                    <h2 className="section-title !text-sm">🧺 Что купил</h2>
                    <Link to="/my-baskets" className="text-sm font-bold text-primary-600 dark:text-primary-400">
                        Все сметы
                    </Link>
                </div>

                {(data.baskets || []).length === 0 ? (
                    <p className="text-sm text-ink-500 dark:text-ink-400 mt-2">
                        Смет пока нет. Выберите рецепт на витрине — соберём список покупок с ценами.
                    </p>
                ) : (
                    <div className="mt-2 space-y-3">
                        {data.baskets.slice(0, 4).map((basket) => {
                            const percent = basket.items_count
                                ? Math.round((basket.checked_count / basket.items_count) * 100)
                                : 0;
                            return (
                                <div key={basket.id}>
                                    <Link
                                        to={`/basket/${basket.id}`}
                                        className="flex items-center justify-between gap-2 min-h-[36px]"
                                    >
                                        <span className="text-sm font-medium text-ink-800 dark:text-ink-100 truncate">
                                            {basket.title}
                                        </span>
                                        <span className="text-xs text-ink-500 dark:text-ink-400 whitespace-nowrap tabular">
                                            {basket.checked_count}/{basket.items_count} · {money(basket.total_price)}
                                        </span>
                                    </Link>
                                    <div className="ri-bar">
                                        <div className="ri-bar-fill" style={{ width: `${percent}%` }} />
                                    </div>
                                    {basket.remaining > 0 && (
                                        <p className="text-[11px] text-ink-400 dark:text-ink-500 mt-1">
                                            осталось купить на {money(basket.remaining)}
                                        </p>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>

            {/* Мои рецепты */}
            <section className="card p-3.5 sm:p-4 mt-3">
                <h2 className="section-title !text-sm">📝 Мои рецепты</h2>
                <div className="grid grid-cols-3 gap-3 mt-3">
                    <div className="metric">
                        <span className="metric-value">{recipesStats.published ?? 0}</span>
                        <span className="metric-label">опубликовано</span>
                    </div>
                    <div className="metric">
                        <span className="metric-value">{recipesStats.pending ?? 0}</span>
                        <span className="metric-label">на модерации</span>
                    </div>
                    <div className="metric">
                        <span className="metric-value">{recipesStats.avg_ri ?? '—'}</span>
                        <span className="metric-label">средний RI</span>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                    <Link to="/create" className="btn-primary !min-h-[40px] text-sm">＋ Добавить рецепт</Link>
                    <Link to="/my-recipes" className="btn-secondary !min-h-[40px] text-sm">Мои рецепты</Link>
                </div>
            </section>

            {!hasAnything && (
                <section className="card p-6 mt-3 text-center">
                    <div className="text-3xl mb-2">🧾</div>
                    <p className="text-ink-600 dark:text-ink-300 mb-4">
                        Пока пусто. Начните с подбора рецепта под свой бюджет.
                    </p>
                    <Link to="/" className="btn-primary">На витрину</Link>
                </section>
            )}

            <div className="mt-3">
                <BudgetRail budget={Number(localStorage.getItem('recartly_budget')) || 0} total={data.spent} />
            </div>
        </div>
    );
}

export default DashboardPage;
