import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getBasket } from '../services/smeta';
import { formatCount, formatMoney, pluralRu, pricesFreshnessMeta } from './BasketCard';

/* ============================================================
   Блок на странице блюда: «Набор для этого блюда».

   Цены блюда больше нет — цена есть только у набора продуктов.
   Поэтому вместо сметы со сплитом по магазинам блок показывает набор,
   из которого готовится блюдо, либо зовёт собрать набор из рецепта.
   ============================================================ */

/**
 * Props:
 *  - recipeId — id рецепта (для призыва «Собрать набор из этого рецепта»);
 *  - basketId — `basket_id` рецепта из ответа `/recipes/{id}` (может быть null).
 */
function RecipeCostBlock({ recipeId, basketId = null }) {
    const [basket, setBasket] = useState(null);
    const [loading, setLoading] = useState(Boolean(basketId));
    const [error, setError] = useState('');

    useEffect(() => {
        if (!basketId) {
            setBasket(null);
            setLoading(false);
            setError('');
            return undefined;
        }

        let cancelled = false;
        setLoading(true);
        setError('');
        // Карточка набора уже существует — берём цену, дату и метку свежести оттуда
        getBasket(basketId)
            .then((data) => {
                if (!cancelled) setBasket(data);
            })
            .catch((err) => {
                if (!cancelled) setError(err.message || 'Не удалось открыть набор');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [basketId]);

    const fresh = pricesFreshnessMeta(basket?.prices_freshness, basket?.prices_date);
    const servings = Number(basket?.servings) || 0;
    const itemsCount = Number(basket?.items_count) || (basket?.items ? basket.items.length : 0);

    return (
        <section className="card p-3.5 sm:p-5">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h2 className="section-title">🧺 Набор для этого блюда</h2>
                    <p className="text-xs text-ink-500 dark:text-ink-400 mt-1">
                        Цена — у набора продуктов, а не у блюда: по набору видно, сколько стоит
                        ужин и когда собирали цены.
                    </p>
                </div>
            </div>

            {basketId ? (
                <>
                    {loading && (
                        <div className="mt-4 space-y-2">
                            <div className="skeleton h-4 w-2/3" />
                            <div className="skeleton h-16" />
                        </div>
                    )}

                    {!loading && basket && (
                        <div className="mt-4 rounded-2xl border border-primary-200 dark:border-primary-900/50 bg-primary-50/60 dark:bg-primary-500/10 p-3.5">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="font-display font-bold text-ink-900 dark:text-white break-words">
                                        {basket.title || 'Набор продуктов'}
                                    </p>
                                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                        <span className={fresh.className} title={fresh.title}>
                                            {fresh.label}
                                        </span>
                                        {servings > 0 && (
                                            <span className="tag">
                                                на {formatCount(servings)}{' '}
                                                {pluralRu(servings, 'человека', 'человека', 'человек')}
                                            </span>
                                        )}
                                        <span className="tag">
                                            {formatCount(itemsCount)}{' '}
                                            {pluralRu(itemsCount, 'позиция', 'позиции', 'позиций')}
                                        </span>
                                    </div>
                                </div>

                                <span className="price price-lg whitespace-nowrap">
                                    {formatMoney(basket.total_price)}
                                    <span className="text-base"> ₽</span>
                                </span>
                            </div>

                            <Link to={`/basket/${basket.id}`} className="btn-primary btn-block mt-3">
                                Открыть набор
                            </Link>
                        </div>
                    )}

                    {!loading && !basket && (
                        <div className="mt-4 rounded-2xl border border-ink-200 dark:border-ink-800 p-3.5">
                            <p className="text-sm text-ink-600 dark:text-ink-300">
                                {error || 'Набор не удалось открыть.'}
                            </p>
                            <Link to={`/basket/${basketId}`} className="btn-secondary btn-block mt-3">
                                Открыть набор
                            </Link>
                        </div>
                    )}
                </>
            ) : (
                <div className="mt-4 rounded-2xl border border-dashed border-ink-300 dark:border-ink-700 p-4 text-center">
                    <p className="text-sm text-ink-600 dark:text-ink-300">
                        У этого блюда пока нет набора, поэтому и цены у него нет. Соберите набор — и
                        он покажет стоимость продуктов, магазины и дату покупки.
                    </p>
                    <Link
                        to={`/create-basket?recipe_id=${recipeId}`}
                        className="btn-primary btn-block mt-3"
                    >
                        🧺 Собрать набор из этого рецепта
                    </Link>
                </div>
            )}
        </section>
    );
}

export default RecipeCostBlock;
