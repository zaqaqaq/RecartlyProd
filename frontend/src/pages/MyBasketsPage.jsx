import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { deleteBasket, getMyBaskets, shareBasket } from '../services/smeta';
import { mediaUrl } from '../utils/media';
import { formatCount, formatMoney, pluralRu, pricesFreshnessMeta } from '../components/BasketCard';

/* ============================================================
   «Мои наборы»: свои корзины продуктов с ценами и датой покупки.
   Отсюда набор открывают, делятся ссылкой для семьи и удаляют.
   ============================================================ */

/**
 * Скелетон строки набора — повторяет разметку карточки: миниатюра 64×64,
 * заголовок с ценой, ряд тегов и футер с кнопками. Высоты те же, поэтому
 * список не «прыгает» при загрузке.
 */
function BasketRowSkeleton() {
    return (
        <article className="card p-3.5" aria-hidden="true">
            <div className="flex items-start gap-3">
                <div className="skeleton w-16 h-16 rounded-2xl flex-shrink-0" />
                <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3">
                        <div className="skeleton min-h-[2.6em] flex-1" />
                        <div className="skeleton min-h-[28px] w-20 flex-shrink-0" />
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <div className="skeleton min-h-[28px] w-24" />
                        <div className="skeleton min-h-[28px] w-20" />
                        <div className="skeleton min-h-[28px] w-16" />
                    </div>
                </div>
            </div>
            <div className="mt-3 pt-2.5 border-t border-ink-100 dark:border-ink-800 flex flex-wrap items-center gap-2">
                <div className="skeleton min-h-[44px] w-full sm:w-24" />
                <div className="skeleton min-h-[44px] w-full sm:w-32" />
                <div className="skeleton min-h-[44px] w-full sm:w-24 sm:ml-auto" />
            </div>
        </article>
    );
}

