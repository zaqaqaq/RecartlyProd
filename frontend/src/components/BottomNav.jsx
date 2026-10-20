import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

/* ---------- Иконки навигации (SVG, без внешних зависимостей) ---------- */
const stroke = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
};

const PlusIcon = (props) => (
    <svg viewBox="0 0 24 24" className="w-6 h-6" {...props}>
        <path d="M12 5v14M5 12h14" {...stroke} strokeWidth={2.2} />
    </svg>
);

const UserIcon = (props) => (
    <svg viewBox="0 0 24 24" className="w-6 h-6" {...props}>
        <circle cx="12" cy="8" r="3.6" {...stroke} />
        <path d="M4.8 20.2a7.2 7.2 0 0 1 14.4 0" {...stroke} />
    </svg>
);

const ReceiptIcon = (props) => (
    <svg viewBox="0 0 24 24" className="w-6 h-6" {...props}>
        <path d="M6 3.5h12v17l-3-1.6-3 1.6-3-1.6-3 1.6Z" {...stroke} />
        <path d="M9.5 8.5h5M9.5 12h5M9.5 15.5h3" {...stroke} />
    </svg>
);

/* Блюдо: тарелка с прибором */
const DishIcon = (props) => (
    <svg viewBox="0 0 24 24" className="w-6 h-6" {...props}>
        <path d="M4 12.5h16a8 8 0 0 1-16 0Z" {...stroke} />
        <path d="M12 4.5v4.2M9 4.5v2.4a3 3 0 0 0 6 0V4.5" {...stroke} />
    </svg>
);

/* ПП: лист */
const LeafIcon = (props) => (
    <svg viewBox="0 0 24 24" className="w-6 h-6" {...props}>
        <path d="M5 19c0-8 4.5-13 14-13 0 8-4.5 13-14 13Z" {...stroke} />
        <path d="M5 19c3.5-4.5 6.5-6.8 10.5-9" {...stroke} />
    </svg>
);

const navItems = [
    {
        to: '/',
        label: 'Бюджет',
        icon: ReceiptIcon,
        match: (p) => p === '/' || p.startsWith('/basket'),
    },
    {
        to: '/recipes',
        label: 'Блюда',
        icon: DishIcon,
        match: (p) => p.startsWith('/recipes') || p.startsWith('/recipe/'),
    },
    { type: 'create' },
    {
        to: '/pp',
        label: 'ПП',
        icon: LeafIcon,
        match: (p) => p.startsWith('/pp'),
    },
    {
        to: '/profile',
        label: 'Профиль',
        icon: UserIcon,
        match: (p) => p.startsWith('/profile') || p.startsWith('/settings'),
        private: true,
    },
];

