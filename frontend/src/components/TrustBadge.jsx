import React from 'react';

/**
 * Бейджи доверия. Вокруг денег и цен это критично: человек должен видеть,
 * что рецепт проверен модерацией, цена подтверждена, а автор — надёжный.
 */

const TONES = {
    verified: 'bg-primary-50 text-primary-700 dark:bg-primary-500/15 dark:text-primary-300',
    pending: 'bg-secondary-50 text-secondary-600 dark:bg-secondary-500/15 dark:text-secondary-300',
    warning: 'bg-hot-50 text-hot-600 dark:bg-hot-500/15 dark:text-hot-400',
    neutral: 'bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-400',
};

const LABELS = {
    recipe: { verified: '✅ Рецепт проверен', pending: '⏳ На проверке', rejected: '🚫 Отклонён' },
    price: { verified: '✅ Цена проверена', pending: '⏳ Цена на проверке', rejected: '🚫 Цена отклонена' },
    author: { verified: '🛡️ Проверенный автор', pending: '⭐ Автор с доверием', rejected: '⚠️ Низкое доверие' },
    moderation: { verified: 'Опубликовано', pending: 'На модерации', rejected: 'Отклонено' },
};

function TrustBadge({ kind = 'recipe', status = 'verified', label, size = 'md', className = '' }) {
    const tone =
        status === 'verified' || status === true
            ? TONES.verified
            : status === 'pending'
              ? TONES.pending
              : status === 'rejected'
                ? TONES.warning
                : TONES.neutral;

    const text = label || LABELS[kind]?.[status] || LABELS[kind]?.verified || '';
    if (!text) return null;

    const sizeClass = size === 'sm' ? 'text-[10px] px-2 py-0.5 gap-1' : 'text-xs px-2.5 py-1 gap-1';

    return (
        <span
            className={`inline-flex items-center rounded-full font-bold whitespace-nowrap ${tone} ${sizeClass} ${className}`}
        >
            {text}
        </span>
    );
}

/** Бейдж рецепта: проверен модерацией или ещё на проверке. */
export function RecipeTrustBadge({ recipe, size = 'sm', className = '' }) {
    if (!recipe) return null;

    if (recipe.status === 'pending' || recipe.status === 'needs_changes') {
        return <TrustBadge kind="recipe" status="pending" size={size} className={className} />;
    }
    if (recipe.status === 'rejected') {
        return <TrustBadge kind="recipe" status="rejected" size={size} className={className} />;
    }
    if (recipe.is_verified) {
        return <TrustBadge kind="recipe" status="verified" size={size} className={className} />;
    }
    return null;
}

/** Бейдж автора: доверие выше 70 — считаем проверенным. */
export function AuthorTrustBadge({ trustScore, size = 'sm', className = '' }) {
    if (trustScore == null) return null;
    if (trustScore >= 70) {
        return <TrustBadge kind="author" status="verified" size={size} className={className} />;
    }
    if (trustScore >= 55) {
        return (
            <TrustBadge
                kind="author"
                status="pending"
                label="⭐ Активный автор"
                size={size}
                className={className}
            />
        );
    }
    return null;
}

/** Бейдж цены: подтверждена модерацией или ждёт проверки. */
export function PriceTrustBadge({ status, size = 'sm', className = '' }) {
    if (!status) return null;
    if (status === 'confirmed') {
        return <TrustBadge kind="price" status="verified" size={size} className={className} />;
    }
    if (status === 'pending') {
        return <TrustBadge kind="price" status="pending" size={size} className={className} />;
    }
    return null;
}

export default TrustBadge;
