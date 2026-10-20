import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    approveModerationTask,
    getAdminStats,
    getAdminWhoami,
    getModerationQueue,
    login,
    needsChangesModerationTask,
    rejectModerationTask,
} from '../services/api';
import { mediaUrl } from '../utils/media';

/* ============================================================
   Модерация Recartly — отдельное рабочее место модератора.

   Все новые рецепты и наборы попадают в очередь ручной проверки
   (рейтинг автора больше не влияет на публикацию). Здесь две
   самостоятельные части:

   1. «Дверь» — вход только для роли moderator/admin. Роль
      проверяется на сервере через /admin/whoami, а не только по
      localStorage.
   2. Рабочее место — очередь публикаций, фильтр по типу и карточка
      проверки с полным содержимым и тремя решениями.

   Это не дубль AdminPage: там метрики, жалобы и аудит, здесь —
   только проверка новых рецептов и наборов.
   ============================================================ */

const PAGE_SIZE = 20;

const MODERATOR_ROLES = ['moderator', 'admin'];

/* Причины отклонения — те же коды, что понимает backend (REASON_LABELS). */
const REJECT_REASONS = [
    { code: 'spam', label: 'Спам или реклама' },
    { code: 'forbidden', label: 'Запрещённый контент' },
    { code: 'fake_price', label: 'Недостоверная цена' },
    { code: 'duplicate', label: 'Дубликат' },
    { code: 'copyright', label: 'Авторские права' },
    { code: 'abuse', label: 'Оскорбления' },
    { code: 'other', label: 'Другое' },
];

/* Автофлаги: какие считаем «опасными» и красим в коралл. */
const DANGEROUS_FLAGS = ['link', 'phone', 'messenger', 'spam', 'profanity'];

const FLAG_LABELS = {
    link: '🔗 ссылка',
    phone: '📞 телефон',
    messenger: '💬 мессенджер',
    spam: '📣 спам',
    profanity: '🤬 мат',
    short_text: '✏️ короткий текст',
    no_photo: '🖼 без фото',
};

const TYPE_LABELS = {
    recipe: 'Рецепт',
    basket: 'Набор',
    cart: 'Набор',
    promo: 'Акция',
    price: 'Цена',
    review: 'Отзыв',
    comment: 'Комментарий',
};

const FILTERS = [
    { key: 'all', label: 'Все' },
    { key: 'recipe', label: 'Рецепты' },
    { key: 'basket', label: 'Наборы' },
];

const SUCCESS_MESSAGES = {
    approve: 'Публикация одобрена и опубликована',
    reject: 'Публикация отклонена — автор увидит причину',
    needs_changes: 'Публикация отправлена на доработку',
};

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
});

const DATE_FORMATTER = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
});

const MONEY_FORMATTER = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

const isModeratorRole = (role) => MODERATOR_ROLES.includes(role);

const typeLabel = (task) =>
    task.target_type_label || TYPE_LABELS[task.target_type] || task.target_type || 'Публикация';

const isBasketType = (type) => type === 'basket' || type === 'cart';

const formatDateTime = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : DATE_TIME_FORMATTER.format(date);
};

const formatDate = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : DATE_FORMATTER.format(date);
};

const formatMoney = (value) => {
    if (value === null || value === undefined || value === '') return '—';
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '—';
    return `${MONEY_FORMATTER.format(numeric)} ₽`;
};

const formatQuantity = (value, unit) => {
    const hasValue = value !== null && value !== undefined && value !== '';
    if (!hasValue) return unit || '';
    const numeric = Number(value);
    const amount = Number.isFinite(numeric) ? MONEY_FORMATTER.format(numeric) : String(value);
    return unit ? `${amount} ${unit}` : amount;
};

const taskTitle = (task, detail) => {
    const preview = task.preview || {};
    return (
        preview.title ||
        (detail && detail.title) ||
        preview.product ||
        `${typeLabel(task)} #${task.target_id ?? '—'}`
    );
};

/* Объединяем страницы двух типов для фильтра «Все»: порядок как на сервере. */
const mergeTasks = (groups) => {
    const byId = new Map();
    groups.forEach((group) => {
        (group || []).forEach((task) => {
            if (task && task.id !== undefined && task.id !== null) {
                byId.set(task.id, task);
            }
        });
    });

    return Array.from(byId.values()).sort((a, b) => {
        const priorityDiff = (Number(b.priority) || 0) - (Number(a.priority) || 0);
        if (priorityDiff !== 0) return priorityDiff;
        const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return timeB - timeA;
    });
};

/**
 * Одна страница очереди. Для «Все» берём рецепты и наборы параллельно:
 * в /admin/queue попадают ещё цены и акции, а это рабочее место — только
 * про публикации (рецепты и наборы).
 */
const fetchQueueSlice = async (filterValue, skip) => {
    if (filterValue === 'all') {
        const recipeSkip = Math.max(0, Number(skip && skip.recipe) || 0);
        const basketSkip = Math.max(0, Number(skip && skip.basket) || 0);

        const [recipePage, basketPage] = await Promise.all([
            getModerationQueue('pending', 'recipe', PAGE_SIZE, recipeSkip),
            getModerationQueue('pending', 'basket', PAGE_SIZE, basketSkip),
        ]);

        const recipeItems = Array.isArray(recipePage && recipePage.items) ? recipePage.items : [];
        const basketItems = Array.isArray(basketPage && basketPage.items) ? basketPage.items : [];

        return {
            items: mergeTasks([recipeItems, basketItems]),
            total: (Number(recipePage && recipePage.total) || 0)
                + (Number(basketPage && basketPage.total) || 0),
        };
    }

    const data = await getModerationQueue('pending', filterValue, PAGE_SIZE, Math.max(0, Number(skip) || 0));
    const items = Array.isArray(data && data.items) ? data.items : [];
    return { items, total: Number(data && data.total) || items.length };
};

const humanizeError = (err, fallback) => {
    const raw = (err && err.message) || '';
    if (/HTTP 401/.test(raw)) return 'Сессия истекла. Войдите снова.';
    if (/HTTP 403/.test(raw)) return 'Недостаточно прав для этого действия.';
    if (/HTTP 404/.test(raw)) return 'Публикация не найдена — возможно, её уже удалили.';
    if (/HTTP 5\d\d/.test(raw)) return 'Сервер не смог обработать запрос. Попробуйте ещё раз.';
    if (/Failed to fetch|NetworkError|Load failed|network/i.test(raw)) {
        return 'Нет связи с сервером. Проверьте подключение.';
    }
    if (/^HTTP \d+$/.test(raw.trim())) return fallback;
    return raw || fallback;
};

const clearSession = () => {
    try {
        ['access_token', 'username', 'avatar_url', 'role'].forEach((key) => {
            localStorage.removeItem(key);
        });
    } catch (err) {
        console.error('Не удалось очистить сессию:', err);
    }
};

/* ---------- Небольшие переиспользуемые элементы ---------- */

