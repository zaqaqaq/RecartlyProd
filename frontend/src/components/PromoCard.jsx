import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { likePromo, unlikePromo } from '../services/smeta';
import { mediaUrl } from '../utils/media';
import {
    PROMO_STATUS,
    promoAuthor,
    promoDiscount,
    promoEndsLabel,
    promoPrice,
} from '../utils/promo';

/** Квадрат с фото ценника, а без фото — эмодзи магазина. */
function PromoThumb({ promo, className = '' }) {
    const photo = mediaUrl(promo.photo_url);
    if (photo) {
        return (
            <img
                src={photo}
                alt={`Ценник: ${promo.title || ''}`}
                loading="lazy"
                className={`object-cover bg-ink-100 dark:bg-ink-800 ${className}`}
            />
        );
    }
    return (
        <span
            aria-hidden="true"
            className={`flex items-center justify-center bg-ink-100 dark:bg-ink-800 text-2xl ${className}`}
        >
            {promo.shop_emoji || '🏷️'}
        </span>
    );
}

/**
 * Карточка акции от человека: ценник, старая и новая цена, скидка, срок и лайк.
 *
 * Переиспользуется и в ленте города (PromoFeed), и в сетке страницы акций
 * (PromosPage). Лайк оптимистичный: сердечко меняется сразу, а при ошибке
 * состояние откатывается назад.
 */