function BottomNav() {
    const location = useLocation();
    const navigate = useNavigate();
    const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('access_token'));
    const [sheetOpen, setSheetOpen] = useState(false);

    useEffect(() => {
        const sync = () => setIsAuthenticated(!!localStorage.getItem('access_token'));
        window.addEventListener('storage', sync);
        window.addEventListener('authChange', sync);
        return () => {
            window.removeEventListener('storage', sync);
            window.removeEventListener('authChange', sync);
        };
    }, []);

    // Закрываем шторку при переходе
    useEffect(() => {
        setSheetOpen(false);
    }, [location.pathname]);

    // Блокируем скролл фона, пока шторка открыта
    useEffect(() => {
        if (sheetOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => {
            document.body.style.overflow = '';
        };
    }, [sheetOpen]);

    const openCreate = () => {
        if (!isAuthenticated) {
            navigate('/login');
            return;
        }
        setSheetOpen(true);
    };

    return (
        <>
            <nav className="bottom-nav lg:hidden safe-bottom" aria-label="Основная навигация">
                <div className="flex items-stretch px-1">
                    {navItems.map((item) => {
                        if (item.type === 'create') {
                            return (
                                <div key="create" className="flex flex-1 items-center justify-center">
                                    <button
                                        type="button"
                                        onClick={openCreate}
                                        aria-label="Добавить публикацию"
                                        className="press -mt-6 w-14 h-14 rounded-3xl bg-primary-500 text-white
                                        flex items-center justify-center shadow-brand-lg
                                        hover:bg-primary-600 active:bg-primary-700"
                                    >
                                        <PlusIcon />
                                    </button>
                                </div>
                            );
                        }

                        const Icon = item.icon;
                        const active = item.match(location.pathname);
                        const target = item.private && !isAuthenticated ? '/login' : item.to;

                        return (
                            <Link
                                key={item.to}
                                to={target}
                                aria-current={active ? 'page' : undefined}
                                className={`bottom-nav-item ${active ? 'bottom-nav-item-active' : ''}`}
                            >
                                <span className="relative">
                                    <Icon />
                                    {active && (
                                        <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary-500" />
                                    )}
                                </span>
                                <span className="mt-0.5">{item.label}</span>
                            </Link>
                        );
                    })}
                </div>
            </nav>

            {sheetOpen && (
                <div className="fixed inset-0 z-[60] lg:hidden" role="dialog" aria-modal="true">
                    <div
                        className="absolute inset-0 bg-ink-950/50 backdrop-blur-sm animate-fade-in"
                        onClick={() => setSheetOpen(false)}
                    />

                    <div className="absolute inset-x-0 bottom-0 bg-white dark:bg-ink-900 rounded-t-3xl shadow-2xl animate-sheet-up safe-bottom">
                        <div className="w-10 h-1 rounded-full bg-ink-300 dark:bg-ink-700 mx-auto mt-3" />

                        <div className="px-5 pt-4 pb-5">
                            <h2 className="text-lg font-extrabold text-ink-900 dark:text-white">
                                Что добавим?
                            </h2>
                            <p className="text-sm text-ink-500 dark:text-ink-400 mt-1">
                                Соберите набор, поделитесь рецептом или акцией
                            </p>

                            <div className="mt-4 space-y-2">
                                <CreateOption
                                    to="/create-basket"
                                    emoji="🛒"
                                    title="Создать набор"
                                    subtitle="Список продуктов с ценой и бюджетом"
                                />
                                <CreateOption
                                    to="/create"
                                    emoji="📝"
                                    title="Создать рецепт"
                                    subtitle="Ингредиенты, шаги и стоимость"
                                />
                                <CreateOption
                                    to="/promos"
                                    emoji="🏷️"
                                    title="Поделиться акцией"
                                    subtitle="Увидели ценник в магазине — расскажите"
                                />
                                <CreateOption
                                    to="/my-baskets"
                                    emoji="📋"
                                    title="Мои наборы"
                                    subtitle="Сохранённые сметы покупок"
                                />
                                <CreateOption
                                    to="/pantry"
                                    emoji="🧺"
                                    title="Что у меня есть"
                                    subtitle="Остатки дома → рецепты с малой докупкой"
                                />
                                <CreateOption
                                    to="/mealplan"
                                    emoji="🗓"
                                    title="Меню на неделю"
                                    subtitle="План питания в рамках бюджета"
                                />
                            </div>

                            <button
                                type="button"
                                onClick={() => setSheetOpen(false)}
                                className="btn-secondary btn-block mt-3"
                            >
                                Отмена
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

function CreateOption({ to, emoji, title, subtitle }) {
    return (
        <Link
            to={to}
            className="flex items-center gap-3 p-3 rounded-2xl border border-ink-200 dark:border-ink-800
            hover:border-primary-300 hover:bg-primary-50/60 dark:hover:bg-primary-900/15
            active:scale-[0.99] transition-all duration-200"
        >
            <span className="w-11 h-11 rounded-2xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-xl flex-shrink-0">
                {emoji}
            </span>
            <span className="min-w-0">
                <span className="block font-bold text-ink-900 dark:text-white">{title}</span>
                <span className="block text-xs text-ink-500 dark:text-ink-400 truncate">{subtitle}</span>
            </span>
            <span className="ml-auto text-ink-300 dark:text-ink-600">›</span>
        </Link>
    );
}

export default BottomNav;
