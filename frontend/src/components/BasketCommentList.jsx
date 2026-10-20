import React, { useState } from 'react';
import { deleteBasketComment, reactToComment } from '../services/smeta';
import { mediaUrl } from '../utils/media';
import { formatCount } from './BasketCard';

/* ============================================================
   Обсуждение набора: комментарии с реакциями, ответами и удалением.

   Backend отдаёт по каждому комментарию:
     { id, text, parent_id, user_id, username, avatar_url, created_at,
       reactions: { '🔥': 3 }, my_reaction: '🔥' | null, is_mine: bool }

   `is_mine` = true и для автора комментария, и для модератора, поэтому
   право на удаление берём из флага, а не вычисляем на клиенте.
   ============================================================ */

/**
 * Ряд реакций. Порядок и состав согласованы с backend
 * (`BasketCommentReactionIn`: строка эмодзи до 8 символов).
 */
export const COMMENT_REACTIONS = ['👍', '❤️', '🔥', '😋'];

/** Подписи для скринридера: эмодзи сам по себе ничего не сообщает. */
const REACTION_TITLES = {
    '👍': 'нравится',
    '❤️': 'люблю',
    '🔥': 'огонь',
    '😋': 'вкусно',
};

/**
 * Аватар автора комментария: поддерживает формат 'emoji:😀:bg-…:text-…'
 * из профиля и обычный путь из /uploads. Битое фото заменяем буквой.
 */
function CommentAvatar({ username, avatarUrl }) {
    const [broken, setBroken] = useState(false);
    const initial = username ? username[0].toUpperCase() : '?';

    if (avatarUrl && avatarUrl.startsWith('emoji:')) {
        const [, emoji, bg = 'bg-primary-100 dark:bg-primary-900/30', text = 'text-primary-600 dark:text-primary-300'] =
            avatarUrl.split(':');
        return (
            <span className={`avatar w-7 h-7 text-xs ${bg} ${text}`} aria-hidden="true">
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
                className="avatar w-7 h-7 text-xs object-cover"
            />
        );
    }

    return (
        <span className="avatar w-7 h-7 text-xs" aria-hidden="true">
            {initial}
        </span>
    );
}

/**
 * Пересчитывает реакции локально — до ответа сервера.
 * Повторный клик тем же эмодзи снимает реакцию, другой эмодзи заменяет прежнюю
 * (так же ведёт себя `POST /baskets/{id}/comments/{cid}/reactions`).
 */
function withToggledReaction(comment, emoji) {
    const reactions = { ...(comment.reactions || {}) };
    const previous = comment.my_reaction || null;
    const sameEmoji = previous === emoji;

    if (previous && previous !== emoji) {
        const left = (Number(reactions[previous]) || 0) - 1;
        if (left > 0) reactions[previous] = left;
        else delete reactions[previous];
    }

    if (sameEmoji) {
        const left = (Number(reactions[emoji]) || 0) - 1;
        if (left > 0) reactions[emoji] = left;
        else delete reactions[emoji];
    } else {
        reactions[emoji] = (Number(reactions[emoji]) || 0) + 1;
    }

    return { ...comment, reactions, my_reaction: sameEmoji ? null : emoji };
}

/**
 * Список комментариев набора.
 *
 * Props:
 *  - basketId       — id набора (нужен для запросов реакций и удаления)
 *  - comments       — массив BasketComment из `getBasketComments`
 *  - isAuthenticated — есть ли токен; гости отправляются на вход
 *  - onCommentsChange — сеттер состояния родителя (принимает функцию-апдейтер)
 *  - onReply        — клик по «Ответить», родитель запоминает адресата
 *  - onError        — текст ошибки наверх (в общую плашку страницы)
 *  - onRequireAuth  — гость нажал реакцию: уводим на /login
 *  - currentUsername — имя из localStorage: подстраховка для кнопки «Удалить»,
 *    если список получен без токена (см. комментарий ниже)
 *  - replyToId      — комментарий, на который сейчас отвечают (подсветка)
 */
