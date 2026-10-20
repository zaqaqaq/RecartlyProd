import React, { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';

function UserMenu({ username, avatarUrl }) {
    const [isOpen, setIsOpen] = useState(false);
    const menuRef = useRef(null);
    const navigate = useNavigate();

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (menuRef.current && !menuRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleLogout = () => {
        localStorage.removeItem('access_token');
        navigate('/login');
    };

    const getInitials = () => {
        return username ? username[0].toUpperCase() : '?';
    };

    const getAvatar = (size = 'w-9 h-9 text-sm') => {
        if (avatarUrl && avatarUrl.startsWith('emoji:')) {
            const parts = avatarUrl.split(':');
            const emoji = parts[1];
            const bg = parts[2] || 'bg-primary-100';
            const textColor = parts[3] || 'text-primary-700';
            return <span className={`avatar ${size} ${bg} ${textColor}`}>{emoji}</span>;
        }
        if (avatarUrl) {
            return (
                <img
                    src={avatarUrl}
                    alt={username}
                    className={`avatar ${size} object-cover`}
                />
            );
        }
        return (
            <span className={`avatar ${size} bg-gradient-to-br from-primary-400 to-primary-700 text-white`}>
                {getInitials()}
            </span>
        );
    };

    return (
        <div className="relative" ref={menuRef}>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                aria-expanded={isOpen}
                aria-haspopup="menu"
                aria-label="Меню профиля"
                className="flex items-center gap-2 min-h-[44px] pl-0.5 pr-1.5 rounded-full
                text-ink-700 dark:text-ink-200 hover:bg-ink-100 dark:hover:bg-ink-800
                active:scale-[0.98] transition-all duration-200 max-w-full"
            >
                {getAvatar()}
                <span className="hidden sm:inline max-w-[8rem] truncate text-sm font-semibold">
                    {username}
                </span>
                <span
                    aria-hidden="true"
                    className={`text-[10px] text-ink-400 dark:text-ink-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                >
                    ▼
                </span>
            </button>

            {isOpen && (
                <div
                    role="menu"
                    className="absolute right-0 mt-2 w-60 max-w-[calc(100vw-1.5rem)] z-50 py-2
                    card shadow-card-hover dark:shadow-card-hover-dark animate-slide-up overflow-hidden"
                >
                    <div className="px-4 py-2 border-b border-ink-100 dark:border-ink-800 mb-1">
                        <p className="font-bold text-sm text-ink-900 dark:text-white truncate">
                            {username || 'Профиль'}
                        </p>
                        <p className="text-xs text-ink-500 dark:text-ink-400">Ваш аккаунт</p>
                    </div>

                    <Link
                        to="/profile"
                        role="menuitem"
                        className="btn-ghost w-full !justify-start !rounded-none !px-4 text-sm"
                        onClick={() => setIsOpen(false)}
                    >
                        👤 Мой профиль
                    </Link>
                    <Link
                        to="/my-recipes"
                        role="menuitem"
                        className="btn-ghost w-full !justify-start !rounded-none !px-4 text-sm"
                        onClick={() => setIsOpen(false)}
                    >
                        📝 Мои рецепты
                    </Link>
                    <Link
                        to="/favorites"
                        role="menuitem"
                        className="btn-ghost w-full !justify-start !rounded-none !px-4 text-sm"
                        onClick={() => setIsOpen(false)}
                    >
                        ⭐ Избранное
                    </Link>
                    <Link
                        to="/settings"
                        role="menuitem"
                        className="btn-ghost w-full !justify-start !rounded-none !px-4 text-sm"
                        onClick={() => setIsOpen(false)}
                    >
                        ⚙️ Настройки
                    </Link>

                    <hr className="my-1 border-ink-100 dark:border-ink-800" />

                    <button
                        type="button"
                        role="menuitem"
                        onClick={handleLogout}
                        className="btn-ghost w-full !justify-start !rounded-none !px-4 text-sm text-hot-600 dark:text-hot-400 hover:bg-hot-50 dark:hover:bg-hot-600/10"
                    >
                        🚪 Выйти
                    </button>
                </div>
            )}
        </div>
    );
}

export default UserMenu;
