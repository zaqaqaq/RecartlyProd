import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import RiBadge from './RiBadge';
import { mediaUrl } from '../utils/media';
import { formatCount, formatMoney, pluralRu, pricesFreshnessMeta } from './BasketCard';

/* ============================================================
   Карточка блюда из набора.
   Ключевая мысль экрана: блюдо готовится из набора, поэтому цена —
   это цена набора, а переход ведёт на закупку, а не на рецепт.
   ============================================================ */

/* Сложность на бэкенде — число 1/2/3 */
const DIFFICULTY_LABELS = {
    1: 'просто',
    2: 'средне',
    3: 'сложно',
};

function difficultyLabel(value) {
    if (value === null || value === undefined || value === '') return '';
    if (typeof value === 'string' && !/^\d+$/.test(value)) return value;
    return DIFFICULTY_LABELS[Number(value)] || '';
}

/**
 * Карточка блюда: фото, категория, время и сложность, индекс Recartly (RI),
 * цена набора с меткой свежести цен и кнопка перехода к закупке.
 *
 * Props:
 *  - dish — объект Dish из `getDishFeed` ({recipe_id, title, photo_url, category,
 *           cook_time_min, difficulty, servings, ri_score, kcal_per_serving,
 *           protein_per_serving, basket_id, basket_title, basket_total,
 *           prices_date, prices_freshness, ...})
 */
function DishCard({ dish, guestMode = false }) {
    const [photoBroken, setPhotoBroken] = useState(false);

    useEffect(() => {
        setPhotoBroken(false);
    }, [dish?.photo_url]);

    if (!dish) return null;

    const title = dish.title || 'Блюдо';
    const photo = dish.photo_url && !photoBroken ? mediaUrl(dish.photo_url) : null;
    const basketTotal = Number(dish.basket_total) || 0;
    const servings = Number(dish.servings) || 0;
    const cookTime = Number(dish.cook_time_min) || 0;
    const difficulty = difficultyLabel(dish.difficulty);
    const fresh = pricesFreshnessMeta(dish.prices_freshness, dish.prices_date);

    // Блюдо без набора на этой странице не бывает, но ссылка не должна ломаться
    // Гость не может открыть набор/блюдо: ведём его на регистрацию
    const target = guestMode
        ? '/register'
        : dish.basket_id
          ? `/basket/${dish.basket_id}`
          : `/recipe/${dish.recipe_id}`;

    /* h-full — карточка заполняет высоту ряда сетки или слайда ленты,
       поэтому все карточки в ряду одной высоты. */
    return (
        <article className="card card-hover overflow-hidden flex flex-col h-full">
            {/* Фото блюда — та же схема, что в BasketCard: фиксированная высота,
                object-contain (фото видно целиком), скруглённые верхние углы.
                Высота совпадает со скелетоном (h-40 sm:h-44), flex-shrink-0 —
                медиа не сжимается, когда карточка в ряду ниже соседей. */}
            <Link
                to={target}
                className="block w-full h-40 sm:h-44 bg-ink-100 dark:bg-ink-800 overflow-hidden rounded-t-2xl flex-shrink-0"
                aria-label={`Открыть набор для «${title}»`}
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
                    <span className="w-full h-full flex items-center justify-center text-3xl bg-gradient-to-br from-secondary-50 to-ink-100 dark:from-secondary-500/15 dark:to-ink-850">
                        🍲
                    </span>
                )}
            </Link>

            <div className="p-3.5 flex flex-col flex-1 min-w-0">
                {/* 1. Служебная строка: категория, время, сложность и индекс RI.
                    В узкой карточке (лента на мобильном) чипы не влезают в одну
                    строку, поэтому под блок зарезервированы ровно две строки
                    (24 + 6 + 24 = 54px) — ниже ничего не «съезжает». */}
                <div className="min-h-[54px] flex flex-wrap content-center items-center gap-1.5">
                    {dish.category && <span className="tag">{dish.category}</span>}
                    {cookTime > 0 && <span className="tag">⏱ {formatCount(cookTime)} мин</span>}
                    {difficulty && <span className="tag">{difficulty}</span>}
                    <RiBadge value={dish.ri_score} size="sm" className="ml-auto" />
                </div>

                {/* 2. Заголовок: ровно 2 строки по высоте. leading-[1.3] × 2 = 2.6em,
                    поэтому min-h-[2.6em] равен двум строкам точно. */}
                <h3 className="mt-2 font-display font-extrabold text-base leading-[1.3] text-ink-900 dark:text-white line-clamp-2 min-h-[2.6em]">
                    <Link to={target} className="hover:underline">
                        {title}
                    </Link>
                </h3>

                {/* 3. Подпись: тоже ровно 2 строки. Блок рендерится всегда, чтобы
                    карточка без подписи не «прыгала» вверх относительно соседей. */}
                <p className="mt-1 text-xs leading-[1.2] text-ink-500 dark:text-ink-400 line-clamp-2 min-h-[2.4em]">
                    {dish.basket_title ? `готовится из набора «${dish.basket_title}»` : ''}
                </p>

                {/* 4. Метаданные: цена набора и порции — одна строка фиксированной
                    высоты (цена идёт leading-none, min-h задаёт строке 28px). */}
                <div className="mt-3 min-h-[28px] flex items-center justify-between gap-2">
                    {/* Цена — это цена набора, а не блюда */}
                    <span className="flex items-baseline gap-1.5 min-w-0">
                        <span className="text-[11px] font-bold uppercase tracking-wide text-ink-400 dark:text-ink-500">
                            набор
                        </span>
                        <span className="price text-xl">
                            {formatMoney(basketTotal)}
                            <span className="text-sm"> ₽</span>
                        </span>
                    </span>
                    {servings > 0 && (
                        <span className="text-xs font-semibold text-ink-500 dark:text-ink-400 whitespace-nowrap flex-shrink-0">
                            на {formatCount(servings)}{' '}
                            {pluralRu(servings, 'порцию', 'порции', 'порций')}
                        </span>
                    )}
                </div>

                {/* 5. Метки: свежесть цен, белок и калории. Здесь тоже зарезервированы
                    две строки: метка свежести с датой («цены от 12 сентября») длинная
                    и в одну строку с остальными чипами не влезает. */}
                <div className="mt-2 min-h-[54px] flex flex-wrap content-center items-center gap-1.5">
                    <span className={fresh.className} title={fresh.title}>
                        {fresh.label}
                    </span>
                    {Number(dish.protein_per_serving) > 0 && (
                        <span className="tag">
                            {formatMoney(dish.protein_per_serving)} г белка
                        </span>
                    )}
                    {Number(dish.kcal_per_serving) > 0 && (
                        <span className="tag">{formatCount(dish.kcal_per_serving)} ккал</span>
                    )}
                </div>

                {/* 6. Футер прижат к низу (mt-auto): кнопка всегда на одной высоте */}
                <div className="mt-auto pt-3 border-t border-ink-100 dark:border-ink-800">
                    <Link to={target} className="btn-primary btn-block">
                        {guestMode
                            ? 'Войти, чтобы открыть'
                            : dish.basket_id
                              ? 'Открыть набор'
                              : 'Открыть блюдо'}
                    </Link>
                </div>
            </div>
        </article>
    );
}

export default DishCard;
