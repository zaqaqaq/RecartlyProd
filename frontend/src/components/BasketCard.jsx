import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { likeBasket, unlikeBasket } from '../services/smeta';
import { mediaUrl } from '../utils/media';

/* ============================================================
   Карточка набора — основная единица бюджетного подбора.
   Набор = корзина продуктов с ценой и датой цен; из него готовятся блюда.

   Файл также экспортирует общие помощники (деньги, дата цен, метка свежести,
   русские склонения) — их переиспользует DishCard, чтобы метка свежести
   выглядела одинаково во всём бюджетном разделе.
   ============================================================ */

const MONEY_FORMATTER = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const COUNT_FORMATTER = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

/** Сумма по-русски: 126,87 → «126,87». Валюту добавляет вызывающий код. */
export function formatMoney(value) {
    if (value === null || value === undefined || value === '') return '—';
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '—';
    return MONEY_FORMATTER.format(numeric);
}

/** Целое число по-русски — для счётчиков (позиции, блюда, лайки). */
export function formatCount(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '0';
    return COUNT_FORMATTER.format(Math.round(numeric));
}

/** Русские склонения: 1 позиция / 2 позиции / 5 позиций. */
export function pluralRu(count, one, few, many) {
    const n = Math.abs(Number(count) || 0);
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
}

/** «12 сентября» из ISO-даты цен. Пустая строка, если даты нет или она битая. */
export function formatPricesDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

/* Нейтральная (серая) плашка — для «recent» и «unknown» */
const NEUTRAL_PILL = 'budget-pill bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300';

/**
 * Метка свежести цен. Цены либо свежие, либо с датой, либо устарели —
 * расплывчатых формулировок избегаем.
 *
 * fresh   → «цены свежие» (изумруд)
 * recent  → «цены от 12 сентября» (серый)
 * stale   → «цены устарели» (янтарь)
 * unknown → «дата цен не указана»
 */
export function pricesFreshnessMeta(freshness, pricesDate) {
    const dateLabel = formatPricesDate(pricesDate);
    const title = pricesDate ? `Цены собраны ${dateLabel || ''}`.trim() : undefined;

    if (freshness === 'fresh') {
        return { tone: 'fresh', label: 'цены свежие', className: 'budget-pill budget-ok', title };
    }
    if (freshness === 'recent') {
        return {
            tone: 'recent',
            label: dateLabel ? `цены от ${dateLabel}` : 'цены обновляли в этом месяце',
            className: NEUTRAL_PILL,
            title,
        };
    }
    if (freshness === 'stale') {
        return { tone: 'stale', label: 'цены устарели', className: 'budget-pill budget-warn', title };
    }
    return { tone: 'unknown', label: 'дата цен не указана', className: NEUTRAL_PILL, title };
}

/** Аватар автора набора; при ошибке загрузки — буква-заглушка. */
function AuthorAvatar({ username, avatarUrl }) {
    const [broken, setBroken] = useState(false);
    const src = mediaUrl(avatarUrl);
    const initial = username ? username[0].toUpperCase() : '?';

    useEffect(() => {
        setBroken(false);
    }, [avatarUrl]);

    if (!src || broken) {
        return (
            <span className="avatar w-8 h-8 text-xs" aria-hidden="true">
                {initial}
            </span>
        );
    }

    return (
        <img
            src={src}
            alt=""
            loading="lazy"
            className="avatar w-8 h-8 object-cover"
            onError={() => setBroken(true)}
        />
    );
}

/**
 * Карточка набора: фото (или заголовок-заглушка), автор, крупная цена,
 * метка свежести цен, состав и число блюд, лайк и переход в набор.
 *
 * Props:
 *  - basket  — объект Basket из `getBasketFeed` ({id, title, total_price, servings,
 *              prices_date, prices_freshness, photo_url, likes_count, is_liked,
 *              username, avatar_url, items_count, recipes_count, ...})
 *  - budget  — бюджет пользователя (число) или null; нужен только для метки перебора
 */
