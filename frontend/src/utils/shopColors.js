/* Стили магазинов: эмодзи + классы Tailwind.
   Классы включают dark-варианты, поэтому бейджи корректно выглядят и в тёмной теме. */

export const getShopStyle = (shopName) => {
    if (!shopName) {
        return {
            emoji: '🏬',
            bgColor: 'bg-ink-100 dark:bg-ink-800',
            textColor: 'text-ink-600 dark:text-ink-300',
            borderColor: 'border-ink-200 dark:border-ink-700',
        };
    }

    const name = shopName.toLowerCase();

    const shops = [
        { keywords: ['пятёрочка', 'пятерочка'], emoji: '🏪', bgColor: 'bg-green-50 dark:bg-green-500/15', textColor: 'text-green-700 dark:text-green-300', borderColor: 'border-green-200 dark:border-green-500/30' },
        { keywords: ['магнит'], emoji: '🔴', bgColor: 'bg-red-50 dark:bg-red-500/15', textColor: 'text-red-700 dark:text-red-300', borderColor: 'border-red-200 dark:border-red-500/30' },
        { keywords: ['лента'], emoji: '🔵', bgColor: 'bg-blue-50 dark:bg-blue-500/15', textColor: 'text-blue-700 dark:text-blue-300', borderColor: 'border-blue-200 dark:border-blue-500/30' },
        { keywords: ['перекрёсток', 'перекресток'], emoji: '🟢', bgColor: 'bg-emerald-50 dark:bg-emerald-500/15', textColor: 'text-emerald-700 dark:text-emerald-300', borderColor: 'border-emerald-200 dark:border-emerald-500/30' },
        { keywords: ['озон', 'ozon'], emoji: '📦', bgColor: 'bg-indigo-50 dark:bg-indigo-500/15', textColor: 'text-indigo-700 dark:text-indigo-300', borderColor: 'border-indigo-200 dark:border-indigo-500/30' },
        { keywords: ['wildberries', 'вайлдберриз', ' wb'], emoji: '🟣', bgColor: 'bg-fuchsia-50 dark:bg-fuchsia-500/15', textColor: 'text-fuchsia-700 dark:text-fuchsia-300', borderColor: 'border-fuchsia-200 dark:border-fuchsia-500/30' },
        { keywords: ['яндекс', 'лавка'], emoji: '🟡', bgColor: 'bg-yellow-50 dark:bg-yellow-500/15', textColor: 'text-yellow-700 dark:text-yellow-300', borderColor: 'border-yellow-200 dark:border-yellow-500/30' },
        { keywords: ['вкусвилл', 'вкусвill'], emoji: '🟢', bgColor: 'bg-teal-50 dark:bg-teal-500/15', textColor: 'text-teal-700 dark:text-teal-300', borderColor: 'border-teal-200 dark:border-teal-500/30' },
        { keywords: ['спар', 'spar'], emoji: '🟠', bgColor: 'bg-orange-50 dark:bg-orange-500/15', textColor: 'text-orange-700 dark:text-orange-300', borderColor: 'border-orange-200 dark:border-orange-500/30' },
        { keywords: ['чижик'], emoji: '🐥', bgColor: 'bg-amber-50 dark:bg-amber-500/15', textColor: 'text-amber-700 dark:text-amber-300', borderColor: 'border-amber-200 dark:border-amber-500/30' },
        { keywords: ['ярче'], emoji: '☀️', bgColor: 'bg-yellow-50 dark:bg-yellow-500/15', textColor: 'text-yellow-700 dark:text-yellow-300', borderColor: 'border-yellow-200 dark:border-yellow-500/30' },
        { keywords: ['ашан', 'auchan'], emoji: '🛒', bgColor: 'bg-sky-50 dark:bg-sky-500/15', textColor: 'text-sky-700 dark:text-sky-300', borderColor: 'border-sky-200 dark:border-sky-500/30' },
        { keywords: ['metro', 'метро'], emoji: '🏬', bgColor: 'bg-indigo-50 dark:bg-indigo-500/15', textColor: 'text-indigo-700 dark:text-indigo-300', borderColor: 'border-indigo-200 dark:border-indigo-500/30' },
        { keywords: ['самокат'], emoji: '🛴', bgColor: 'bg-lime-50 dark:bg-lime-500/15', textColor: 'text-lime-700 dark:text-lime-300', borderColor: 'border-lime-200 dark:border-lime-500/30' },
        { keywords: ['пятерочка'], emoji: '🏪', bgColor: 'bg-green-50 dark:bg-green-500/15', textColor: 'text-green-700 dark:text-green-300', borderColor: 'border-green-200 dark:border-green-500/30' },
    ];

    for (const shop of shops) {
        if (shop.keywords.some(keyword => name.includes(keyword))) {
            return {
                emoji: shop.emoji,
                bgColor: shop.bgColor,
                textColor: shop.textColor,
                borderColor: shop.borderColor,
            };
        }
    }

    return {
        emoji: '🏬',
        bgColor: 'bg-ink-100 dark:bg-ink-800',
        textColor: 'text-ink-600 dark:text-ink-300',
        borderColor: 'border-ink-200 dark:border-ink-700',
    };
};
