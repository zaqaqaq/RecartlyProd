/**
 * Мелкие форматтеры для акций от людей.
 *
 * Держим их рядом с компонентами акций, чтобы PromoCard, PromoFeed и PromosPage
 * показывали цену, скидку и срок одинаково.
 */

/** Крупная цена без лишних копеек: 19.9 → «19,90», 100 → «100». */
export const promoMoney = (value) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(number);
};

/** Цена с валютой: «19,90 ₽». */
export const promoPrice = (value) =>
    Number.isFinite(Number(value)) ? `${promoMoney(value)} ₽` : '—';

/** Скидка: считаем сами, если backend её не прислал. */
export const promoDiscount = (promo) => {
    const fromApi = Number(promo?.discount_percent);
    if (Number.isFinite(fromApi) && fromApi > 0) return Math.round(fromApi);

    const oldPrice = Number(promo?.old_price);
    const newPrice = Number(promo?.new_price);
    if (!Number.isFinite(oldPrice) || !Number.isFinite(newPrice)) return null;
    if (oldPrice <= 0 || newPrice <= 0 || newPrice >= oldPrice) return null;
    return Math.round((1 - newPrice / oldPrice) * 100);
};

const MONTHS_GENITIVE = [
    'января',
    'февраля',
    'марта',
    'апреля',
    'мая',
    'июня',
    'июля',
    'августа',
    'сентября',
    'октября',
    'ноября',
    'декабря',
];

/** Начало сегодняшнего дня — чтобы «истекает сегодня» не зависело от часов. */
const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

/** «истекает сегодня» / «истекает завтра» / «до 25 сентября». */
export const promoEndsLabel = (iso) => {
    if (!iso) return '';
    const ends = new Date(iso);
    if (Number.isNaN(ends.getTime())) return '';

    const days = Math.round((startOfDay(ends) - startOfDay(new Date())) / 86400000);
    if (days < 0) return 'срок истёк';
    if (days === 0) return 'истекает сегодня';
    if (days === 1) return 'истекает завтра';
    return `до ${ends.getDate()} ${MONTHS_GENITIVE[ends.getMonth()]}`;
};

/** Подпись автора: «от price_tester». */
export const promoAuthor = (promo) =>
    promo?.author_username ? `от ${promo.author_username}` : '';

/** Плашка статуса для «Моих акций». */
export const PROMO_STATUS = {
    published: { label: 'опубликовано', className: 'budget-ok' },
    pending: { label: 'на проверке', className: 'budget-warn' },
    rejected: { label: 'отклонено', className: 'budget-over' },
    needs_changes: { label: 'нужна доработка', className: 'budget-warn' },
};