function MyBasketsPage() {
    const navigate = useNavigate();
    const [baskets, setBaskets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [sharingId, setSharingId] = useState(null);
    const [deletingId, setDeletingId] = useState(null);
    const [shareLinks, setShareLinks] = useState({});
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        if (!localStorage.getItem('access_token')) {
            navigate('/login', { replace: true });
            return undefined;
        }

        let cancelled = false;
        setLoading(true);
        setError('');
        getMyBaskets()
            .then((list) => {
                if (!cancelled) setBaskets(Array.isArray(list) ? list : []);
            })
            .catch((err) => {
                if (cancelled) return;
                const message = String(err.message || '');
                if (message.includes('401') || /not authenticated/i.test(message)) {
                    navigate('/login', { replace: true });
                    return;
                }
                setError(message || 'Не удалось загрузить наборы');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [navigate, reloadKey]);

    useEffect(() => {
        if (!notice) return undefined;
        const timer = setTimeout(() => setNotice(''), 4000);
        return () => clearTimeout(timer);
    }, [notice]);

    const handleShare = async (basket) => {
        setSharingId(basket.id);
        setError('');
        try {
            const updated = await shareBasket(basket.id, true);
            setBaskets((prev) => prev.map((row) => (row.id === basket.id ? updated : row)));
            const url = `${window.location.origin}/basket/shared/${updated.share_token}`;
            setShareLinks((prev) => ({ ...prev, [basket.id]: url }));
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(url).catch(() => undefined);
            }
            setNotice('Ссылка на набор скопирована — отправьте её тому, кто идёт в магазин');
        } catch (err) {
            setError(err.message || 'Не удалось поделиться набором');
        } finally {
            setSharingId(null);
        }
    };

    const handleDelete = async (basket) => {
        if (!window.confirm(`Удалить набор «${basket.title}»? Действие необратимо.`)) return;

        setDeletingId(basket.id);
        setError('');
        try {
            await deleteBasket(basket.id);
            setBaskets((prev) => prev.filter((row) => row.id !== basket.id));
            setNotice('Набор удалён');
        } catch (err) {
            setError(err.message || 'Не удалось удалить набор');
        } finally {
            setDeletingId(null);
        }
    };

    return (
        <div className="max-w-3xl mx-auto animate-fade-in pb-bottom-nav">
            <header className="mb-4">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 mb-2 rounded-full bg-primary-100 dark:bg-primary-900/25 text-primary-700 dark:text-primary-300 text-[11px] font-bold uppercase tracking-wide">
                    🧺 мои наборы
                </span>
                <h1 className="heading-1">Мои наборы</h1>
                <p className="text-sm text-ink-500 dark:text-ink-400 mt-1.5">
                    Продукты с ценами и датой покупки: из наборов готовятся блюда, а цену носит
                    именно набор.
                </p>

                <Link to="/create-basket" className="btn-primary btn-block sm:w-auto sm:inline-flex mt-3">
                    ➕ Создать набор
                </Link>
            </header>

            {notice && (
                <p className="mb-3 rounded-2xl bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300 text-sm font-semibold px-3.5 py-2.5">
                    {notice}
                </p>
            )}

            {/* Ошибка: единая плашка с иконкой, пояснением и «Повторить» */}
            {error && (
                <div className="card p-6 mb-3 text-center border-hot-500/40">
                    <div className="w-14 h-14 mx-auto rounded-3xl bg-hot-50 dark:bg-hot-500/15 flex items-center justify-center text-2xl mb-3">
                        ⚠️
                    </div>
                    <p className="text-sm font-semibold text-ink-700 dark:text-ink-200">
                        Не удалось выполнить действие
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

            {/* Список: min-h держит высоту страницы, пока идёт загрузка */}
            <div className="min-h-[60vh] space-y-3">
                {loading ? (
                    <>
                        <BasketRowSkeleton />
                        <BasketRowSkeleton />
                        <BasketRowSkeleton />
                    </>
                ) : baskets.length === 0 ? (
                    <div className="card p-6 text-center">
                        <div className="w-14 h-14 mx-auto rounded-3xl bg-primary-100 dark:bg-primary-900/25 flex items-center justify-center text-2xl mb-3">
                            🧺
                        </div>
                        <p className="text-sm font-semibold text-ink-700 dark:text-ink-200">
                            У вас пока нет наборов
                        </p>
                        <p className="text-[11px] text-ink-400 dark:text-ink-500 mt-1 mb-4">
                            Соберите продукты с ценами — из набора посчитаем блюда и стоимость порции.
                        </p>
                        <Link to="/create-basket" className="btn-primary btn-block sm:w-auto sm:inline-flex">
                            Создать набор
                        </Link>
                    </div>
                ) : (
                    baskets.map((basket) => {
                        const fresh = pricesFreshnessMeta(basket.prices_freshness, basket.prices_date);
                        const servings = Number(basket.servings) || 0;
                        const itemsCount = Number(basket.items_count) || 0;
                        const photo = basket.photo_url ? mediaUrl(basket.photo_url) : null;

                        return (
                            <article key={basket.id} className="card card-hover p-3.5">
                                <div className="flex items-start gap-3">
                                    <Link
                                        to={`/basket/${basket.id}`}
                                        className="w-16 h-16 flex-shrink-0 rounded-2xl overflow-hidden bg-ink-100 dark:bg-ink-800 flex items-center justify-center text-2xl"
                                        aria-label={`Открыть набор ${basket.title}`}
                                    >
                                        {photo ? (
                                            <img src={photo} alt="" className="w-full h-full object-cover" />
                                        ) : (
                                            <span aria-hidden="true">🧺</span>
                                        )}
                                    </Link>

                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-start justify-between gap-3">
                                            <h2 className="font-display font-bold text-base text-ink-900 dark:text-white line-clamp-2 break-words min-w-0">
                                                <Link to={`/basket/${basket.id}`} className="hover:underline">
                                                    {basket.title}
                                                </Link>
                                            </h2>
                                            <span className="price text-lg whitespace-nowrap flex-shrink-0">
                                                {formatMoney(basket.total_price)}
                                                <span className="text-xs"> ₽</span>
                                            </span>
                                        </div>

                                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                            <span className={fresh.className} title={fresh.title}>
                                                {fresh.label}
                                            </span>
                                            <span className="tag">
                                                {formatCount(itemsCount)}{' '}
                                                {pluralRu(itemsCount, 'позиция', 'позиции', 'позиций')}
                                            </span>
                                            {servings > 0 && (
                                                <span className="tag">
                                                    на {formatCount(servings)}{' '}
                                                    {pluralRu(servings, 'человека', 'человека', 'человек')}
                                                </span>
                                            )}
                                            {basket.is_public ? (
                                                <span className="tag">🌍 публичный</span>
                                            ) : (
                                                <span className="tag">🔒 приватный</span>
                                            )}
                                            {basket.status && basket.status !== 'published' && (
                                                <span className="tag">⏳ на модерации</span>
                                            )}
                                        </div>

                                        {shareLinks[basket.id] && (
                                            <p className="mt-2 text-xs text-ink-500 dark:text-ink-400 break-all">
                                                Ссылка для семьи:{' '}
                                                <a
                                                    href={shareLinks[basket.id]}
                                                    className="font-semibold text-primary-600 dark:text-primary-400 hover:underline"
                                                >
                                                    {shareLinks[basket.id]}
                                                </a>
                                            </p>
                                        )}
                                    </div>
                                </div>

                                <div className="mt-3 pt-2.5 border-t border-ink-100 dark:border-ink-800 flex flex-wrap items-center gap-2">
                                    <Link
                                        to={`/basket/${basket.id}`}
                                        className="btn-primary btn-block sm:w-auto sm:inline-flex !min-h-[44px] !px-4 text-sm"
                                    >
                                        Открыть
                                    </Link>
                                    <button
                                        type="button"
                                        onClick={() => handleShare(basket)}
                                        disabled={sharingId === basket.id}
                                        className="btn-secondary btn-block sm:w-auto sm:inline-flex !min-h-[44px] !px-4 text-sm"
                                    >
                                        {sharingId === basket.id ? 'Готовим…' : '🔗 Поделиться'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleDelete(basket)}
                                        disabled={deletingId === basket.id}
                                        aria-label={`Удалить набор ${basket.title}`}
                                        className="inline-flex items-center justify-center gap-1.5 w-full sm:w-auto sm:ml-auto min-h-[44px] px-4 rounded-2xl text-sm font-semibold text-hot-600 dark:text-hot-400 hover:bg-hot-50 dark:hover:bg-hot-500/10 transition-colors disabled:opacity-50"
                                    >
                                        {deletingId === basket.id ? 'Удаляем…' : '🗑 Удалить'}
                                    </button>
                                </div>
                            </article>
                        );
                    })
                )}
            </div>
        </div>
    );
}

export default MyBasketsPage;
