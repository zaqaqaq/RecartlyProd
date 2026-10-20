import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import ThemeToggle from './ThemeToggle';
import SearchBar from './SearchBar';
import BackButton from './BackButton';
import NotificationBell from './NotificationBell';
import { API_URL, mediaUrl } from '../utils/media';

/* Разделы каркаса приложения. На мобильных их роль выполняет BottomNav. */
const TOP_LINKS = [
    { to: '/', label: 'Витрина', emoji: '🧾', match: (p) => p === '/' || p.startsWith('/basket') },
    { to: '/feed', label: 'Лента', emoji: '🍲', match: (p) => p.startsWith('/feed') || p.startsWith('/recipe/') },
    { to: '/pp', label: 'ПП', emoji: '🥗', match: (p) => p.startsWith('/pp') },
    { to: '/recipes', label: 'Рецепты', emoji: '🍳', match: (p) => p.startsWith('/recipes') },
];

function Navbar() {
    const navigate = useNavigate();
    const location = useLocation();
    const [searchQuery, setSearchQuery] = useState('');
    const [addDropdownOpen, setAddDropdownOpen] = useState(false);
    const [userMenuOpen, setUserMenuOpen] = useState(false);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [username, setUsername] = useState('');
    const [avatarUrl, setAvatarUrl] = useState(null);
    const [role, setRole] = useState(null);

    const addDropdownRef = useRef(null);
    const userMenuRef = useRef(null);

    const updateAuthState = () => {
        const token = localStorage.getItem('access_token');
        const savedUsername = localStorage.getItem('username');
        const savedAvatar = localStorage.getItem('avatar_url');
        const savedRole = localStorage.getItem('role');

        setIsAuthenticated(!!token);
        setUsername(savedUsername || '');
        setAvatarUrl(savedAvatar || null);
        setRole(savedRole || null);
    };

    useEffect(() => {
        updateAuthState();

        const token = localStorage.getItem('access_token');
        if (token && !localStorage.getItem('username')) {
            loadUserData();
        }
    }, []);

    useEffect(() => {
        const handleStorageChange = () => {
            updateAuthState();
        };
        window.addEventListener('storage', handleStorageChange);
        return () => window.removeEventListener('storage', handleStorageChange);
    }, []);

    useEffect(() => {
        const handleAuthChange = () => {
            updateAuthState();
            setAddDropdownOpen(false);
            setUserMenuOpen(false);
        };
        window.addEventListener('authChange', handleAuthChange);
        return () => window.removeEventListener('authChange', handleAuthChange);
    }, []);

    const loadUserData = async () => {
        const token = localStorage.getItem('access_token');
        if (token) {
            try {
                const response = await fetch(`${API_URL}/profile/me`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (response.ok) {
                    const data = await response.json();
                    setUsername(data.username);
                    setAvatarUrl(data.avatar_url);
                    localStorage.setItem('username', data.username);
                    if (data.avatar_url) {
                        localStorage.setItem('avatar_url', data.avatar_url);
                    } else {
                        localStorage.removeItem('avatar_url');
                    }
                    // Роль нужна для пункта меню «Модерация»
                    if (data.role) {
                        localStorage.setItem('role', data.role);
                        setRole(data.role);
                    }
                } else if (response.status === 401) {
                    localStorage.removeItem('access_token');
                    localStorage.removeItem('username');
                    localStorage.removeItem('avatar_url');
                    localStorage.removeItem('role');
                    setIsAuthenticated(false);
                }
            } catch (err) {
                console.error('Failed to load user data:', err);
            }
        }
    };

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (addDropdownRef.current && !addDropdownRef.current.contains(event.target)) {
                setAddDropdownOpen(false);
            }
            if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
                setUserMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('touchstart', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('touchstart', handleClickOutside);
        };
    }, []);

    const handleAddDropdownToggle = () => {
        setAddDropdownOpen(!addDropdownOpen);
        setUserMenuOpen(false);
    };

    const handleUserMenuToggle = () => {
        setUserMenuOpen(!userMenuOpen);
        setAddDropdownOpen(false);
    };

    const handleLogout = () => {
        localStorage.removeItem('access_token');
        localStorage.removeItem('username');
        localStorage.removeItem('avatar_url');
        localStorage.removeItem('role');
        setUserMenuOpen(false);
        setIsAuthenticated(false);
        setRole(null);
        window.dispatchEvent(new Event('authChange'));
        navigate('/login');
    };

    const getInitials = () => {
        return username ? username[0].toUpperCase() : '?';
    };

    const getAvatarDisplay = (size = 'w-9 h-9') => {
        if (avatarUrl && avatarUrl.startsWith('emoji:')) {
            const parts = avatarUrl.split(':');
            const emoji = parts[1];
            const bg = parts[2] || 'bg-primary-100';
            const textColor = parts[3] || 'text-primary-600';
            return (
                <span className={`${size} rounded-full ${bg} ${textColor} flex items-center justify-center text-sm`}>
                    {emoji}
                </span>
            );
        } else if (avatarUrl) {
            return (
                <img
                    src={mediaUrl(avatarUrl)}
                    alt="Avatar"
                    className={`${size} rounded-full object-cover`}
                />
            );
        }
        return (
            <span className={`${size} rounded-full bg-gradient-to-br from-primary-400 to-primary-700 text-white flex items-center justify-center font-bold text-sm`}>
                {getInitials()}
            </span>
        );
    };

    const handleSearchSubmit = (query) => {
        if (query && query.trim()) {
            navigate(`/search?q=${encodeURIComponent(query.trim())}`);
            setSearchQuery('');
        }
    };

    return (
        <nav className="sticky top-0 z-40 bg-white/90 dark:bg-ink-900/90 backdrop-blur-xl border-b border-ink-200 dark:border-ink-800 safe-top">
            <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-6">
                <div className="flex items-center gap-2 sm:gap-3 h-16">
                    {/* Возврат на предыдущий экран — не нужно тянуться к кнопке браузера */}
                    <BackButton />

                    <Link to="/" className="flex items-center gap-2 flex-shrink-0 press">
                        <span className="w-9 h-9 rounded-2xl bg-gradient-to-br from-primary-400 to-primary-700 text-white font-extrabold flex items-center justify-center shadow-brand">
                            R
                        </span>
                        <span className="text-lg sm:text-xl font-extrabold tracking-tight text-ink-900 dark:text-white">
                            Recartly
                        </span>
                    </Link>

                    {/* Поиск на десктопе — только для вошедших: гостю он не нужен */}
                    {isAuthenticated && (
                        <div className="hidden md:block flex-1 max-w-xl mx-auto">
                            <SearchBar
                                value={searchQuery}
                                onChange={setSearchQuery}
                                onSubmit={handleSearchSubmit}
                            />
                        </div>
                    )}

                    <div className="flex items-center gap-1 sm:gap-2 ml-auto">
                        {isAuthenticated && (
                            <div className="relative hidden sm:block" ref={addDropdownRef}>
                                <button
                                    type="button"
                                    onClick={handleAddDropdownToggle}
                                    className="btn-primary !min-h-[40px] !px-4 !py-2 text-sm"
                                    aria-expanded={addDropdownOpen}
                                >
                                    <span className="text-base leading-none">+</span>
                                    Добавить
                                </button>
                                {addDropdownOpen && (
                                    <div className="absolute right-0 mt-2 w-52 bg-white dark:bg-ink-900 rounded-2xl shadow-card-hover dark:shadow-card-hover-dark py-2 z-50 border border-ink-200 dark:border-ink-800 animate-slide-up">
                                        <MenuLink to="/create" emoji="📝" label="Рецепт" onClick={() => setAddDropdownOpen(false)} />
                                        <MenuLink to="/create-basket" emoji="🛒" label="Набор" onClick={() => setAddDropdownOpen(false)} />
                                        <MenuLink to="/promos" emoji="🏷️" label="Акция" onClick={() => setAddDropdownOpen(false)} />
                                    </div>
                                )}
                            </div>
                        )}

                        <NotificationBell />
                        <ThemeToggle />

                        {isAuthenticated ? (
                            <div className="relative" ref={userMenuRef}>
                                <button
                                    type="button"
                                    onClick={handleUserMenuToggle}
                                    className="flex items-center gap-2 rounded-full p-0.5 pr-1 hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors"
                                    aria-expanded={userMenuOpen}
                                    aria-label="Меню профиля"
                                >
                                    {getAvatarDisplay()}
                                    <span className="hidden lg:inline max-w-[7rem] truncate text-sm font-semibold text-ink-700 dark:text-ink-200">
                                        {username}
                                    </span>
                                </button>

                                {userMenuOpen && (
                                    <div className="absolute right-0 mt-2 w-60 bg-white dark:bg-ink-900 rounded-2xl shadow-card-hover dark:shadow-card-hover-dark py-2 z-50 border border-ink-200 dark:border-ink-800 animate-slide-up">
                                        <div className="px-4 py-2 border-b border-ink-100 dark:border-ink-800 mb-1">
                                            <p className="font-bold text-ink-900 dark:text-white truncate">{username || 'Профиль'}</p>
                                            <p className="text-xs text-ink-500 dark:text-ink-400">Ваш аккаунт</p>
                                        </div>
                                        <MenuLink to="/my-baskets" emoji="📋" label="Мои наборы" onClick={() => setUserMenuOpen(false)} />
                                        <MenuLink to="/recipes" emoji="🍳" label="Рецепты" onClick={() => setUserMenuOpen(false)} />
                                        <MenuLink to="/week" emoji="📅" label="Моя неделя" onClick={() => setUserMenuOpen(false)} />
                                        <MenuLink to="/promos" emoji="🏷️" label="Акции города" onClick={() => setUserMenuOpen(false)} />
                                        <MenuLink to="/notifications" emoji="🔔" label="Уведомления" onClick={() => setUserMenuOpen(false)} />
                                        <div className="border-t border-ink-100 dark:border-ink-800 my-1" />
                                        <MenuLink to="/profile" emoji="👤" label="Мой профиль" onClick={() => setUserMenuOpen(false)} />
                                        {(role === 'moderator' || role === 'admin') && (
                                            <MenuLink to="/moderation" emoji="🛡️" label="Модерация" onClick={() => setUserMenuOpen(false)} />
                                        )}
                                        <MenuLink to="/settings" emoji="⚙️" label="Настройки" onClick={() => setUserMenuOpen(false)} />
                                        <div className="border-t border-ink-100 dark:border-ink-800 mt-1 pt-1">
                                            <button
                                                type="button"
                                                onClick={handleLogout}
                                                className="w-full text-left px-4 py-2.5 text-sm font-semibold text-hot-600 hover:bg-hot-50 dark:hover:bg-hot-600/10 transition-colors"
                                            >
                                                🚪 Выйти
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <Link
                                to="/login"
                                className="btn-primary !min-h-[40px] !px-4 !py-2 text-sm whitespace-nowrap"
                            >
                                Войти
                            </Link>
                        )}
                    </div>
                </div>

                {/* Разделы каркаса — только для вошедших; на мобильных их заменяет нижняя навигация */}
                {isAuthenticated && (
                    <nav
                        className="hidden lg:flex items-center gap-1 pb-2 -mt-1"
                        aria-label="Разделы"
                    >
                        {TOP_LINKS.map((link) => {
                            const active = link.match(location.pathname);
                            return (
                                <Link
                                    key={link.to}
                                    to={link.to}
                                    aria-current={active ? 'page' : undefined}
                                    className={`tab-pill ${active ? 'tab-pill-active' : ''}`}
                                >
                                    <span aria-hidden="true">{link.emoji}</span>
                                    {link.label}
                                </Link>
                            );
                        })}
                    </nav>
                )}

                {/* Поиск на мобильных — отдельной строкой, тоже после входа */}
                {isAuthenticated && (
                    <div className="md:hidden pb-3">
                        <SearchBar
                            value={searchQuery}
                            onChange={setSearchQuery}
                            onSubmit={handleSearchSubmit}
                        />
                    </div>
                )}
            </div>
        </nav>
    );
}

function MenuLink({ to, emoji, label, onClick }) {
    return (
        <Link
            to={to}
            onClick={onClick}
            className="flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-ink-700 dark:text-ink-200 hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors"
        >
            <span className="text-base">{emoji}</span>
            {label}
        </Link>
    );
}

export default Navbar;
