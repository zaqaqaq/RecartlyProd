import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getPromos } from '../services/smeta';
import PromoCard from './PromoCard';
import PromoForm from './PromoForm';

/**
 * «Акции в вашем городе» — лента акций от людей с входом в создание акции.
 *
 * Данные идут из `/promos/` (только `status='published'` и не истёкшие),
 * сортировка по популярности. После создания акции лента перечитывается
 * по событию `promosChange`.
 */
function PromoFeed({ cityId = null, cityName = '', limit = 5, className = '' }) {
    const navigate = useNavigate();
    const [data, setData] = useState({ total: 0, items: [] });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [sheetOpen, setSheetOpen] = useState(false);

    const load = useCallback(() => {
        let cancelled = false;
        setLoading(true);
        setError('');
        getPromos({ city_id: cityId, sort: 'hot', limit })
            .then((result) => {
                if (cancelled) return;
                setData({
                    total: Number(result?.total) || 0,
                    items: result?.items || [],
                });
            })
            .catch((err) => {
                if (!cancelled) {
                    setData({ total: 0, items: [] });
                    setError(err.message || 'Не удалось загрузить акции');
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [cityId, limit]);

    useEffect(() => load(), [load]);

    // Новая акция (своя или чужая) — лента перечитывается
    useEffect(() => {
        const onChange = () => load();
        window.addEventListener('promosChange', onChange);
        return () => window.removeEventListener('promosChange', onChange);
    }, [load]);

    const handleShare = () => {
        if (!localStorage.getItem('access_token')) {
            navigate('/login');
            return;
        }
        setSheetOpen(true);
    };

    const items = data.items;

    return (
        <section className={`card p-3.5 sm:p-4 ${className}`}>
            <header className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h2 className="section-title !text-sm">🏷️ Акции в вашем городе</h2>
                    <p className="text-[11px] text-ink-500 dark:text-ink-400 mt-1">
                        {cityName ? `${cityName} · ` : ''}
                        Цены приносят люди, публикуем после проверки
                    </p>
                </div>

                <button
                    type="button"
                    onClick={handleShare}
                    className="btn-primary px-3.5 text-sm flex-shrink-0"
                >
                    ＋ Поделиться акцией
                </button>
            </header>

            {loading ? (
                <div className="mt-3 space-y-2">
                    <div className="skeleton h-[104px]" />
                    <div className="skeleton h-[104px]" />
                </div>
            ) : error ? (
                <p className="text-sm text-ink-500 dark:text-ink-400 mt-3">{error}</p>
            ) : items.length === 0 ? (
                <div className="mt-3 text-center py-4">
                    <div className="text-3xl mb-1.5">🏷️</div>
                    <p className="text-sm font-semibold text-ink-700 dark:text-ink-200">
                        Пока акций нет — поделитесь первой
                    </p>
                    <p className="text-[11px] text-ink-400 dark:text-ink-500 mt-1 mb-3">
                        Сфотографировали ценник со скидкой? Расскажите — это займёт минуту.
                    </p>
                    <button type="button" onClick={handleShare} className="btn-primary">
                        ＋ Поделиться акцией
                    </button>
                </div>
            ) : (
                <>
                    <div className="mt-3 space-y-2.5">
                        {items.map((promo) => (
                            <PromoCard key={promo.id} promo={promo} />
                        ))}
                    </div>

                    <button
                        type="button"
                        onClick={() => navigate('/promos')}
                        className="btn-secondary btn-block mt-3"
                    >
                        Все акции города{data.total > items.length ? ` (${data.total})` : ''}
                    </button>
                </>
            )}

            <PromoForm
                open={sheetOpen}
                onClose={() => setSheetOpen(false)}
                cityId={cityId}
            />
        </section>
    );
}

export default PromoFeed;
