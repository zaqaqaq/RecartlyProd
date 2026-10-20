import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
    deleteNotification,
    getNotifications,
    markAllNotificationsRead,
    markNotificationRead,
} from '../services/smeta';
import { mediaUrl } from '../utils/media';

/** Эмодзи по типу уведомления. */
const TYPE_ICONS = {
    comment: '💬',
    reply: '↩️',
    reaction: '❤️',
    moderation: '🛡️',
    achievement: '🏆',
    price_drop: '📉',
    basket_checked: '✅',
    challenge: '🎯',
    system: 'ℹ️',
};

/**
 * Куда ведёт клик по уведомлению.
 * Типы `cart` и `review` больше не существуют: корзины сообщества стали наборами,
 * а отзывы слились в комментарии. Старые уведомления таких типов просто не открываем.
 */
const targetPath = (item) => {
    const id = item && item.target_id;
    switch (item && item.target_type) {
        case 'recipe':
            return id ? `/recipe/${id}` : null;
        case 'cart':
            return id ? `/basket/${id}` : null;
        case 'basket':
            return id ? `/basket/${id}` : null;
        case 'promo':
            return id ? `/promos/${id}` : null;
        case 'review':
            return null;
        case 'challenge':
            return '/challenges';
        case 'user':
            return '/profile';
        default:
            return null;
    }
};