function BasketCommentList({
    basketId,
    comments = [],
    isAuthenticated = false,
    onCommentsChange,
    onReply,
    onError,
    onRequireAuth,
    currentUsername = '',
    replyToId = null,
}) {
    // Ключ вида 'reaction:12:🔥' — блокируем только нажатую кнопку
    const [pending, setPending] = useState('');

    const list = Array.isArray(comments) ? comments : [];
    const roots = list.filter((comment) => !comment.parent_id);
    const repliesOf = (parentId) => list.filter((comment) => comment.parent_id === parentId);

    const replaceComment = (commentId, next) => {
        onCommentsChange?.((prev = []) => prev.map((row) => (row.id === commentId ? next : row)));
    };

    /* Backend удаляет комментарий вместе с ответами на него — повторяем локально. */
    const dropComment = (commentId) => {
        onCommentsChange?.((prev = []) =>
            prev.filter((row) => row.id !== commentId && row.parent_id !== commentId)
        );
    };

    /**
     * Кнопка «Удалить»: основной источник правды — `is_mine` от backend
     * (автор или модератор). Общий GET-помощник `getBasketComments` запрашивает
     * список без токена, поэтому на первой загрузке флаг может прийти false —
     * тогда сравниваем имя автора с именем текущего пользователя.
     */
    const canDelete = (comment) =>
        Boolean(comment.is_mine) ||
        Boolean(isAuthenticated && currentUsername && comment.username === currentUsername);

    const handleReaction = async (comment, emoji) => {
        if (!basketId) return;
        if (!isAuthenticated) {
            onRequireAuth?.();
            return;
        }
        if (pending) return;

        const key = `reaction:${comment.id}:${emoji}`;
        const before = comment;
        setPending(key);
        replaceComment(comment.id, withToggledReaction(comment, emoji));

        try {
            // Ответ — обновлённый комментарий: счётчики и моя реакция уже посчитаны backend
            const updated = await reactToComment(basketId, comment.id, emoji);
            if (updated && updated.id) {
                replaceComment(comment.id, updated);
            }
        } catch (err) {
            replaceComment(comment.id, before);
            onError?.(err.message || 'Не удалось поставить реакцию');
        } finally {
            setPending('');
        }
    };

    const handleDelete = async (comment) => {
        if (!basketId) return;
        if (!window.confirm('Удалить комментарий? Ответы на него тоже исчезнут.')) return;
        if (pending) return;

        const key = `delete:${comment.id}`;
        setPending(key);
        try {
            await deleteBasketComment(basketId, comment.id);
            dropComment(comment.id);
        } catch (err) {
            onError?.(err.message || 'Не удалось удалить комментарий');
        } finally {
            setPending('');
        }
    };

    const renderComment = (comment, depth = 0) => (
        <div
            key={comment.id}
            className={
                depth > 0
                    ? 'ml-3 sm:ml-8 border-l-2 border-ink-100 dark:border-ink-800 pl-2.5 sm:pl-3'
                    : undefined
            }
        >
            <div className={`card p-3.5${replyToId === comment.id ? ' ring-2 ring-primary-500/50' : ''}`}>
                <div className="flex items-center gap-2 min-w-0">
                    <CommentAvatar username={comment.username} avatarUrl={comment.avatar_url} />
                    <span className="font-semibold text-sm text-ink-900 dark:text-ink-100 truncate">
                        {comment.username || 'Пользователь'}
                    </span>
                    <span className="text-[11px] text-ink-400 dark:text-ink-500 whitespace-nowrap ml-auto">
                        {comment.created_at ? new Date(comment.created_at).toLocaleString('ru-RU') : ''}
                    </span>
                </div>

                <p className="mt-2 text-sm text-ink-700 dark:text-ink-200 break-words">{comment.text}</p>

                {/* Реакции: счётчик показываем только когда он не ноль */}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {COMMENT_REACTIONS.map((emoji) => {
                        const count = Number(comment.reactions?.[emoji]) || 0;
                        const mine = comment.my_reaction === emoji;
                        const busy = pending === `reaction:${comment.id}:${emoji}`;
                        const title = REACTION_TITLES[emoji] || emoji;

                        return (
                            <button
                                key={emoji}
                                type="button"
                                onClick={() => handleReaction(comment, emoji)}
                                disabled={busy}
                                aria-pressed={mine}
                                aria-label={`${mine ? 'Убрать реакцию' : 'Поставить реакцию'} «${title}»${count > 0 ? `, сейчас ${count}` : ''}`}
                                className={`inline-flex items-center justify-center gap-1 min-h-[44px] min-w-[44px] px-2 rounded-xl border text-sm font-bold tabular-nums transition-colors disabled:opacity-60
                                ${
                                    mine
                                        ? 'bg-primary-50 border-primary-300 text-primary-700 dark:bg-primary-900/30 dark:border-primary-700 dark:text-primary-300'
                                        : 'bg-ink-100 border-transparent text-ink-600 dark:bg-ink-800 dark:text-ink-300 hover:bg-ink-200 dark:hover:bg-ink-700'
                                }`}
                            >
                                <span aria-hidden="true">{emoji}</span>
                                {count > 0 && <span>{formatCount(count)}</span>}
                            </button>
                        );
                    })}
                </div>

                {(isAuthenticated || canDelete(comment)) && (
                    <div className="mt-1 -ml-1.5 flex flex-wrap items-center gap-1">
                        {isAuthenticated && (
                            <button
                                type="button"
                                onClick={() => onReply?.(comment)}
                                className="inline-flex items-center min-h-[44px] px-2 rounded-xl text-xs font-semibold text-ink-500 dark:text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                            >
                                Ответить
                            </button>
                        )}
                        {canDelete(comment) && (
                            <button
                                type="button"
                                onClick={() => handleDelete(comment)}
                                disabled={pending === `delete:${comment.id}`}
                                aria-label={`Удалить комментарий${comment.username ? ` ${comment.username}` : ''}`}
                                className="inline-flex items-center gap-1 min-h-[44px] px-2 rounded-xl text-xs font-semibold text-ink-500 dark:text-ink-400 hover:bg-hot-50 dark:hover:bg-hot-500/10 hover:text-hot-600 dark:hover:text-hot-400 transition-colors disabled:opacity-60"
                            >
                                <span aria-hidden="true">🗑</span>
                                Удалить
                            </button>
                        )}
                    </div>
                )}
            </div>

            {repliesOf(comment.id).length > 0 && (
                <div className="mt-2 space-y-2">
                    {repliesOf(comment.id).map((reply) => renderComment(reply, depth + 1))}
                </div>
            )}
        </div>
    );

    if (roots.length === 0) {
        return (
            <p className="text-center py-6 text-sm text-ink-500 dark:text-ink-400">
                Пока нет комментариев — будьте первым.
            </p>
        );
    }

    return <div className="space-y-2">{roots.map((comment) => renderComment(comment))}</div>;
}

export default BasketCommentList;