function AuthorAvatar({ username, avatarUrl, size = 'w-10 h-10 text-sm' }) {
    const [broken, setBroken] = useState(false);

    useEffect(() => {
        setBroken(false);
    }, [avatarUrl]);

    if (avatarUrl && avatarUrl.startsWith('emoji:')) {
        const [, emoji, bg = 'bg-primary-100 dark:bg-primary-900/30', text = 'text-primary-600 dark:text-primary-300'] =
            avatarUrl.split(':');
        return (
            <span className={`avatar ${bg} ${text} ${size} flex items-center justify-center`} aria-hidden="true">
                {emoji}
            </span>
        );
    }

    if (avatarUrl && !broken) {
        return (
            <img
                src={mediaUrl(avatarUrl)}
                alt=""
                loading="lazy"
                onError={() => setBroken(true)}
                className={`avatar object-cover ${size}`}
            />
        );
    }

    const initial = username ? username[0].toUpperCase() : '?';
    return (
        <span className={`avatar ${size} flex items-center justify-center`} aria-hidden="true">
            {initial}
        </span>
    );
}

function PreviewImage({ src, alt, className = '' }) {
    const [broken, setBroken] = useState(false);

    useEffect(() => {
        setBroken(false);
    }, [src]);

    if (!src || broken) return null;

    return (
        <img
            src={mediaUrl(src)}
            alt={alt}
            loading="lazy"
            onError={() => setBroken(true)}
            className={className}
        />
    );
}

function QueueSkeleton() {
    return (
        <div className="space-y-2.5" aria-hidden="true">
            {[0, 1, 2, 3].map((item) => (
                <div key={item} className="card p-3 flex gap-3">
                    <div className="skeleton w-14 h-14" />
                    <div className="flex-1 min-w-0 space-y-2">
                        <div className="skeleton h-4 w-2/3" />
                        <div className="skeleton h-3 w-1/3" />
                        <div className="skeleton h-3 w-1/2" />
                    </div>
                </div>
            ))}
        </div>
    );
}

function Counter({ label, value, tone = 'text-ink-900 dark:text-white' }) {
    return (
        <div className="min-w-0">
            <p className={`font-display text-xl sm:text-2xl font-extrabold tabular-nums leading-none ${tone}`}>
                {value}
            </p>
            <p className="text-[10px] sm:text-[11px] uppercase tracking-wide font-semibold text-ink-400 dark:text-ink-500 mt-1 truncate">
                {label}
            </p>
        </div>
    );
}

/* ---------- Экран входа ---------- */

function LoginDoor({ email, password, onEmail, onPassword, onSubmit, loading, error, notice }) {
    return (
        <div className="min-h-[calc(100vh-10rem)] flex items-center justify-center px-1 py-6 sm:py-10 animate-fade-in safe-bottom">
            <div className="w-full max-w-md">
                <div className="card overflow-hidden">
                    <div className="h-1.5 bg-gradient-to-r from-primary-500 via-primary-400 to-secondary-400" aria-hidden="true" />
                    <div className="p-5 sm:p-8">
                        <div className="text-center">
                            <span
                                className="w-16 h-16 mx-auto rounded-3xl bg-gradient-to-br from-primary-500 to-primary-700 text-white text-3xl flex items-center justify-center shadow-brand"
                                aria-hidden="true"
                            >
                                🛡️
                            </span>
                            <h1 className="heading-1 mt-4">Модерация Recartly</h1>
                            <p className="text-sm sm:text-base text-ink-500 dark:text-ink-400 mt-2">
                                Доступ только для модераторов
                            </p>
                        </div>

                        {notice && !error && (
                            <div
                                role="status"
                                className="mt-5 flex items-start gap-2 bg-secondary-50 dark:bg-secondary-500/15 border border-secondary-300/60 dark:border-secondary-500/30 text-secondary-600 dark:text-secondary-300 px-4 py-3 rounded-2xl text-sm"
                            >
                                <span aria-hidden="true">ℹ️</span>
                                <span>{notice}</span>
                            </div>
                        )}

                        {error && (
                            <div
                                role="alert"
                                className="mt-5 flex items-start gap-2 bg-hot-50 dark:bg-hot-600/15 border border-hot-500/30 dark:border-hot-600/40 text-hot-600 dark:text-hot-400 px-4 py-3 rounded-2xl text-sm animate-fade-in"
                            >
                                <span aria-hidden="true">⚠️</span>
                                <span>{error}</span>
                            </div>
                        )}

                        <form onSubmit={onSubmit} className="space-y-4 mt-6">
                            <div className="flex items-center gap-2 mb-1">
                                <span className="h-px flex-1 bg-ink-200 dark:bg-ink-800" aria-hidden="true" />
                                <span className="text-[11px] uppercase tracking-wide font-semibold text-ink-400 dark:text-ink-500">
                                    Вход для модератора
                                </span>
                                <span className="h-px flex-1 bg-ink-200 dark:bg-ink-800" aria-hidden="true" />
                            </div>
                            <div>
                                <label htmlFor="moderation-email" className="label">
                                    Email
                                </label>
                                <input
                                    id="moderation-email"
                                    type="email"
                                    name="email"
                                    value={email}
                                    onChange={(event) => onEmail(event.target.value)}
                                    className={`input ${error ? 'input-error' : ''}`}
                                    placeholder="moderator@recartly.ru"
                                    autoComplete="email"
                                    autoCapitalize="none"
                                    spellCheck="false"
                                    required
                                />
                            </div>

                            <div>
                                <label htmlFor="moderation-password" className="label">
                                    Пароль
                                </label>
                                <input
                                    id="moderation-password"
                                    type="password"
                                    name="password"
                                    value={password}
                                    onChange={(event) => onPassword(event.target.value)}
                                    className={`input ${error ? 'input-error' : ''}`}
                                    placeholder="••••••••"
                                    autoComplete="current-password"
                                    required
                                />
                            </div>

                            <button type="submit" disabled={loading} className="btn-primary btn-block">
                                {loading ? 'Проверяем доступ…' : 'Войти'}
                            </button>
                        </form>

                        <div className="flex items-center justify-center mt-5">
                            <Link
                                to="/"
                                className="btn-ghost !min-h-[44px] text-sm text-ink-500 dark:text-ink-400"
                            >
                                ← На главную
                            </Link>
                        </div>
                    </div>
                </div>

                <p className="text-center text-xs text-ink-400 dark:text-ink-500 mt-4 px-4">
                    Роль аккаунта проверяется на сервере. После входа вы увидите очередь новых
                    рецептов и наборов.
                </p>
            </div>
        </div>
    );
}

function CheckingAccess() {
    return (
        <div className="min-h-[calc(100vh-10rem)] flex items-center justify-center px-1 py-8">
            <div className="card w-full max-w-md p-6 space-y-4" aria-busy="true" aria-label="Проверяем доступ">
                <div className="skeleton h-14 w-14 rounded-3xl mx-auto" />
                <div className="skeleton h-6 w-3/5 mx-auto" />
                <div className="skeleton h-4 w-4/5 mx-auto" />
                <div className="skeleton h-11 w-full" />
                <div className="skeleton h-11 w-full" />
                <div className="skeleton h-11 w-full" />
            </div>
        </div>
    );
}

