import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Кнопка «назад» для шапки: не нужно тянуться к кнопке браузера.
 *
 * Логика возврата:
 *  - если в истории SPA есть предыдущий экран (location.key !== 'default') — возвращаемся на него,
 *    куда бы пользователь ни пришёл: из витрины, из поиска или из профиля;
 *  - если это первый экран сессии (прямой заход по ссылке) — ведём на `fallback` (витрину),
 *    потому что «назад» в браузере выкинул бы человека с сайта.
 */
function BackButton({ fallback = '/', className = '' }) {
    const navigate = useNavigate();
    const location = useLocation();

    // На самом fallback-экране (витрине) кнопка не нужна
    if (location.pathname === fallback) return null;

    const canGoBack = Boolean(location.key) && location.key !== 'default';

    const handleClick = () => {
        if (canGoBack) {
            navigate(-1);
        } else {
            navigate(fallback);
        }
    };

    return (
        <button
            type="button"
            onClick={handleClick}
            aria-label="Назад"
            title="Назад"
            className={`w-10 h-10 flex-shrink-0 rounded-full flex items-center justify-center
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
            >
                <path d="M14.5 5 7.5 12l7 7" />
            </svg>
        </button>
    );
}

export default BackButton;