function PromoCard({ promo, showStatus = false, onDelete = null, deleting = false }) {
    const navigate = useNavigate();
    const isLikedFromProps = !!promo?.is_liked;
    const likesFromProps = Number(promo?.likes_count) || 0;
    const [isLiked, setIsLiked] = useState(isLikedFromProps);
    const [likesCount, setLikesCount] = useState(likesFromProps);
    const [liking, setLiking] = useState(false);

    // Родитель перезагрузил список — принимаем его версию лайка
    useEffect(() => {
        setIsLiked(isLikedFromProps);
        setLikesCount(likesFromProps);
    }, [promo?.id, isLikedFromProps, likesFromProps]);

    const discount = promoDiscount(promo);
    const ends = promoEndsLabel(promo?.ends_at);
    const status = PROMO_STATUS[promo?.status];

    const handleLike = async () => {
        if (!promo?.id) return;
        if (!localStorage.getItem('access_token')) {
            navigate('/login');
            return;
        }
        if (liking) return;

        const nextLiked = !isLiked;
        setLiking(true);
        setIsLiked(nextLiked);
        setLikesCount((prev) => Math.max(0, prev + (nextLiked ? 1 : -1)));
        try {
            const fresh = nextLiked ? await likePromo(promo.id) : await unlikePromo(promo.id);
            if (fresh) {
                setIsLiked(!!fresh.is_liked);
                setLikesCount(Number(fresh.likes_count) || 0);
            }
        } catch (err) {
            setIsLiked(!nextLiked);
            setLikesCount((prev) => Math.max(0, prev + (nextLiked ? -1 : 1)));
            console.error(err);
        } finally {
            setLiking(false);
        }
    };

    /* h-full — карточка заполняет высоту ряда сетки (PromosPage) и одинаково
       выглядит в списке ленты (PromoFeed): внутри всё выровнено по блокам. */
    return (
        <article className="card card-hover p-3 sm:p-3.5 flex gap-3 h-full">
            {/* Медиа — квадрат фиксированного размера, поэтому не влияет на высоту */}
            <Link
                to={`/promos/${promo.id}`}
                className="flex-shrink-0 rounded-2xl overflow-hidden w-16 h-16 sm:w-[72px] sm:h-[72px] border border-ink-200 dark:border-ink-800"
                aria-label={`Открыть акцию ${promo.title || ''}`}
            >
                <PromoThumb
                    promo={promo}
                    className="w-16 h-16 sm:w-[72px] sm:h-[72px] text-xl"
                />
            </Link>

            <div className="flex-1 min-w-0 flex flex-col">
                {/* 1. Заголовок: ровно 2 строки по высоте (leading-[1.3] × 2 = 2.6em);
                    плашка скидки стоит рядом и на высоту не влияет. */}
                <div className="flex items-start gap-2">
                    <h3 className="flex-1 min-w-0 font-display font-extrabold text-sm sm:text-base leading-[1.3] text-ink-900 dark:text-white line-clamp-2 min-h-[2.6em]">
                        <Link to={`/promos/${promo.id}`} className="hover:underline">
                            {promo.title || 'Акция'}
                        </Link>
                    </h3>

                    {discount != null && (
                        <span className="budget-pill budget-ok flex-shrink-0">−{discount} %</span>
                    )}
                </div>

                {/* 2. Метки магазина: чипы переносятся (магазин + проверка + статус
                    модерации), поэтому под блок зарезервированы ровно две строки
                    (24 + 6 + 24 = 54px). */}
                <div className="mt-1.5 min-h-[54px] flex flex-wrap content-center items-center gap-1.5">
                    <span className="tag">
                        {promo.shop_emoji ? `${promo.shop_emoji} ` : ''}
                        {promo.shop_name || 'магазин'}
                    </span>
                    {promo.is_verified && <span className="tag">✔ проверено</span>}
                    {showStatus && status && (
                        <span className={`budget-pill ${status.className}`}>
                            {status.label}
                            {promo.status === 'rejected' && promo.reject_reason
                                ? `: ${promo.reject_reason}`
                                : ''}
                        </span>
                    )}
                </div>

                {/* 3. Цены — одна строка фиксированной высоты (цена идёт
                    leading-none, min-h задаёт строке 32px). */}
                <div className="mt-1.5 min-h-[32px] flex flex-nowrap items-center gap-2 overflow-hidden">
                    {promo.old_price != null && (
                        <span className="text-sm text-ink-400 dark:text-ink-500 line-through flex-shrink-0">
                            {promoPrice(promo.old_price)}
                        </span>
                    )}
                    <span className="price price-lg flex-shrink-0">{promoPrice(promo.new_price)}</span>
                    {promo.unit && (
                        <span className="text-[11px] text-ink-500 dark:text-ink-400 truncate">
                            за {promo.unit}
                        </span>
                    )}
                </div>

                {/* 4. Срок, автор и просмотры — одна строка фиксированной высоты */}
                <div className="mt-1.5 min-h-[20px] flex flex-nowrap items-center gap-x-2.5 overflow-hidden text-[11px] text-ink-400 dark:text-ink-500">
                    {ends && (
                        <span
                            className={`flex-shrink-0 ${
                                ends === 'истекает сегодня'
                                    ? 'font-bold text-hot-600 dark:text-hot-400'
                                    : ''
                            }`}
                        >
                            ⏳ {ends}
                        </span>
                    )}
                    {promoAuthor(promo) && <span className="truncate">{promoAuthor(promo)}</span>}
                    <span className="flex-shrink-0">👁 {Number(promo.views_count) || 0}</span>
                </div>

                {/* 5. Футер прижат к низу (mt-auto): лайк и кнопки всегда на одной
                    высоте, тач-таргеты ≥ 44px. */}
                <div className="mt-auto pt-3 flex items-center gap-1.5 border-t border-ink-100 dark:border-ink-800">
                    <button
                        type="button"
                        onClick={handleLike}
                        aria-pressed={isLiked}
                        aria-label={isLiked ? 'Убрать лайк' : 'Поставить лайк'}
                        className={`inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-xl text-sm font-bold transition-colors
                        ${
                            isLiked
                                ? 'text-hot-600 dark:text-hot-400 bg-hot-50 dark:bg-hot-500/10'
                                : 'text-ink-500 dark:text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800'
                        }`}
                    >
                        <span aria-hidden="true">{isLiked ? '❤️' : '🤍'}</span>
                        {likesCount}
                    </button>

                    <Link
                        to={`/promos/${promo.id}`}
                        className="btn-secondary !min-h-[44px] !px-3.5 text-sm ml-auto"
                    >
                        Открыть
                    </Link>

                    {onDelete && (
                        <button
                            type="button"
                            onClick={() => onDelete(promo)}
                            disabled={deleting}
                            aria-label="Удалить акцию"
                            className="btn-ghost !min-h-[44px] text-hot-600 dark:text-hot-400"
                        >
                            {deleting ? '…' : '🗑'}
                        </button>
                    )}
                </div>
            </div>
        </article>
    );
}

export default PromoCard;
