import React, { useRef } from 'react';

/**
 * Строка поиска в шапке.
 *
 * ВАЖНО: компонент объявлен на верхнем уровне модуля. Раньше он был объявлен
 * внутри `Navbar`, из-за чего React считал его новым типом компонента на каждом
 * рендере, размонтировал input и терял фокус — на мобильных закрывалась клавиатура
 * после первой же буквы.
 */
function SearchBar({
    value,
    onChange,
    onSubmit,
    placeholder = 'Поиск рецептов и корзин…',
    className = '',
}) {
    const inputRef = useRef(null);

    const handleSubmit = (event) => {
        event.preventDefault();
        if (onSubmit) onSubmit(value);
    };

    const handleClear = () => {
        onChange('');
        // Возвращаем фокус в поле, чтобы можно было сразу печатать заново
        inputRef.current?.focus();
    };

    return (
        <form onSubmit={handleSubmit} className={className} role="search">
            <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none">
                    <svg
                        viewBox="0 0 24 24"
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.9"
                        strokeLinecap="round"
                    >
                        <circle cx="11" cy="11" r="6.5" />
                        <path d="M20 20l-4.3-4.3" />
                    </svg>
                </span>

                <input
                    ref={inputRef}
                    type="search"
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    placeholder={placeholder}
                    aria-label="Поиск"
                    autoComplete="off"
                    enterKeyHint="search"
                    className="w-full min-h-[44px] pl-11 pr-10 py-2.5 rounded-2xl
                    bg-ink-100 dark:bg-ink-850 border border-transparent
                    text-ink-900 dark:text-ink-100 placeholder:text-ink-400
                    focus:bg-white dark:focus:bg-ink-900 focus:border-primary-400
                    focus:outline-none focus:ring-2 focus:ring-primary-500/40
                    transition-colors duration-200"
                />

                {value ? (
                    <button
                        type="button"
                        onClick={handleClear}
                        aria-label="Очистить поиск"
                        className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full
                        flex items-center justify-center text-ink-400 hover:text-ink-700
                        dark:hover:text-ink-200 hover:bg-ink-200 dark:hover:bg-ink-700 transition-colors"
                    >
                        ✕
                    </button>
                ) : null}
            </div>
        </form>
    );
}

export default SearchBar;