function ForbiddenDoor({ me, onLogout }) {
    const username = (me && me.username) || localStorage.getItem('username') || 'этот аккаунт';

    return (
        <div className="min-h-[calc(100vh-10rem)] flex items-center justify-center px-1 py-6 sm:py-10 animate-fade-in pb-bottom-nav">
            <div className="w-full max-w-md">
                <div className="card p-6 sm:p-8 text-center">
                    <span
                        className="w-16 h-16 mx-auto rounded-3xl bg-hot-50 dark:bg-hot-600/15 text-hot-600 dark:text-hot-400 text-3xl flex items-center justify-center"
                        aria-hidden="true"
                    >
                        🚫
                    </span>
                    <h1 className="heading-2 mt-4">У этого аккаунта нет доступа к модерации</h1>
                    <p className="text-sm text-ink-500 dark:text-ink-400 mt-3">
                        Вы вошли как <span className="font-semibold text-ink-700 dark:text-ink-200">{username}</span>.
                        Для рабочего места нужна роль «модератор» или «администратор».
                    </p>
                    <p className="text-xs text-ink-400 dark:text-ink-500 mt-2">
                        После выхода можно войти под другим аккаунтом.
                    </p>

                    <div className="flex flex-col gap-2 mt-6">
                        <button type="button" onClick={onLogout} className="btn-primary btn-block">
                            Выйти
                        </button>
                        <Link to="/" className="btn-ghost !min-h-[44px]">
                            ← На главную
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}

/* ---------- Очередь ---------- */

function QueueCard({ task, active, onSelect }) {
    const preview = task.preview || {};
    const flags = Array.isArray(task.auto_flags) ? task.auto_flags : [];
    const title = taskTitle(task);
    const basket = isBasketType(task.target_type);
    const photo = preview.photo_url;

    return (
        <li>
            <button
                type="button"
                onClick={() => onSelect(task.id)}
                aria-current={active ? 'true' : undefined}
                className={`card w-full text-left p-3 transition-all ${
                    active
                        ? 'ring-2 ring-primary-500 border-primary-300 dark:border-primary-700'
                        : 'hover:shadow-card-hover hover:border-ink-300/70 dark:hover:border-ink-700'
                }`}
            >
                <span className="flex items-start gap-3">
                    {photo ? (
                        <PreviewImage
                            src={photo}
                            alt=""
                            className="w-14 h-14 rounded-2xl object-cover flex-shrink-0 bg-ink-100 dark:bg-ink-800"
                        />
                    ) : (
                        <span
                            className="w-14 h-14 rounded-2xl flex-shrink-0 bg-ink-100 dark:bg-ink-800 text-xl flex items-center justify-center"
                            aria-hidden="true"
                        >
                            {basket ? '🧺' : '🍳'}
                        </span>
                    )}

                    <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                            <span className={`tag ${basket
                                ? 'bg-secondary-50 text-secondary-600 dark:bg-secondary-500/15 dark:text-secondary-300'
                                : 'bg-primary-50 text-primary-700 dark:bg-primary-500/15 dark:text-primary-300'}`}
                            >
                                {typeLabel(task)}
                            </span>
                            <span className="text-[11px] text-ink-400 dark:text-ink-500 whitespace-nowrap tabular-nums">
                                {formatDateTime(task.created_at)}
                            </span>
                        </span>

                        <span className="block font-semibold text-[15px] text-ink-900 dark:text-white mt-1 line-clamp-2">
                            {title}
                        </span>

                        {preview.description && (
                            <span className="block text-xs text-ink-500 dark:text-ink-400 mt-0.5 line-clamp-1">
                                {preview.description}
                            </span>
                        )}

                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5 text-xs text-ink-500 dark:text-ink-400">
                            <span className="truncate">👤 {preview.username || `автор #${task.author_id ?? '—'}`}</span>
                            {basket && preview.price !== null && preview.price !== undefined && (
                                <span className="font-semibold text-primary-600 dark:text-primary-400 whitespace-nowrap">
                                    {formatMoney(preview.price)}
                                </span>
                            )}
                        </span>

                        {flags.length > 0 && (
                            <span className="flex flex-wrap gap-1 mt-2">
                                {flags.slice(0, 2).map((flag) => (
                                    <span
                                        key={flag}
                                        className={`tag !px-2 !py-0.5 !text-[10px] ${DANGEROUS_FLAGS.includes(flag)
                                            ? 'bg-hot-50 text-hot-600 dark:bg-hot-600/15 dark:text-hot-400'
                                            : ''}`}
                                    >
                                        {FLAG_LABELS[flag] || flag}
                                    </span>
                                ))}
                                {flags.length > 2 && (
                                    <span className="tag !px-2 !py-0.5 !text-[10px]">+{flags.length - 2}</span>
                                )}
                            </span>
                        )}
                    </span>
                </span>
            </button>
        </li>
    );
}

function EmptyQueue({ filter, counts, onReset, onRefresh }) {
    if (filter !== 'all' && counts.all > 0) {
        return (
            <div className="card p-6 sm:p-8 text-center">
                <div
                    className="w-14 h-14 mx-auto rounded-3xl bg-ink-100 dark:bg-ink-800 flex items-center justify-center text-2xl mb-3"
                    aria-hidden="true"
                >
                    🔎
                </div>
                <h2 className="heading-3">В этом разделе пусто</h2>
                <p className="text-sm text-ink-500 dark:text-ink-400 mt-2">
                    В других типах публикаций ещё есть задачи на проверку.
                </p>
                <button type="button" onClick={onReset} className="btn-secondary min-h-[44px] mt-4">
                    Показать все
                </button>
            </div>
        );
    }

    return (
        <div className="card p-6 sm:p-8 text-center">
            <div
                className="w-16 h-16 mx-auto rounded-3xl bg-primary-100 dark:bg-primary-900/25 flex items-center justify-center text-3xl mb-3"
                aria-hidden="true"
            >
                🎉
            </div>
            <h2 className="heading-3">Всё проверено 🎉</h2>
            <p className="text-sm text-ink-500 dark:text-ink-400 mt-2">
                Новых рецептов и наборов на проверке нет. Публикации появятся здесь автоматически —
                просто обновите очередь позже.
            </p>
            <button type="button" onClick={onRefresh} className="btn-secondary min-h-[44px] mt-4">
                🔄 Обновить
            </button>
        </div>
    );
}

/* ---------- Содержимое карточки проверки ---------- */

function DescriptionBlock({ text }) {
    return (
        <section>
            <h3 className="section-title">Описание</h3>
            <p className="text-sm text-ink-600 dark:text-ink-300 mt-2 whitespace-pre-line break-words">
                {text || 'Автор не добавил описание.'}
            </p>
        </section>
    );
}

function RecipeContent({ task, data }) {
    const preview = task.preview || {};
    const recipe = data || {};
    const description = recipe.description || preview.description;
    const ingredients = Array.isArray(recipe.ingredients)
        ? recipe.ingredients
        : Array.isArray(preview.ingredients)
            ? preview.ingredients
            : [];
    const steps = Array.isArray(recipe.steps) ? recipe.steps : Array.isArray(preview.steps) ? preview.steps : [];
    const instructions = recipe.instructions || preview.instructions;
    const instructionLines = !steps.length && instructions
        ? String(instructions)
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
        : [];
    const totalPrice = recipe.total_price ?? preview.total_price;

    return (
        <div className="space-y-5">
            <DescriptionBlock text={description} />

            <section>
                <h3 className="section-title">
                    Ингредиенты
                    <span className="tag">{ingredients.length}</span>
                </h3>
                {ingredients.length > 0 ? (
                    <ul className="mt-2 divide-y divide-ink-100 dark:divide-ink-800">
                        {ingredients.map((ingredient, index) => (
                            <li
                                key={ingredient.id ?? `${ingredient.name}-${index}`}
                                className="flex items-baseline gap-3 py-2.5 min-h-[44px]"
                            >
                                <span className="min-w-0 flex-1 text-sm font-medium text-ink-800 dark:text-ink-100 break-words">
                                    {ingredient.name}
                                </span>
                                <span className="text-sm text-ink-500 dark:text-ink-400 whitespace-nowrap tabular-nums">
                                    {ingredient.quantity !== null
                                        && ingredient.quantity !== undefined
                                        && ingredient.quantity !== ''
                                        ? ingredient.quantity
                                        : '—'}
                                </span>
                                {ingredient.price !== null && ingredient.price !== undefined && (
                                    <span className="text-sm font-semibold text-ink-700 dark:text-ink-200 whitespace-nowrap tabular-nums">
                                        {formatMoney(ingredient.price)}
                                    </span>
                                )}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-sm text-ink-500 dark:text-ink-400 mt-2">
                        Автор не указал ингредиенты.
                    </p>
                )}
            </section>

            <section>
                <h3 className="section-title">Шаги приготовления</h3>
                {steps.length > 0 ? (
                    <ol className="mt-2 space-y-2">
                        {steps.map((step, index) => (
                            <li
                                key={step.id ?? `step-${index}`}
                                className="flex gap-3 rounded-2xl bg-ink-50 dark:bg-ink-850 p-3"
                            >
                                <span className="w-7 h-7 rounded-full bg-primary-100 dark:bg-primary-500/20 text-primary-700 dark:text-primary-300 text-xs font-extrabold flex items-center justify-center flex-shrink-0">
                                    {index + 1}
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="block text-sm text-ink-700 dark:text-ink-200 whitespace-pre-line break-words">
                                        {step.text || '—'}
                                    </span>
                                    {step.photo_url && (
                                        <PreviewImage
                                            src={step.photo_url}
                                            alt={`Фото шага ${index + 1}`}
                                            className="mt-2 w-full max-h-48 object-cover rounded-xl border border-ink-200 dark:border-ink-700"
                                        />
                                    )}
                                </span>
                            </li>
                        ))}
                    </ol>
                ) : instructionLines.length > 0 ? (
                    <ol className="mt-2 space-y-2 list-decimal list-inside marker:font-bold marker:text-primary-600 dark:marker:text-primary-400">
                        {instructionLines.map((line, index) => (
                            <li key={`instruction-${index}`} className="text-sm text-ink-700 dark:text-ink-200 py-1">
                                {line}
                            </li>
                        ))}
                    </ol>
                ) : (
                    <p className="text-sm text-ink-500 dark:text-ink-400 mt-2">
                        Автор не описал шаги приготовления.
                    </p>
                )}
            </section>

            {totalPrice !== null && totalPrice !== undefined && (
                <div className="flex items-baseline justify-between gap-2 pt-3 border-t border-dashed border-ink-300 dark:border-ink-700">
                    <span className="text-sm text-ink-500 dark:text-ink-400">Стоимость ингредиентов</span>
                    <span className="font-display text-lg font-extrabold text-primary-600 dark:text-primary-400 tabular-nums">
                        {formatMoney(totalPrice)}
                    </span>
                </div>
            )}
        </div>
    );
}

function BasketContent({ task, data }) {
    const preview = task.preview || {};
    const basket = data || {};
    const items = Array.isArray(basket.items)
        ? basket.items
        : Array.isArray(preview.items)
            ? preview.items
            : [];
    const itemsTotal = items.reduce((sum, item) => {
        const price = Number(item.price);
        return Number.isFinite(price) ? sum + price : sum;
    }, 0);
    const hasItemPrices = items.some((item) => item.price !== null && item.price !== undefined);
    const total = basket.total_price ?? preview.price ?? (hasItemPrices ? itemsTotal : null);
    const pricesDate = basket.prices_date || preview.prices_date;
    const description = basket.description || preview.description;
    const servings = basket.servings ?? preview.servings;

    return (
        <div className="space-y-5">
            <DescriptionBlock text={description} />

            <section>
                <h3 className="section-title">
                    Состав набора
                    <span className="tag">{items.length}</span>
                </h3>
                {items.length > 0 ? (
                    <ul className="mt-2 divide-y divide-ink-100 dark:divide-ink-800">
                        {items.map((item, index) => (
                            <li
                                key={item.id ?? `${item.name}-${index}`}
                                className="flex items-start gap-3 py-2.5 min-h-[44px]"
                            >
                                <span className="w-7 h-7 rounded-full bg-ink-100 dark:bg-ink-800 text-ink-500 dark:text-ink-400 text-xs font-bold flex items-center justify-center flex-shrink-0">
                                    {index + 1}
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="block text-sm font-semibold text-ink-800 dark:text-ink-100 break-words">
                                        {item.name}
                                    </span>
                                    <span className="block text-xs text-ink-500 dark:text-ink-400 mt-0.5">
                                        {[formatQuantity(item.quantity, item.unit), item.shop_name]
                                            .filter(Boolean)
                                            .join(' · ') || 'Количество не указано'}
                                    </span>
                                </span>
                                <span className="text-sm font-semibold text-ink-700 dark:text-ink-200 whitespace-nowrap tabular-nums">
                                    {item.price !== null && item.price !== undefined ? formatMoney(item.price) : '—'}
                                </span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-sm text-ink-500 dark:text-ink-400 mt-2">
                        Позиции набора не загрузились. Полное содержимое доступно в карточке набора.
                    </p>
                )}
            </section>

            <section className="rounded-2xl bg-ink-50 dark:bg-ink-850 p-3 sm:p-4">
                <div className="flex items-baseline justify-between gap-2 text-sm py-0.5">
                    <span className="text-ink-500 dark:text-ink-400">Позиций</span>
                    <span className="font-semibold text-ink-800 dark:text-ink-100 tabular-nums">
                        {basket.items_count ?? items.length}
                    </span>
                </div>
                {servings !== null && servings !== undefined && (
                    <div className="flex items-baseline justify-between gap-2 text-sm py-0.5">
                        <span className="text-ink-500 dark:text-ink-400">На человек</span>
                        <span className="font-semibold text-ink-800 dark:text-ink-100 tabular-nums">
                            {servings}
                        </span>
                    </div>
                )}
                {pricesDate && (
                    <div className="flex items-baseline justify-between gap-2 text-sm py-0.5">
                        <span className="text-ink-500 dark:text-ink-400">Цены на</span>
                        <span className="font-semibold text-ink-800 dark:text-ink-100 tabular-nums">
                            {formatDate(pricesDate)}
                        </span>
                    </div>
                )}
                <div className="flex items-baseline justify-between gap-2 pt-2 mt-2 border-t border-dashed border-ink-300 dark:border-ink-700">
                    <span className="text-sm font-semibold text-ink-700 dark:text-ink-200">Итого</span>
                    <span className="font-display text-2xl font-extrabold text-primary-600 dark:text-primary-400 tabular-nums">
                        {formatMoney(total)}
                    </span>
                </div>
            </section>

            {basket.receipt_photo_url && (
                <section>
                    <h3 className="section-title">Фото чека</h3>
                    <PreviewImage
                        src={basket.receipt_photo_url}
                        alt="Фото чека"
                        className="mt-2 w-full max-h-64 object-contain rounded-2xl border border-ink-200 dark:border-ink-700 bg-ink-50 dark:bg-ink-850"
                    />
                </section>
            )}
        </div>
    );
}

function AutoFlags({ flags }) {
    return (
        <section>
            <h3 className="section-title">Автофлаги</h3>
            {flags.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 mt-2">
                    {flags.map((flag) => (
                        <span
                            key={flag}
                            className={`tag ${DANGEROUS_FLAGS.includes(flag)
                                ? 'bg-hot-50 text-hot-600 dark:bg-hot-600/15 dark:text-hot-400'
                                : ''}`}
                        >
                            {FLAG_LABELS[flag] || flag}
                        </span>
                    ))}
                </div>
            ) : (
                <p className="text-sm text-ink-500 dark:text-ink-400 mt-1">
                    ✅ Автопроверка не нашла замечаний — смотрите содержимое вручную.
                </p>
            )}
        </section>
    );
}

function DecisionPanel({
    task,
    decision,
    busy,
    reason,
    onReason,
    comment,
    onComment,
    onConfirm,
    onCancel,
    error,
}) {
    const title = taskTitle(task);
    const isReject = decision === 'reject';
    const isApprove = decision === 'approve';

    const heading = isApprove
        ? `Опубликовать «${title}»?`
        : isReject
            ? `Отклонить «${title}»?`
            : `Отправить «${title}» на доработку?`;

    const hint = isApprove
        ? 'Публикация сразу появится в ленте, автор получит уведомление об одобрении.'
        : isReject
            ? 'Автор увидит причину и комментарий. Отклонённую публикацию нельзя вернуть в очередь.'
            : 'Автор получит комментарий и сможет исправить публикацию.';

    const confirmLabel = isApprove
        ? 'Да, опубликовать'
        : isReject
            ? 'Подтвердить отклонение'
            : 'Отправить на доработку';

    const busyLabel = isApprove
        ? 'Публикуем…'
        : isReject
            ? 'Отклоняем…'
            : 'Отправляем…';

    return (
        <div
            className={`rounded-2xl border p-3 sm:p-4 ${
                isReject
                    ? 'bg-hot-50 dark:bg-hot-600/10 border-hot-200 dark:border-hot-600/30'
                    : 'bg-primary-50 dark:bg-primary-500/10 border-primary-200 dark:border-primary-500/30'
            }`}
        >
            <p className="text-sm font-bold text-ink-900 dark:text-white">{heading}</p>
            <p className="text-xs text-ink-500 dark:text-ink-400 mt-1">{hint}</p>

            {isReject && (
                <>
                    <label className="label mt-3" htmlFor={`moderation-reason-${task.id}`}>
                        Причина отклонения
                    </label>
                    <select
                        id={`moderation-reason-${task.id}`}
                        className={`input ${error && !reason ? 'input-error' : ''}`}
                        value={reason}
                        onChange={(event) => onReason(event.target.value)}
                        required
                    >
                        <option value="">Выберите причину…</option>
                        {REJECT_REASONS.map((item) => (
                            <option key={item.code} value={item.code}>
                                {item.label}
                            </option>
                        ))}
                    </select>
                </>
            )}

            {!isApprove && (
                <>
                    <label className="label mt-3" htmlFor={`moderation-comment-${task.id}`}>
                        {isReject ? 'Комментарий для автора' : 'Что доработать'}{' '}
                        <span className="font-normal text-ink-400 dark:text-ink-500">(необязательно)</span>
                    </label>
                    <textarea
                        id={`moderation-comment-${task.id}`}
                        className="input min-h-[88px]"
                        rows={3}
                        value={comment}
                        onChange={(event) => onComment(event.target.value)}
                        placeholder={
                            isReject
                                ? 'Что именно нарушено — например, ссылка на сторонний магазин'
                                : 'Например: добавьте фото готового блюда и уточните количество ингредиентов'
                        }
                    />
                </>
            )}

            {error && (
                <p role="alert" aria-live="assertive" className="text-sm font-semibold text-hot-600 dark:text-hot-400 mt-3">
                    ⚠️ {error}
                </p>
            )}

            <div className="flex flex-col sm:flex-row gap-2 mt-3">
                <button
                    type="button"
                    onClick={onConfirm}
                    disabled={busy}
                    className={`btn-primary min-h-[48px] flex-1 ${isReject
                        ? '!bg-hot-600 hover:!bg-hot-700 dark:!bg-hot-600 dark:hover:!bg-hot-500'
                        : ''}`}
                >
                    {busy ? busyLabel : confirmLabel}
                </button>
                <button
                    type="button"
                    onClick={onCancel}
                    disabled={busy}
                    className="btn-ghost !min-h-[48px]"
                >
                    Отмена
                </button>
            </div>
        </div>
    );
}

function ReviewCard({
    task,
    onBack,
    busy,
    decision,
    onDecision,
    reason,
    onReason,
    comment,
    onComment,
    onConfirm,
    onCancelDecision,
    actionError,
}) {
    const preview = task.preview || {};
    const data = preview;
    const flags = Array.isArray(task.auto_flags) ? task.auto_flags : [];
    const title = taskTitle(task);
    const username = data.username || preview.username || null;
    const avatarUrl = data.avatar_url || preview.avatar_url || null;
    const authorId = task.author_id ?? data.user_id ?? preview.user_id;
    const createdAt = preview.created_at || data.created_at;
    const photo = data.photo_url || preview.photo_url;
    const basket = isBasketType(task.target_type);

    return (
        <article className="card overflow-hidden animate-fade-in">
            <div className="p-4 sm:p-5 border-b border-ink-200/70 dark:border-ink-800">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                        <span
                            className={`tag ${basket
                                ? 'bg-secondary-50 text-secondary-600 dark:bg-secondary-500/15 dark:text-secondary-300'
                                : 'bg-primary-50 text-primary-700 dark:bg-primary-500/15 dark:text-primary-300'}`}
                        >
                            {typeLabel(task)}
                        </span>
                        <span className="text-[11px] sm:text-xs text-ink-400 dark:text-ink-500 whitespace-nowrap tabular-nums">
                            #{task.target_id} · {formatDateTime(task.created_at)}
                        </span>
                    </div>
                    <button
                        type="button"
                        onClick={onBack}
                        className="btn-ghost !min-h-[44px] !px-2 -mr-2 lg:hidden"
                    >
                        ← К очереди
                    </button>
                </div>

                <h2 className="heading-2 mt-2 break-words">{title}</h2>

                <div className="flex items-center gap-3 mt-3 min-w-0">
                    <AuthorAvatar username={username || 'Автор'} avatarUrl={avatarUrl} />
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-ink-800 dark:text-ink-100 truncate">
                            {username || 'Автор скрыт'}
                        </p>
                        <p className="text-xs text-ink-500 dark:text-ink-400 truncate">
                            Автор{authorId !== null && authorId !== undefined ? ` · #${authorId}` : ''}
                        </p>
                    </div>
                    <span className="tag bg-secondary-50 text-secondary-600 dark:bg-secondary-500/15 dark:text-secondary-300 flex-shrink-0">
                        ⏳ На проверке
                    </span>
                </div>

                <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
                    <div className="min-w-0">
                        <p className="text-ink-400 dark:text-ink-500">Создано автором</p>
                        <p className="font-semibold text-ink-700 dark:text-ink-200 mt-0.5 truncate">
                            {formatDateTime(createdAt)}
                        </p>
                    </div>
                    <div className="min-w-0">
                        <p className="text-ink-400 dark:text-ink-500">В очереди с</p>
                        <p className="font-semibold text-ink-700 dark:text-ink-200 mt-0.5 truncate">
                            {formatDateTime(task.created_at)}
                        </p>
                    </div>
                </div>
            </div>

            <div className="p-4 sm:p-5 space-y-5">
                <AutoFlags flags={flags} />

                <section>
                    <h3 className="section-title">Фото публикации</h3>
                    {photo ? (
                        <PreviewImage
                            src={photo}
                            alt={`Фото: ${title}`}
                            className="mt-2 w-full max-h-72 sm:max-h-80 object-cover rounded-2xl border border-ink-200 dark:border-ink-700 bg-ink-100 dark:bg-ink-800"
                        />
                    ) : (
                        <div className="mt-2 rounded-2xl border border-dashed border-ink-300 dark:border-ink-700 p-6 text-center text-sm text-ink-500 dark:text-ink-400">
                            🖼 Автор не прикрепил фото
                        </div>
                    )}
                </section>

                {task.target_type === 'recipe' ? (
                    <RecipeContent task={task} data={preview} />
                ) : basket ? (
                    <BasketContent task={task} data={preview} />
                ) : (
                    <DescriptionBlock text={preview.description} />
                )}
            </div>

            <div className="p-4 sm:p-5 border-t border-ink-200/70 dark:border-ink-800 bg-ink-50/80 dark:bg-ink-850/50 safe-bottom">
                {decision ? (
                    <DecisionPanel
                        task={task}
                        decision={decision}
                        busy={busy}
                        reason={reason}
                        onReason={onReason}
                        comment={comment}
                        onComment={onComment}
                        onConfirm={onConfirm}
                        onCancel={onCancelDecision}
                        error={actionError}
                    />
                ) : (
                    <>
                        <p className="label mb-2">Решение по публикации</p>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <button
                                type="button"
                                onClick={() => onDecision('approve')}
                                disabled={busy}
                                className="btn-primary min-h-[48px] w-full"
                            >
                                ✅ Одобрить
                            </button>
                            <button
                                type="button"
                                onClick={() => onDecision('reject')}
                                disabled={busy}
                                className="btn-outline min-h-[48px] w-full !border-hot-500 dark:!border-hot-500 !text-hot-600 dark:!text-hot-400 hover:!bg-hot-50 dark:hover:!bg-hot-600/15"
                            >
                                ⛔ Отклонить
                            </button>
                            <button
                                type="button"
                                onClick={() => onDecision('needs_changes')}
                                disabled={busy}
                                className="btn-secondary min-h-[48px] w-full"
                            >
                                ✏️ На доработку
                            </button>
                        </div>
                        <p className="text-[11px] text-ink-400 dark:text-ink-500 mt-2">
                            Действие подтверждается на следующем шаге. Автор получит уведомление.
                        </p>
                    </>
                )}
            </div>
        </article>
    );
}

/* ---------- Страница ---------- */

function ModerationPage() {
    const [authState, setAuthState] = useState('checking');
    const [me, setMe] = useState(null);
    const [sessionNotice, setSessionNotice] = useState('');

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loginError, setLoginError] = useState('');
    const [loginLoading, setLoginLoading] = useState(false);

    const [queue, setQueue] = useState([]);
    const [queueTotal, setQueueTotal] = useState(0);
    const [filter, setFilter] = useState('all');
    const [counts, setCounts] = useState({ all: 0, recipe: 0, basket: 0 });
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [queueError, setQueueError] = useState('');
    const [selectedId, setSelectedId] = useState(null);

    const [busy, setBusy] = useState(false);
    const [decision, setDecision] = useState(null);
    const [rejectReason, setRejectReason] = useState('');
    const [comment, setComment] = useState('');
    const [actionError, setActionError] = useState('');
    const [toast, setToast] = useState(null);

    const queueRequestRef = useRef(0);
    const filterRef = useRef(filter);
    filterRef.current = filter;

    /* Роль проверяем на сервере: localStorage можно подделать. */
    useEffect(() => {
        let alive = true;

        const checkAccess = async () => {
            const token = localStorage.getItem('access_token');

            if (!token) {
                if (alive) setAuthState('guest');
                return;
            }

            try {
                const data = await getAdminWhoami();
                if (!alive) return;

                if (data && data.role) {
                    localStorage.setItem('role', data.role);
                }
                setMe(data || null);

                if (data && isModeratorRole(data.role)) {
                    setLoading(true);
                    setAuthState('ready');
                } else {
                    setAuthState('forbidden');
                }
            } catch (err) {
                if (!alive) return;

                const raw = (err && err.message) || '';
                const expired = /HTTP 401/.test(raw);
                if (expired) clearSession();

                setSessionNotice(
                    expired
                        ? 'Сессия истекла — войдите снова.'
                        : humanizeError(err, 'Не удалось проверить доступ. Войдите снова.')
                );
                setAuthState('guest');
            }
        };

        checkAccess();
        return () => {
            alive = false;
        };
    }, []);

    const loadStats = useCallback(async () => {
        try {
            const data = await getAdminStats();
            setStats(data || null);
        } catch (err) {
            // Метрики — вспомогательные: их сбой не должен блокировать очередь.
            console.error('Не удалось загрузить статистику модерации:', err);
        }
    }, []);

    const loadCounts = useCallback(async () => {
        try {
            const [recipes, baskets] = await Promise.all([
                getModerationQueue('pending', 'recipe', 1, 0),
                getModerationQueue('pending', 'basket', 1, 0),
            ]);
            const recipeTotal = Number(recipes && recipes.total) || 0;
            const basketTotal = Number(baskets && baskets.total) || 0;
            setCounts({
                all: recipeTotal + basketTotal,
                recipe: recipeTotal,
                basket: basketTotal,
            });
        } catch (err) {
            // Счётчики по типам вторичны — очередь уже показывает главное.
            console.error('Не удалось загрузить счётчики очереди:', err);
        }
    }, []);

    const loadQueue = useCallback(async (nextFilter) => {
        // Ответы могут прийти не по порядку при быстром переключении фильтра:
        // применяем только ответ на самый свежий запрос.
        const requestId = queueRequestRef.current + 1;
        queueRequestRef.current = requestId;

        setLoading(true);
        setQueueError('');
        try {
            const slice = await fetchQueueSlice(
                nextFilter,
                nextFilter === 'all' ? { recipe: 0, basket: 0 } : 0
            );
            if (queueRequestRef.current !== requestId) return;

            setQueue(slice.items);
            setQueueTotal(slice.total);
            setSelectedId((prev) => (slice.items.some((item) => item.id === prev) ? prev : null));
        } catch (err) {
            if (queueRequestRef.current !== requestId) return;
            setQueueError(humanizeError(err, 'Не удалось загрузить очередь проверки.'));
            setQueue([]);
            setQueueTotal(0);
            setSelectedId(null);
        } finally {
            if (queueRequestRef.current === requestId) setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (authState !== 'ready') return;
        loadStats();
        loadCounts();
    }, [authState, loadStats, loadCounts]);

    useEffect(() => {
        if (authState !== 'ready') return;
        loadQueue(filter);
    }, [authState, filter, loadQueue]);

    useEffect(() => {
        if (!toast) return undefined;
        const timer = window.setTimeout(() => setToast(null), 4500);
        return () => window.clearTimeout(timer);
    }, [toast]);

    const selectedTask = useMemo(
        () => queue.find((task) => task.id === selectedId) || null,
        [queue, selectedId]
    );

    const announce = (text) => setToast({ text });

    const refreshWorkplace = () => {
        loadQueue(filter);
        loadStats();
        loadCounts();
    };

    const handleFilter = (nextFilter) => {
        if (nextFilter === filter) return;
        setFilter(nextFilter);
        setSelectedId(null);
        setDecision(null);
        setActionError('');
        setComment('');
        setRejectReason('');
        setQueue([]);
        setQueueTotal(0);
        setLoading(true);
    };

    const handleSelect = (taskId) => {
        if (taskId === selectedId) return;
        setSelectedId(taskId);
        setDecision(null);
        setActionError('');
        setComment('');
        setRejectReason('');
    };

    const handleBackToQueue = () => {
        setSelectedId(null);
        setDecision(null);
        setActionError('');
    };

    const handleLogin = async (event) => {
        event.preventDefault();
        if (loginLoading) return;

        setLoginLoading(true);
        setLoginError('');
        setSessionNotice('');

        try {
            await login(email.trim(), password);
            window.dispatchEvent(new Event('authChange'));

            const whoami = await getAdminWhoami();
            if (whoami && whoami.role) {
                localStorage.setItem('role', whoami.role);
            }
            setMe(whoami || null);
            setPassword('');

            if (whoami && isModeratorRole(whoami.role)) {
                setLoading(true);
                setAuthState('ready');
                window.dispatchEvent(new Event('authChange'));
            } else {
                setAuthState('forbidden');
            }
        } catch (err) {
            const raw = (err && err.message) || '';
            if (/HTTP 401/.test(raw)) clearSession();
            setLoginError(
                /HTTP 401/.test(raw)
                    ? 'Неверный email или пароль.'
                    : humanizeError(err, 'Не удалось войти. Проверьте email и пароль.')
            );
        } finally {
            setLoginLoading(false);
        }
    };

    const handleLogout = () => {
        clearSession();
        window.dispatchEvent(new Event('authChange'));

        queueRequestRef.current += 1;
        setLoading(false);
        setLoadingMore(false);
        setMe(null);
        setAuthState('guest');
        setSessionNotice('');
        setLoginError('');
        setLoginLoading(false);
        setPassword('');
        setQueue([]);
        setQueueTotal(0);
        setCounts({ all: 0, recipe: 0, basket: 0 });
        setStats(null);
        setSelectedId(null);
        setFilter('all');
        setDecision(null);
        setRejectReason('');
        setComment('');
        setActionError('');
        setToast(null);
    };

    const removeTask = (task, kind) => {
        const basketTask = isBasketType(task.target_type);
        const nextQueue = queue.filter((item) => item.id !== task.id);

        setQueue(nextQueue);
        setQueueTotal((prev) => Math.max(0, prev - 1));
        setCounts((prev) => ({
            all: Math.max(0, prev.all - 1),
            recipe: task.target_type === 'recipe' ? Math.max(0, prev.recipe - 1) : prev.recipe,
            basket: basketTask ? Math.max(0, prev.basket - 1) : prev.basket,
        }));

        setStats((prev) => {
            if (!prev) return prev;
            const pending = Number(prev.queue_pending ?? prev.queue ?? prev.pending ?? 0);
            const next = { ...prev };
            next.queue = Math.max(0, pending - 1);
            next.queue_pending = Math.max(0, pending - 1);
            next.pending = Math.max(0, pending - 1);
            if (kind === 'approve') {
                next.approved_24h = (Number(prev.approved_24h) || 0) + 1;
            }
            if (kind === 'reject') {
                next.rejected_24h = (Number(prev.rejected_24h) || 0) + 1;
            }
            if (kind === 'needs_changes') {
                next.needs_changes_24h = (Number(prev.needs_changes_24h) || 0) + 1;
            }
            return next;
        });

        if (selectedId === task.id) {
            setSelectedId(null);
            setDecision(null);
            setActionError('');
            setComment('');
            setRejectReason('');
        }

        announce(SUCCESS_MESSAGES[kind] || 'Решение сохранено');

        // Счётчики сверяем с сервером в фоне; интерфейс уже обновился.
        loadStats();
        loadCounts();

        // Если страница очереди опустела, а задачи ещё есть — подгружаем следующую.
        if (nextQueue.length === 0 && queueTotal > 1) {
            loadQueue(filter);
        }
    };

    const handleConfirmDecision = async () => {
        if (!selectedTask || !decision || busy) return;

        if (decision === 'reject' && !rejectReason) {
            setActionError('Выберите причину отклонения — без неё отклонить публикацию нельзя.');
            return;
        }

        setBusy(true);
        setActionError('');

        try {
            const task = selectedTask;
            const kind = decision;

            if (kind === 'approve') {
                await approveModerationTask(task.id);
            } else if (kind === 'reject') {
                await rejectModerationTask(task.id, rejectReason, comment.trim() || null);
            } else {
                await needsChangesModerationTask(task.id, comment.trim() || null);
            }

            removeTask(task, kind);
        } catch (err) {
            setActionError(humanizeError(err, 'Не удалось сохранить решение. Попробуйте ещё раз.'));
        } finally {
            setBusy(false);
        }
    };

    const cancelDecision = () => {
        setDecision(null);
        setActionError('');
        setComment('');
        setRejectReason('');
    };

    const handleLoadMore = async () => {
        if (loadingMore || loading) return;

        const currentFilter = filter;
        const skip = currentFilter === 'all'
            ? {
                recipe: queue.filter((task) => task.target_type === 'recipe').length,
                basket: queue.filter((task) => isBasketType(task.target_type)).length,
            }
            : queue.length;

        setLoadingMore(true);
        setQueueError('');
        try {
            const slice = await fetchQueueSlice(currentFilter, skip);
            if (filterRef.current !== currentFilter) return;

            setQueue((prev) => mergeTasks([prev, slice.items]));
            setQueueTotal(slice.total);
        } catch (err) {
            if (filterRef.current !== currentFilter) return;
            setQueueError(humanizeError(err, 'Не удалось загрузить следующую часть очереди.'));
        } finally {
            setLoadingMore(false);
        }
    };

    /* ---------- Экраны авторизации ---------- */

    if (authState === 'checking') {
        return <CheckingAccess />;
    }

    if (authState === 'guest') {
        return (
            <LoginDoor
                email={email}
                password={password}
                onEmail={setEmail}
                onPassword={setPassword}
                onSubmit={handleLogin}
                loading={loginLoading}
                error={loginError}
                notice={sessionNotice}
            />
        );
    }

    if (authState === 'forbidden') {
        return <ForbiddenDoor me={me} onLogout={handleLogout} />;
    }

    /* ---------- Рабочее место ---------- */

    const pending = counts.all || queueTotal;

    const filterCount = (key) => {
        if (key === 'all') return pending;
        return counts[key] || 0;
    };

    return (
        <div className="max-w-6xl mx-auto pb-bottom-nav animate-fade-in">
            <header className="flex flex-wrap items-start justify-between gap-3 mb-3 sm:mb-4">
                <div className="flex items-center gap-3 min-w-0">
                    <span
                        className="w-11 h-11 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 text-white text-xl flex items-center justify-center shadow-brand flex-shrink-0"
                        aria-hidden="true"
                    >
                        🛡️
                    </span>
                    <div className="min-w-0">
                        <h1 className="heading-2">Модерация</h1>
                        <p className="text-xs sm:text-sm text-ink-500 dark:text-ink-400 mt-0.5">
                            Проверка новых рецептов и наборов
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-1 sm:gap-2 ml-auto">
                    <Link
                        to="/admin"
                        className="btn-ghost !min-h-[44px] text-xs sm:text-sm text-ink-500 dark:text-ink-400"
                    >
                        <span className="hidden sm:inline">Расширенная админка</span>
                        <span className="sm:hidden">Админка</span>
                        <span aria-hidden="true">→</span>
                    </Link>
                    <button
                        type="button"
                        onClick={refreshWorkplace}
                        disabled={loading}
                        className="btn-secondary !min-h-[44px] !px-3 sm:!px-4"
                        aria-label="Обновить очередь проверки"
                    >
                        <span aria-hidden="true">🔄</span>
                        <span className="hidden sm:inline">Обновить</span>
                    </button>
                    <button
                        type="button"
                        onClick={handleLogout}
                        className="btn-ghost !min-h-[44px] !px-2"
                        aria-label="Выйти из аккаунта модератора"
                        title="Выйти"
                    >
                        🚪
                    </button>
                </div>
            </header>

            <section className="card p-3 sm:p-4 mb-3" aria-label="Счётчики модерации">
                {loading && !stats && counts.all === 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" aria-hidden="true">
                        {[0, 1, 2, 3].map((item) => (
                            <div key={item} className="space-y-2">
                                <div className="skeleton h-6 w-12" />
                                <div className="skeleton h-3 w-16" />
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <Counter label="На проверке" value={pending} />
                        <Counter
                            label="Рецепты"
                            value={filterCount('recipe')}
                            tone="text-primary-600 dark:text-primary-400"
                        />
                        <Counter
                            label="Наборы"
                            value={filterCount('basket')}
                            tone="text-secondary-600 dark:text-secondary-300"
                        />
                        <Counter
                            label="Одобрено за 24 ч"
                            value={stats ? Number(stats.approved_24h) || 0 : 0}
                        />
                    </div>
                )}
            </section>

            {toast && (
                <div
                    role="status"
                    aria-live="polite"
                    className="card p-3 mb-3 border-primary-200 dark:border-primary-500/30 bg-primary-50/80 dark:bg-primary-500/10 flex items-start gap-2 animate-fade-in"
                >
                    <span aria-hidden="true">✅</span>
                    <p className="text-sm font-semibold text-primary-700 dark:text-primary-300 flex-1 min-w-0">
                        {toast.text}
                    </p>
                    <button
                        type="button"
                        onClick={() => setToast(null)}
                        className="btn-ghost !min-h-[44px] !px-2 -my-1 -mr-1"
                        aria-label="Скрыть сообщение"
                    >
                        ✕
                    </button>
                </div>
            )}

            <div
                className="hscroll mb-3 -mx-3 px-3 sm:mx-0 sm:px-0"
                role="group"
                aria-label="Фильтр по типу публикации"
            >
                {FILTERS.map((item) => (
                    <button
                        key={item.key}
                        type="button"
                        onClick={() => handleFilter(item.key)}
                        aria-pressed={filter === item.key}
                        className={`chip min-h-[44px] px-4 ${filter === item.key ? 'chip-active' : ''}`}
                    >
                        {item.label}
                        <span className="text-[11px] font-extrabold tabular-nums opacity-80">
                            {filterCount(item.key)}
                        </span>
                    </button>
                ))}
            </div>

            <div className="grid gap-3 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:items-start">
                <section
                    className={selectedTask ? 'hidden lg:block' : ''}
                    aria-label="Очередь публикаций на проверку"
                    aria-busy={loading}
                >
                    <div className="flex items-center justify-between gap-2 mb-2 px-0.5">
                        <h2 className="section-title">Очередь</h2>
                        <span className="text-xs text-ink-400 dark:text-ink-500 tabular-nums">
                            {loading ? 'загрузка…' : `${queue.length} из ${queueTotal}`}
                        </span>
                    </div>

                    {queueError ? (
                        <div className="card p-4 border-hot-200 dark:border-hot-600/30 bg-hot-50/60 dark:bg-hot-600/10">
                            <p role="alert" className="text-sm font-semibold text-hot-600 dark:text-hot-400">
                                ⚠️ {queueError}
                            </p>
                            <button
                                type="button"
                                onClick={refreshWorkplace}
                                className="btn-secondary min-h-[44px] mt-3"
                            >
                                Повторить
                            </button>
                        </div>
                    ) : loading ? (
                        <QueueSkeleton />
                    ) : queue.length === 0 ? (
                        <EmptyQueue
                            filter={filter}
                            counts={counts}
                            onReset={() => handleFilter('all')}
                            onRefresh={refreshWorkplace}
                        />
                    ) : (
                        <>
                            <ul className="space-y-2.5">
                                {queue.map((task) => (
                                    <QueueCard
                                        key={task.id}
                                        task={task}
                                        active={task.id === selectedId}
                                        onSelect={handleSelect}
                                    />
                                ))}
                            </ul>

                            {queue.length < queueTotal && (
                                <button
                                    type="button"
                                    onClick={handleLoadMore}
                                    disabled={loadingMore}
                                    className="btn-secondary w-full min-h-[44px] mt-3"
                                >
                                    {loadingMore
                                        ? 'Загружаем…'
                                        : `Показать ещё (${Math.max(0, queueTotal - queue.length)})`}
                                </button>
                            )}
                        </>
                    )}
                </section>

                <section
                    className={selectedTask ? 'min-w-0' : 'hidden lg:block min-w-0'}
                    aria-label="Карточка проверки публикации"
                >
                    {selectedTask ? (
                        <ReviewCard
                            task={selectedTask}
                            onBack={handleBackToQueue}
                            busy={busy}
                            decision={decision}
                            onDecision={setDecision}
                            reason={rejectReason}
                            onReason={(value) => {
                                setRejectReason(value);
                                if (actionError) setActionError('');
                            }}
                            comment={comment}
                            onComment={(value) => {
                                setComment(value);
                                if (actionError) setActionError('');
                            }}
                            onConfirm={handleConfirmDecision}
                            onCancelDecision={cancelDecision}
                            actionError={actionError}
                        />
                    ) : (
                        <div className="card p-8 text-center">
                            <div
                                className="w-16 h-16 mx-auto rounded-3xl bg-ink-100 dark:bg-ink-800 flex items-center justify-center text-3xl mb-3"
                                aria-hidden="true"
                            >
                                🧾
                            </div>
                            <h2 className="heading-3">Выберите публикацию</h2>
                            <p className="text-sm text-ink-500 dark:text-ink-400 mt-2 max-w-sm mx-auto">
                                Слева — очередь проверки. Откройте карточку, чтобы увидеть автора,
                                автофлаги, содержимое и принять решение.
                            </p>
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
}

export default ModerationPage;