/** Относительное время: «только что», «5 мин. назад», «вчера», «3 дн. назад». */
function formatRelativeTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';

    const diffMinutes = Math.floor((Date.now() - date.getTime()) / 60000);
    if (diffMinutes < 1) return 'только что';
    if (diffMinutes < 60) return `${diffMinutes} мин. назад`;

    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours} ч. назад`;

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return 'вчера';
    if (diffDays < 7) return `${diffDays} дн. назад`;

    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

const avatarText = (username) => (username ? username[0].toUpperCase() : '?');

/** Аватар актора: картинка, эмодзи-аватар из профиля или первая буква ника. */
function ActorAvatar({ avatarUrl, username }) {
    if (avatarUrl && avatarUrl.startsWith('emoji:')) {
        const parts = avatarUrl.split(':');
        return (
            <span className={`avatar w-10 h-10 text-base ${parts[2] || 'bg-primary-100'} ${parts[3] || 'text-primary-600'}`}>
                {parts[1]}
            </span>
        );
    }

    if (avatarUrl) {
        return (
            <img
                src={mediaUrl(avatarUrl)}
                alt={username || 'Аватар'}
                className="avatar w-10 h-10 object-cover"
            />
        );
    }

    return <span className="avatar w-10 h-10 text-sm">{avatarText(username)}</span>;
}

/** Уведомления: лента активности по рецептам, сметам, челленджам и модерации. */
function NotificationsPage() {
    const navigate = useNavigate();
    const isAuthenticated = Boolean(localStorage.getItem('access_token'));

    const [tab, setTab] = useState('all');
    const [items, setItems] = useState([]);
    const [unread, setUnread] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    // Колокольчик в шапке слушает это событие и сразу обновляет счётчик
    const notifyBell = () => window.dispatchEvent(new Event('notificationsChange'));

    const load = useCallback(async () => {
        if (!isAuthenticated) {
            setLoading(false);
            return;
        }

        setLoading(true);
        try {
            const data = await getNotifications({
                unreadOnly: tab === 'unread',
                limit: 50,
            });
            setItems((data && data.items) || []);
            setUnread(Number(data && data.unread) || 0);
            setError('');
        } catch (err) {
            if (String(err.message).includes('401')) {
                navigate('/login');
                return;
            }
            setError(err.message || 'Не удалось загрузить уведомления');
        } finally {
            setLoading(false);
        }
    }, [isAuthenticated, tab, navigate]);

    useEffect(() => {
        load();
    }, [load]);

    /** Клик по карточке: отметить прочитанным и уйти на связанный объект. */
    const handleOpen = async (item) => {
        const path = targetPath(item);

        if (!item.is_read) {
            setItems((prev) =>
                tab === 'unread'
                    ? prev.filter((row) => row.id !== item.id)
                    : prev.map((row) => (row.id === item.id ? { ...row, is_read: true } : row))
            );
            setUnread((prev) => Math.max(0, prev - 1));

            try {
                await markNotificationRead(item.id);
            } catch (err) {
                setError(err.message || 'Не удалось отметить уведомление прочитанным');
            }
            notifyBell();
        }

        if (path) navigate(path);
    };

    const handleReadAll = async () => {
        setBusy(true);
        try {
            await markAllNotificationsRead();
            setUnread(0);
            setItems((prev) => prev.map((row) => ({ ...row, is_read: true })));
            notifyBell();
            await load();
        } catch (err) {
            setError(err.message || 'Не удалось прочитать все уведомления');
        } finally {
            setBusy(false);
        }
    };

    const handleDelete = async (item) => {
        try {
            await deleteNotification(item.id);
            setItems((prev) => prev.filter((row) => row.id !== item.id));
            if (!item.is_read) setUnread((prev) => Math.max(0, prev - 1));
            notifyBell();
        } catch (err) {
            setError(err.message || 'Не удалось удалить уведомление');
        }
    };

    const renderBody = () => {
        if (!isAuthenticated) {
            return (
                <div className="card p-6 text-center">
                    <div className="w-14 h-14 mx-auto rounded-3xl bg-primary-100 dark:bg-primary-900/25 flex items-center justify-center text-2xl mb-3">
                        🔔
                    </div>
                    <p className="text-ink-600 dark:text-ink-400 mb-4">
                        Войдите, чтобы видеть уведомления о реакциях, сметах и наградах.
                    </p>
                    <Link to="/login" className="btn-primary">Войти</Link>
                </div>
            );
        }

        if (loading) {
            return (
                <div className="space-y-3">
                    <div className="skeleton h-20" />
                    <div className="skeleton h-20" />
                    <div className="skeleton h-20" />
                </div>
            );
        }

        if (items.length === 0) {
            return (
                <div className="card p-6 text-center">
                    <div className="w-14 h-14 mx-auto rounded-3xl bg-primary-100 dark:bg-primary-900/25 flex items-center justify-center text-2xl mb-3">
                        {tab === 'unread' ? '✅' : '🔔'}
                    </div>
                    <p className="text-ink-600 dark:text-ink-400">
                        {tab === 'unread' ? 'Все прочитано' : 'Пока нет уведомлений'}
                    </p>
                    {tab === 'unread' && (
                        <button
                            type="button"
                            onClick={() => setTab('all')}
                            className="btn-secondary mt-4"
                        >
                            Показать все
                        </button>
                    )}
                </div>
            );
        }

        return (
            <div className="space-y-3">
                {items.map((item) => {
                    const isUnread = !item.is_read;
                    const icon = TYPE_ICONS[item.type] || 'ℹ️';

                    return (
                        <article
                            key={item.id}
                            className={`card card-hover relative p-3.5 ${
                                isUnread
                                    ? 'border-l-4 border-primary-500 bg-primary-50/40 dark:bg-primary-500/10'
                                    : ''
                            }`}
                        >
                            <button
                                type="button"
                                onClick={() => handleOpen(item)}
                                className="w-full text-left flex items-start gap-3 pr-7"
                            >
                                <ActorAvatar
                                    avatarUrl={item.actor_avatar_url}
                                    username={item.actor_username}
                                />

                                <div className="min-w-0 flex-1">
                                    <div className="flex items-start justify-between gap-2">
                                        <h2 className="font-bold text-sm text-ink-900 dark:text-white">
                                            <span className="mr-1" aria-hidden="true">{icon}</span>
                                            {item.title}
                                        </h2>
                                        <span className="text-[11px] text-ink-400 dark:text-ink-500 whitespace-nowrap">
                                            {formatRelativeTime(item.created_at)}
                                        </span>
                                    </div>

                                    {item.body && (
                                        <p className="text-sm text-ink-600 dark:text-ink-300 mt-1 line-clamp-2">
                                            {item.body}
                                        </p>
                                    )}

                                    {item.actor_username && (
                                        <p className="text-[11px] text-ink-400 dark:text-ink-500 mt-1">
                                            @{item.actor_username}
                                            {isUnread && (
                                                <span className="ml-2 text-primary-600 dark:text-primary-400 font-bold">
                                                    новое
                                                </span>
                                            )}
                                        </p>
                                    )}
                                </div>
                            </button>

                            <button
                                type="button"
                                onClick={() => handleDelete(item)}
                                aria-label={`Удалить уведомление: ${item.title}`}
                                title="Удалить"
                                className="absolute top-2 right-2 w-8 h-8 rounded-full flex items-center justify-center
                                text-ink-400 dark:text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800
                                hover:text-hot-600 dark:hover:text-hot-400 active:scale-95 transition-colors
                                text-sm leading-none"
                            >
                                ✕
                            </button>
                        </article>
                    );
                })}
            </div>
        );
    };

    return (
        <div className="max-w-2xl mx-auto animate-fade-in pb-bottom-nav">
            <header className="mb-4">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary-100 dark:bg-primary-900/25 text-primary-700 dark:text-primary-300 text-[11px] font-bold uppercase tracking-wide">
                    🔔 уведомления
                </span>
                <h1 className="heading-1 mt-2">Уведомления</h1>
                <p className="text-sm text-ink-500 dark:text-ink-400 mt-1.5">
                    Реакции, ответы, проверки смет, награды и изменения цен — всё в одном месте.
                </p>
            </header>

            {isAuthenticated && (
                <>
                    <div className="hscroll mb-3">
                        <button
                            type="button"
                            onClick={() => setTab('all')}
                            className={`tab-pill ${tab === 'all' ? 'tab-pill-active' : ''}`}
                        >
                            Все
                        </button>
                        <button
                            type="button"
                            onClick={() => setTab('unread')}
                            className={`tab-pill ${tab === 'unread' ? 'tab-pill-active' : ''}`}
                        >
                            Непрочитанные
                            {unread > 0 && (
                                <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-hot-500 text-white text-[10px] font-bold flex items-center justify-center">
                                    {unread > 99 ? '99+' : unread}
                                </span>
                            )}
                        </button>
                    </div>

                    {unread > 0 && (
                        <div className="flex justify-end mb-3">
                            <button
                                type="button"
                                onClick={handleReadAll}
                                disabled={busy}
                                className="btn-secondary !min-h-[40px] !px-3.5 text-sm"
                            >
                                {busy ? 'Отмечаем…' : 'Прочитать все'}
                            </button>
                        </div>
                    )}
                </>
            )}

            {error && <p className="text-sm text-hot-600 dark:text-hot-400 mb-3">{error}</p>}

            {renderBody()}
        </div>
    );
}

export default NotificationsPage;
