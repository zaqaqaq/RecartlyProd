import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getUnreadNotificationsCount } from '../services/smeta';

const hasToken = () => Boolean(localStorage.getItem('access_token'));

/**
 * Колокольчик уведомлений для шапки приложения.
 *
 * Сам следит за числом непрочитанных: запрашивает счётчик при монтировании,
 * обновляет его раз в минуту и мгновенно реагирует на событие
 * `notificationsChange`, которое диспатчит страница уведомлений после
 * прочтения или удаления. Неавторизованным не рендерит ничего.
 */
function NotificationBell({ className = '' }) {
    const [isAuthenticated, setIsAuthenticated] = useState(hasToken);
    const [unread, setUnread] = useState(0);

    useEffect(() => {
        let cancelled = false;
        let timer = null;

        const load = () => {
            // Пользователь вышел из аккаунта — гасим опрос и счётчик
            if (!hasToken()) {
                if (timer) {
                    clearInterval(timer);
                    timer = null;
                }
                if (!cancelled) {
                    setIsAuthenticated(false);
                    setUnread(0);
                }
                return;
            }

            if (!cancelled) setIsAuthenticated(true);

            getUnreadNotificationsCount()
                .then((data) => {
                    if (!cancelled) setUnread(Number(data && data.unread) || 0);
                })
                .catch(() => {
                    /* счётчик не критичен для работы: оставляем прежнее значение */
                });
        };

        // Интервал ставим до первого запроса: если токена нет, load() его сразу снимет
        timer = setInterval(load, 60000);
        load();
        window.addEventListener('notificationsChange', load);

        return () => {
            cancelled = true;
            if (timer) clearInterval(timer);
            window.removeEventListener('notificationsChange', load);
        };
    }, []);

    if (!isAuthenticated) return null;

    return (
        <Link
            to="/notifications"
            title="Уведомления"
            aria-label={
                unread > 0
                    ? `Уведомления, непрочитанных: ${unread}`
                    : 'Уведомления'
            }
            className={`relative w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0
            text-ink-600 dark:text-ink-300 hover:bg-ink-100 dark:hover:bg-ink-800
            active:scale-95 transition-colors ${className}`}
        >
            <svg
                viewBox="0 0 24 24"
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
            >
                <path d="M12 3a6 6 0 0 0-6 6v3.6l-1.6 3.6a.6.6 0 0 0 .5.8h14.2a.6.6 0 0 0 .5-.8L18 12.6V9a6 6 0 0 0-6-6Z" />
                <path d="M9.8 20a2.2 2.2 0 0 0 4.4 0" />
            </svg>

            {unread > 0 && (
                <span
                    className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full
                    bg-hot-500 text-white text-[10px] font-bold leading-none
                    flex items-center justify-center"
                >
                    {unread > 99 ? '99+' : unread}
                </span>
            )}
        </Link>
    );
}

export default NotificationBell;