function BasketCard({ basket, budget = null, guestMode = false }) {
    const navigate = useNavigate();
    const [photoBroken, setPhotoBroken] = useState(false);
    const [liking, setLiking] = useState(false);

    // Гость не может открыть набор: ведём его на регистрацию
    const target = guestMode ? '/register' : `/basket/${basket.id}`;

    const isLikedFromProps = !!basket?.is_liked;
    const likesFromProps = Number(basket?.likes_count) || 0;
    const [isLiked, setIsLiked] = useState(isLikedFromProps);
    const [likesCount, setLikesCount] = useState(likesFromProps);

    // Родитель перечитал ленту — принимаем его версию лайка
    useEffect(() => {
        setIsLiked(isLikedFromProps);
        setLikesCount(likesFromProps);
    }, [basket?.id, isLikedFromProps, likesFromProps]);

    if (!basket) return null;

    const title = basket.title || 'Набор продуктов';
    const photo = basket.photo_url && !photoBroken ? mediaUrl(basket.photo_url) : null;
    const total = Number(basket.total_price) || 0;
    const servings = Number(basket.servings) || 0;
    const itemsCount = Number(basket.items_count) || 0;
    const recipesCount = Number(basket.recipes_count) || 0;
    const fresh = pricesFreshnessMeta(basket.prices_freshness, basket.prices_date);

    const overBudget = Number(budget) > 0 && total > Number(budget);
    const overBy = overBudget ? total - Number(budget) : 0;

    const readyVerb = recipesCount % 10 === 1 && recipesCount % 100 !== 11 ? 'готовится' : 'готовятся';
    const recipesLabel = `из него ${readyVerb} ${formatCount(recipesCount)} ${pluralRu(
        recipesCount,
        'блюдо',
        'блюда',
        'блюд'
    )}`;

    const handleLike = async () => {
        if (!basket?.id) return;
        if (!localStorage.getItem('access_token')) {
            navigate('/login');
            return;
        }
        if (liking) return;

        const nextLiked = !isLiked;
        setLiking(true);
        // Оптимистично: сердечко меняется сразу, при ошибке откатываем
        setIsLiked(nextLiked);
        setLikesCount((prev) => Math.max(0, prev + (nextLiked ? 1 : -1)));
        try {
            const fresh2 = nextLiked ? await likeBasket(basket.id) : await unlikeBasket(basket.id);
            if (fresh2) {
                setIsLiked(!!fresh2.is_liked);
                setLikesCount(Number(fresh2.likes_count) || 0);
            }
        } catch (err) {
            setIsLiked(!nextLiked);
            setLikesCount((prev) => Math.max(0, prev + (nextLiked ? -1 : 1)));
            console.error('Не удалось обновить лайк набора:', err);
        } finally {
            setLiking(false);
        }
    };

    /* h-full — карточка заполняет высоту ряда сетки или слайда ленты,
       поэтому все карточки в ряду одной высоты. */
    return (
        <article className="card card-hover overflow-hidden flex flex-col h-full">
            {/* Фото набора: контейнер фиксированной высоты, картинка вписывается
                целиком (object-contain), верхние углы скруглены по карточке.
                object-cover обрезал края широких картинок — пользователь просил
                видеть фото полностью. flex-shrink-0 — медиа не сжимается, когда
                карточка в ряду ниже соседей. */}
            <Link
                to={target}
                className="block w-full h-40 sm:h-44 bg-ink-100 dark:bg-ink-800 overflow-hidden rounded-t-2xl flex-shrink-0"
                aria-label={`Открыть набор ${title}`}
            >
                {photo ? (
                    <img
                        src={photo}
                        alt={title}
                        loading="lazy"
                        className="w-full h-full object-contain object-center"
                        onError={() => setPhotoBroken(true)}
                    />
                ) : (
                    <span className="w-full h-full flex flex-col items-center justify-center gap-1.5 px-4 text-center bg-gradient-to-br from-primary-100 to-ink-100 dark:from-primary-900/30 dark:to-ink-850">
                        <span className="text-2xl" aria-hidden="true">
                            🧺
                        </span>
                        <span className="font-display font-bold text-sm text-primary-800 dark:text-primary-300 line-clamp-2">
                            {title}
                        </span>
                    </span>
                )}
            </Link>

            <div className="p-3.5 flex flex-col flex-1 min-w-0">
                {/* 1. Служебная строка: автор и метка перебора. Высота строки
                    зафиксирована по аватару (32px), чтобы заголовки у всех
                    карточек ряда начинались на одной линии. */}
                <div className="flex items-center justify-between gap-2 min-h-[20px] h-8">
                    <div className="flex items-center gap-2 min-w-0">
                        <AuthorAvatar username={basket.username} avatarUrl={basket.avatar_url} />
                        <span className="text-xs font-semibold text-ink-600 dark:text-ink-300 truncate">
                            {basket.username || 'Пользователь'}
                        </span>
                    </div>

                    {overBudget && (
                        <span className="budget-pill budget-over flex-shrink-0">
                            перебор {formatMoney(overBy)} ₽
                        </span>
                    )}
                </div>

                {/* 2. Заголовок: ровно 2 строки по высоте. leading-[1.3] × 2 = 2.6em,
                    поэтому min-h-[2.6em] в точности равен двум строкам: заголовок
                    в одну строку занимает столько же места, сколько в две. */}
                <h3 className="mt-2 font-display font-extrabold text-base leading-[1.3] text-ink-900 dark:text-white line-clamp-2 min-h-[2.6em]">
                    <Link to={target} className="hover:underline">
                        {title}
                    </Link>
                </h3>

                {/* 3. Подпись: тоже ровно 2 строки. Блок рендерится всегда —
                    раньше набор без описания «подпрыгивал» вверх относительно
                    соседей по ряду. */}
                <p className="mt-1 text-xs leading-[1.2] text-ink-500 dark:text-ink-400 line-clamp-2 min-h-[2.4em]">
                    {basket.description || ''}
                </p>

                {/* 4. Метаданные: крупная цена набора и число человек — всегда
                    одна строка фиксированной высоты (цена идёт leading-none,
                    поэтому min-h задаёт строке ровно 32px). */}
                <div className="mt-3 min-h-[32px] flex items-end justify-between gap-2">
                    <span className="price price-lg">
                        {formatMoney(total)}
                        <span className="text-sm"> ₽</span>
                    </span>
                    {servings > 0 && (
                        <span className="text-xs font-semibold text-ink-500 dark:text-ink-400 whitespace-nowrap">
                            {/* «на 1 человека», «на 2 человека», «на 6 человек» */}
                            на {formatCount(servings)}{' '}
                            {pluralRu(servings, 'человека', 'человека', 'человек')}
                        </span>
                    )}
                </div>

                {/* 5. Метки: свежесть цен и состав набора. Чипы переносятся,
                    поэтому под блок зарезервированы ровно две строки
                    (24 + 6 + 24 = 54px): метки у соседних карточек всегда
                    начинаются на одном уровне. */}
                <div className="mt-2 min-h-[54px] flex flex-wrap content-center items-center gap-1.5">
                    <span className={fresh.className} title={fresh.title}>
                        {fresh.label}
                    </span>
                    <span className="tag">
                        {formatCount(itemsCount)} {pluralRu(itemsCount, 'позиция', 'позиции', 'позиций')}
                    </span>
                    <span className="tag">{recipesLabel}</span>
                </div>

                {/* 6. Футер прижат к низу (mt-auto): лайк и кнопка всегда
                    на одной высоте во всех карточках ряда. */}
                <div className="mt-auto pt-3 flex items-center gap-2 border-t border-ink-100 dark:border-ink-800">
                    <button
                        type="button"
                        onClick={handleLike}
                        aria-pressed={isLiked}
                        aria-label={isLiked ? 'Убрать лайк с набора' : 'Поставить лайк набору'}
                        className={`inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-xl text-sm font-bold transition-colors
                        ${
                            isLiked
                                ? 'text-hot-600 dark:text-hot-400 bg-hot-50 dark:bg-hot-500/10'
                                : 'text-ink-500 dark:text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800'
                        }`}
                    >
                        <span aria-hidden="true">{isLiked ? '❤️' : '🤍'}</span>
                        {formatCount(likesCount)}
                    </button>

                    <Link
                        to={target}
                        className="btn-primary !min-h-[44px] !px-4 text-sm ml-auto"
                    >
                        {guestMode ? 'Войти, чтобы открыть' : 'Открыть'}
                    </Link>
                </div>
            </div>
        </article>
    );
}

export default BasketCard;
