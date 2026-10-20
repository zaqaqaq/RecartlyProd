import React, { useState, useEffect } from 'react';

function ThemeToggle({ variant = 'header' }) {
    const [isDark, setIsDark] = useState(() => {
        const saved = localStorage.getItem('theme');
        if (saved) return saved === 'dark';
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
    });

    useEffect(() => {
        if (isDark) {
            document.documentElement.classList.add('dark');
            localStorage.setItem('theme', 'dark');
        } else {
            document.documentElement.classList.remove('dark');
            localStorage.setItem('theme', 'light');
        }
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', isDark ? '#18181b' : '#f97316');
    }, [isDark]);

    const base =
        'w-10 h-10 rounded-full flex items-center justify-center text-lg transition-all duration-200 active:scale-95';
    const styles =
        variant === 'header'
            ? 'text-ink-600 dark:text-ink-300 hover:bg-ink-100 dark:hover:bg-ink-800'
            : 'text-ink-600 dark:text-ink-300 hover:bg-ink-100 dark:hover:bg-ink-800';

    return (
        <button
            type="button"
            onClick={() => setIsDark(!isDark)}
            className={`${base} ${styles}`}
            aria-label={isDark ? 'Включить светлую тему' : 'Включить тёмную тему'}
            title={isDark ? 'Светлая тема' : 'Тёмная тема'}
        >
            {isDark ? '☀️' : '🌙'}
        </button>
    );
}

export default ThemeToggle;
