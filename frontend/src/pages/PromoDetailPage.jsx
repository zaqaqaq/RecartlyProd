import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
    deletePromo,
    getAffiliateLink,
    getPromo,
    likePromo,
    unlikePromo,
} from '../services/smeta';
import { mediaUrl } from '../utils/media';
import ReportButton from '../components/ReportButton';

const money = (value, digits = 2) =>
    typeof value === 'number'
        ? `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value)} ₽`
        : '—';

function formatEnds(value) {
    if (!value) return null;
    const end = new Date(value);
    const now = new Date();
    const diffDays = Math.ceil((end - now) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return 'Акция закончилась';
    if (diffDays === 0) return 'Истекает сегодня';
    if (diffDays === 1) return 'Истекает завтра';
    return `До ${end.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`;
}

/** Страница акции: ценник, скидка, срок, переход в магазин и жалоба. */
function PromoDetailPage() {
    const { id } = useParams();
    const navigate = useNavigate();

    const [promo, setPromo] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [imgError, setImgError] = useState(false);
    const [linkLoading, setLinkLoading] = useState(false);

    const isAuthenticated = !!localStorage.getItem('access_token');

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        getPromo(id)
            .then((data) => {
                if (!cancelled) setPromo(data);
            })
            .catch((err) => {
                if (!cancelled) setError(err.message || 'Акция не найдена');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [id]);

    const handleLike = async () => {
        if (!isAuthenticated) {
            navigate('/login');
            return;
        }
        const wasLiked = promo.is_liked;
        // Оптимистично, с откатом при ошибке
        setPromo((prev) => ({
            ...prev,
            is_liked: !wasLiked,
            likes_count: (prev.likes_count || 0) + (wasLiked ? -1 : 1),
        }));
        try {
            const updated = wasLiked ? await unlikePromo(promo.id) : await likePromo(promo.id);
            setPromo(updated);
        } catch (err) {
            setPromo((prev) => ({
                ...prev,
                is_liked: wasLiked,
                likes_count: (prev.likes_count || 0) + (wasLiked ? 1 : -1),
            }));
        }
    };

    const handleDelete = async () => {
        if (!window.confirm('Удалить акцию?')) return;
        try {
            await deletePromo(promo.id);
            window.dispatchEvent(new Event('promosChange'));
            navigate('/promos');
        } catch (err) {
            setError(err.message || 'Не удалось удалить акцию');
        }
    };

    const handleGoToShop = async () => {
        if (!promo.shop_id) return;
        setLinkLoading(true);
        try {
            const link = await getAffiliateLink(promo.shop_id, promo.product_name || promo.title);
            window.open(link.url, '_blank', 'noopener,noreferrer');
        } catch (err) {
            console.error(err);
        } finally {
            setLinkLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="max-w-2xl mx-auto space-y-3">
                <div className="skeleton h-56" />
                <div className="skeleton h-24" />
            </div>
        );
    }

    if (error || !promo) {
        return (
            <div className="max-w-2xl mx-auto card p-6 text-center animate-fade-in">
                <div className="text-4xl mb-2">🏷️</div>
                <p className="text-ink-600 dark:text-ink-300 mb-4">
                    {error || 'Акция не найдена'}
                </p>
                <Link to="/promos" className="btn-primary">Все акции</Link>
            </div>
        );
    }

    const isOwner = String(promo.author_id) === localStorage.getItem('user_id');
    const ends = formatEnds(promo.ends_at);
    const photo = promo.photo_url && !imgError ? mediaUrl(promo.photo_url) : null;

    return (
        <div className="max-w-2xl mx-auto animate-fade-in pb-bottom-nav">
            <nav className="text-xs text-ink-500 dark:text-ink-400 mb-2">
                <Link to="/promos" className="hover:text-primary-600">Акции</Link>
                <span className="mx-1">/</span>
                <span className="truncate">{promo.shop_name || 'магазин'}</span>
            </nav>

            <article className="card overflow-hidden">
                <div className="relative bg-ink-100 dark:bg-ink-800">
                    {photo ? (
                        <img
                            src={photo}
                            alt={promo.title}
                            className="w-full max-h-80 object-contain"
                            onError={() => setImgError(true)}
                        />
                    ) : (
                        <div className="h-40 flex items-center justify-center text-5xl text-ink-300 dark:text-ink-600">
                            {promo.shop_emoji || '🏷️'}
                        </div>
                    )}

                    {promo.discount_percent ? (
                        <span className="absolute top-3 left-3 budget-pill budget-ok !text-sm shadow-sm">
                            −{promo.discount_percent} %
                        </span>
                    ) : null}

                    {promo.is_verified ? (
                        <span className="absolute top-3 right-3 inline-flex items-center rounded-full bg-white/90 dark:bg-ink-900/90 px-2.5 py-1 text-[11px] font-bold text-primary-700 dark:text-primary-300">
                            ✅ проверено
                        </span>
                    ) : null}
                </div>

                <div className="p-3.5 sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <h1 className="heading-2 break-words">{promo.title}</h1>
                            <div className="flex flex-wrap items-center gap-2 mt-2">
                                <span className="tag">
                                    {promo.shop_emoji} {promo.shop_name || 'Магазин'}
                                </span>
                                {promo.city_name && <span className="tag">📍 {promo.city_name}</span>}
                                {promo.product_name && <span className="tag">{promo.product_name}</span>}
                            </div>
                        </div>
                    </div>

                    <div className="flex items-end gap-3 mt-4">
                        <span className="price price-lg">{money(promo.new_price)}</span>
                        {promo.old_price ? (
                            <span className="text-lg text-ink-400 dark:text-ink-500 line-through tabular">
                                {money(promo.old_price)}
                            </span>
                        ) : null}
                        {promo.unit ? (
                            <span className="text-sm text-ink-500 dark:text-ink-400">/ {promo.unit}</span>
                        ) : null}
                    </div>

                    {promo.old_price ? (
                        <p className="text-sm font-semibold text-primary-600 dark:text-primary-400 mt-1">
                            Экономия {money(promo.old_price - promo.new_price)}
                        </p>
                    ) : null}

                    {ends && (
                        <p className={`text-sm mt-2 font-semibold ${ends.includes('сегодня') ? 'text-hot-600 dark:text-hot-400' : 'text-ink-500 dark:text-ink-400'}`}>
                            ⏳ {ends}
                        </p>
                    )}

                    {promo.description && (
                        <p className="text-ink-600 dark:text-ink-300 mt-3 whitespace-pre-wrap">
                            {promo.description}
                        </p>
                    )}

                    <div className="flex items-center justify-between gap-3 mt-4 pt-4 border-t border-ink-100 dark:border-ink-800">
                        <div className="flex items-center gap-2 min-w-0">
                            <span className="avatar w-8 h-8 text-xs">
                                {promo.author_username?.[0]?.toUpperCase() || '?'}
                            </span>
                            <span className="text-sm text-ink-600 dark:text-ink-400 truncate">
                                {promo.author_username || 'Пользователь'}
                            </span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-ink-400 dark:text-ink-500">
                            <span>👁 {promo.views_count}</span>
                            <button
                                type="button"
                                onClick={handleLike}
                                aria-label={promo.is_liked ? 'Убрать лайк' : 'Поставить лайк'}
                                className={`inline-flex items-center gap-1.5 min-h-[36px] px-2.5 rounded-xl text-sm font-semibold transition-colors ${
                                    promo.is_liked
                                        ? 'text-hot-600 bg-hot-50 dark:bg-hot-600/10'
                                        : 'text-ink-500 dark:text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800'
                                }`}
                            >
                                <span>{promo.is_liked ? '❤️' : '🤍'}</span>
                                <span className="tabular-nums">{promo.likes_count}</span>
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-4">
                        <button
                            type="button"
                            onClick={handleGoToShop}
                            disabled={!promo.shop_id || linkLoading}
                            className="btn-primary"
                        >
                            {linkLoading ? 'Открываем…' : '🛒 Перейти в магазин'}
                        </button>
                        {isOwner ? (
                            <button type="button" onClick={handleDelete} className="btn-danger">
                                🗑 Удалить акцию
                            </button>
                        ) : (
                            <ReportButton
                                targetType="promo"
                                targetId={promo.id}
                                className="btn-secondary btn-block"
                            />
                        )}
                    </div>

                    <p className="text-[11px] text-ink-400 dark:text-ink-500 mt-3">
                        Акцию добавил пользователь, публикуется после проверки модератором.
                        Переход в магазин может быть партнёрским — на подбор это не влияет.
                    </p>

                    {error && <p className="text-sm text-hot-600 dark:text-hot-400 mt-2">{error}</p>}
                </div>
            </article>
        </div>
    );
}

export default PromoDetailPage;
