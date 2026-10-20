import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createCity, getCities } from '../services/smeta';

/**
 * CityCombobox — выбор города из справочника (1000+ городов) с поиском
 * и возможностью добавить свой город, если его нет в списке.
 *
 * Почему не чипы: раньше города выводились горизонтальной лентой чипов, но
 * в справочнике 1085 городов — лента перестала быть рабочим интерфейсом.
 * Здесь: инпут с debounce 300 мс → `GET /geo/cities?q=&limit=20`, выпадающий
 * список с прокруткой внутри (без горизонтальной ленты), а если города нет —
 * первая строка «Добавить город …» → `POST /geo/cities` (название сохраняется
 * с большой буквы) и выбор созданного города.
 *
 * Пропсы:
 * - `value` — id выбранного города или null;
 * - `valueName` — название для отображения (когда город выбран снаружи);
 * - `onChange(city|null)` — отдаёт весь объект города или null;
 * - `placeholder`, `label`, `required`, `className`;
 * - `variant` — 'input' (обычное поле для форм) | 'button' (компактная кнопка
 *   с названием города — витрина и страница рецепта);
 * - `error` — текст ошибки под полем, `hint` — подсказка, `disabled`, `id`.
 *
 * Компонент НЕ пишет в localStorage: `recartly_city_id` сохраняет родитель
 * (он же решает, что делать при смене города — пересчёт сметы, перезагрузка).
 */
const DEBOUNCE_MS = 300;
const DEFAULT_LIMIT = 20;
/** Название из справочника, если город выбран снаружи, а имя не передали. */
const LOOKUP_LIMIT = 50;
/** Население, начиная с которого показываем подсказку справа в строке. */
const POPULATION_HINT_FROM = 250000;

/** «  нижний тагил » → «Нижний Тагил» (как на бэкенде). */
const withCapitalLetter = (raw) =>
    String(raw || '')
        .trim()
        .replace(/\s+/g, ' ')
        .split(' ')
        .map((word) =>
            word
                .split('-')
                .map((piece) =>
                    piece ? piece[0].toUpperCase() + piece.slice(1).toLowerCase() : piece
                )
                .join('-')
        )
        .join(' ');

/** Компактно: 361 тыс., 1,2 млн. Для небольших городов ничего не показываем. */
const formatPopulation = (raw) => {
    const value = Number(raw);
    if (!Number.isFinite(value) || value < POPULATION_HINT_FROM) return '';
    if (value >= 1000000) {
        return `${(value / 1000000).toFixed(1).replace('.', ',')} млн`;
    }
    return `${Math.round(value / 1000)} тыс.`;
};

const sameCityName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

function CityCombobox({
    value = null,
    valueName = '',
    onChange,
    placeholder = 'Начните вводить название',
    label,
    required = false,
    variant = 'input',
    className = '',
    error = '',
    hint = '',
    disabled = false,
    id = null,
}) {
    const reactId = useId();
    const inputId = id || `city-combobox-${reactId}`;
    const listId = `${inputId}-list`;
    const errorId = `${inputId}-error`;
    const hintId = `${inputId}-hint`;
    const searchInputId = `${inputId}-search`;

    const rootRef = useRef(null);
    const inputRef = useRef(null);

    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [options, setOptions] = useState([]);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState('');
    const [highlight, setHighlight] = useState(-1);
    const [selected, setSelected] = useState(null);
    const [creating, setCreating] = useState(false);
    const [createError, setCreateError] = useState('');
    const [reloadKey, setReloadKey] = useState(0);

    const isButton = variant === 'button';
    const selectedName = valueName || selected?.name || '';
    const errorText = typeof error === 'string' ? error : '';
    const hasError = Boolean(error);
    const canClear = !required && !isButton && value !== null && value !== undefined;
    const describedBy = [errorText ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;

    // Синхронизация с внешним значением: сброс, а если id пришёл без названия —
    // пробуем узнать название в списке крупных городов (отдельного «город по id» нет)
    useEffect(() => {
        if (value === null || value === undefined) {
            setSelected(null);
            return undefined;
        }
        if (valueName) return undefined;
        if (selected && String(selected.id) === String(value)) return undefined;
        let cancelled = false;
        getCities({ limit: LOOKUP_LIMIT })
            .then((list) => {
                if (cancelled) return;
                const found = (Array.isArray(list) ? list : []).find(
                    (city) => String(city.id) === String(value)
                );
                if (found) setSelected(found);
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [value, valueName, selected]);

    // Поиск: debounce 300 мс, чтобы не дёргать API на каждый символ
    useEffect(() => {
        if (!open) return undefined;
        const term = query.trim();
        let cancelled = false;
        const timer = setTimeout(
            () => {
                setLoading(true);
                setLoadError('');
                getCities({ q: term || undefined, limit: DEFAULT_LIMIT })
                    .then((list) => {
                        if (!cancelled) setOptions(Array.isArray(list) ? list : []);
                    })
                    .catch((err) => {
                        console.error('CityCombobox: не удалось загрузить города', err);
                        if (cancelled) return;
                        setOptions([]);
                        setLoadError('Не удалось загрузить города');
                    })
                    .finally(() => {
                        if (!cancelled) setLoading(false);
                    });
            },
            term ? DEBOUNCE_MS : 0
        );
        return () => {
            cancelled = true;
            clearTimeout(timer);
            setLoading(false);
        };
    }, [open, query, reloadKey]);

    const trimmedQuery = query.trim();
    const hasExactMatch = options.some((city) => sameCityName(city.name, trimmedQuery));
    const canCreate = trimmedQuery.length >= 2 && !hasExactMatch;
    const newCityName = withCapitalLetter(trimmedQuery);

    const rows = useMemo(() => {
        const list = options.map((city) => ({ kind: 'city', city }));
        if (canCreate) list.unshift({ kind: 'create', name: newCityName });
        return list;
    }, [options, canCreate, newCityName]);

    // Подсвечиваем первый найденный город: случайный ввод не должен создавать город по Enter
    useEffect(() => {
        if (!open) {
            setHighlight(-1);
            return;
        }
        const firstCity = rows.findIndex((row) => row.kind === 'city');
        setHighlight(firstCity >= 0 ? firstCity : rows.length ? 0 : -1);
    }, [open, rows]);

    // Клик вне компонента закрывает список
    useEffect(() => {
        if (!open) return undefined;
        const handleOutside = (event) => {
            if (!rootRef.current || rootRef.current.contains(event.target)) return;
            setOpen(false);
        };
        document.addEventListener('mousedown', handleOutside);
        document.addEventListener('touchstart', handleOutside, { passive: true });
        return () => {
            document.removeEventListener('mousedown', handleOutside);
            document.removeEventListener('touchstart', handleOutside);
        };
    }, [open]);

    // После выбора название остаётся в поле: выделяем его, чтобы набор сразу заменял текст
    useEffect(() => {
        if (open || isButton) return;
        const input = inputRef.current;
        if (input && selectedName && document.activeElement === input) input.select();
    }, [open, selectedName, isButton]);

    const openPanel = () => {
        setQuery('');
        setCreateError('');
        setOpen(true);
    };

    const closePanel = () => {
        setOpen(false);
        setCreateError('');
    };

    const selectCity = (city) => {
        if (!city) return;
        setSelected(city);
        setQuery('');
        setCreateError('');
        setOpen(false);
        if (onChange) onChange(city);
    };

    const handleCreate = async () => {
        if (creating) return;
        const name = withCapitalLetter(query);
        if (name.length < 2) return;
        setCreating(true);
        setCreateError('');
        try {
            const created = await createCity({ name });
            if (!created || !created.id) throw new Error('Город не добавлен');
            setSelected(created);
            setQuery('');
            setOpen(false);
            if (onChange) onChange(created);
        } catch (err) {
            console.error('CityCombobox: не удалось добавить город', err);
            setCreateError(err?.message || 'Не удалось добавить город. Попробуйте ещё раз.');
        } finally {
            setCreating(false);
        }
    };

    const commitRow = (index) => {
        const row = rows[index] || rows[0];
        if (!row) {
            if (canCreate) handleCreate();
            return;
        }
        if (row.kind === 'create') {
            handleCreate();
            return;
        }
        selectCity(row.city);
    };

    const handleKeyDown = (event) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (!open) {
                openPanel();
                return;
            }
            setHighlight((prev) => (rows.length ? (prev + 1) % rows.length : -1));
            return;
        }
        if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (!open) {
                openPanel();
                return;
            }
            setHighlight((prev) => (rows.length ? (prev - 1 + rows.length) % rows.length : -1));
            return;
        }
        if (event.key === 'Enter') {
            if (!open) {
                event.preventDefault();
                openPanel();
                return;
            }
            if (rows.length) {
                event.preventDefault();
                commitRow(highlight >= 0 ? highlight : 0);
            }
            return;
        }
        if (event.key === 'Escape') {
            if (!open) return;
            // Не даём Esc дойти до шторок: они слушают keydown на window
            event.preventDefault();
            event.stopPropagation();
            closePanel();
            return;
        }
        if (event.key === 'Tab') {
            setOpen(false);
        }
    };

    const handleClear = () => {
        setSelected(null);
        setQuery('');
        setOpen(false);
        if (inputRef.current) inputRef.current.focus();
        if (onChange) onChange(null);
    };

    const activeOptionId = open && highlight >= 0 ? `${inputId}-option-${highlight}` : undefined;

    const renderOption = (row, index) => {
        const isActive = index === highlight;
        const rowClass = `w-full min-h-[44px] px-3 py-2 rounded-xl flex items-center gap-2 text-left transition-colors ${
            isActive ? 'bg-primary-50 dark:bg-primary-500/15' : ''
        }`;

        if (row.kind === 'create') {
            return (
                <button
                    key="create-city"
                    id={`${inputId}-option-${index}`}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    disabled={creating}
                    onMouseEnter={() => setHighlight(index)}
                    onClick={handleCreate}
                    className={`${rowClass} disabled:opacity-60`}
                >
                    <span aria-hidden="true" className="text-lg">
                        {creating ? '⏳' : '➕'}
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold text-primary-700 dark:text-primary-300">
                            {creating ? 'Добавляем город…' : `Добавить город «${row.name}»`}
                        </span>
                        <span className="block text-[11px] text-ink-500 dark:text-ink-400">
                            Сохраним с большой буквы: {row.name}
                        </span>
                    </span>
                </button>
            );
        }

        const population = formatPopulation(row.city.population);
        return (
            <button
                key={row.city.id}
                id={`${inputId}-option-${index}`}
                type="button"
                role="option"
                aria-selected={isActive}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => selectCity(row.city)}
                className={rowClass}
            >
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink-900 dark:text-ink-100">
                        {row.city.name}
                    </span>
                    {row.city.region ? (
                        <span className="block truncate text-[11px] text-ink-400 dark:text-ink-500">
                            {row.city.region}
                        </span>
                    ) : null}
                </span>
                {population ? (
                    <span className="text-[11px] font-semibold tabular text-ink-400 dark:text-ink-500 whitespace-nowrap">
                        {population}
                    </span>
                ) : null}
            </button>
        );
    };

    const listBody = () => {
        if (loading && options.length === 0) {
            return (
                <div className="p-1.5 space-y-1.5" aria-hidden="true">
                    {[0, 1, 2].map((key) => (
                        <div key={key} className="skeleton h-[44px] w-full" />
                    ))}
                    <p className="px-2 text-[11px] text-ink-500 dark:text-ink-400">Ищем…</p>
                </div>
            );
        }

        if (loadError) {
            return (
                <div className="p-3">
                    <p className="text-xs text-hot-600 dark:text-hot-400">{loadError}</p>
                    <button
                        type="button"
                        onClick={() => setReloadKey((key) => key + 1)}
                        className="btn-ghost min-h-[44px] text-xs mt-1"
                    >
                        Повторить
                    </button>
                </div>
            );
        }

        if (rows.length === 0) {
            return (
                <p className="px-3 py-3 text-sm text-ink-500 dark:text-ink-400">
                    Ничего не нашли. Введите название полностью — предложим добавить город.
                </p>
            );
        }

        return (
            <>
                {loading ? (
                    <p className="px-3 pt-1 text-[11px] text-ink-400 dark:text-ink-500">Ищем…</p>
                ) : null}
                {rows.map(renderOption)}
            </>
        );
    };

    return (
        <div ref={rootRef} className={`relative w-full min-w-0 ${className}`}>
            <div className="relative">
                {isButton ? (
                    <>
                        {label ? <span className="label">{label}</span> : null}
                        <button
                            type="button"
                            id={inputId}
                            disabled={disabled}
                            aria-haspopup="listbox"
                            aria-expanded={open}
                            aria-controls={listId}
                            aria-invalid={hasError || undefined}
                            aria-label={label ? `${label}: ${selectedName || 'не выбран'}` : undefined}
                            onClick={() => (open ? closePanel() : openPanel())}
                            className="inline-flex items-center gap-2 min-h-[44px] max-w-full px-3.5 py-2 rounded-2xl border bg-white dark:bg-ink-850 text-left font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500/60 disabled:opacity-50 disabled:cursor-not-allowed border-ink-200 dark:border-ink-700 text-ink-800 dark:text-ink-100 hover:border-primary-400 hover:text-primary-700 dark:hover:text-primary-300"
                        >
                            <span aria-hidden="true">📍</span>
                            <span className={`truncate ${selectedName ? '' : 'text-ink-500 dark:text-ink-400 font-medium'}`}>
                                {selectedName || placeholder || 'Выбрать город'}
                            </span>
                            <span aria-hidden="true" className="ml-auto text-ink-400 dark:text-ink-500">
                                {open ? '▴' : '▾'}
                            </span>
                        </button>
                    </>
                ) : (
                    <>
                        {label ? (
                            <label htmlFor={inputId} className="label">
                                {label}
                                {required ? <span className="text-hot-500"> *</span> : null}
                            </label>
                        ) : null}
                        <div className="relative">
                            <input
                                ref={inputRef}
                                id={inputId}
                                type="text"
                                role="combobox"
                                autoComplete="off"
                                aria-expanded={open}
                                aria-controls={listId}
                                aria-activedescendant={activeOptionId}
                                aria-autocomplete="list"
                                aria-haspopup="listbox"
                                aria-invalid={hasError || undefined}
                                aria-describedby={describedBy}
                                aria-required={required || undefined}
                                disabled={disabled}
                                placeholder={placeholder}
                                value={open ? query : selectedName}
                                onChange={(event) => {
                                    setQuery(event.target.value);
                                    setCreateError('');
                                    if (!open) setOpen(true);
                                }}
                                onFocus={() => {
                                    if (!open) openPanel();
                                }}
                                onClick={() => {
                                    if (!open) openPanel();
                                }}
                                onKeyDown={handleKeyDown}
                                className={`input ${hasError ? 'input-error' : ''} ${canClear ? 'pr-12' : ''}`}
                            />
                            {canClear ? (
                                <button
                                    type="button"
                                    onClick={handleClear}
                                    aria-label="Сбросить город"
                                    className="absolute right-1 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center rounded-xl text-ink-400 dark:text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors"
                                >
                                    ✕
                                </button>
                            ) : null}
                        </div>
                    </>
                )}

                {open ? (
                    <div
                        className={`absolute left-0 top-full z-30 mt-1.5 card p-1.5 shadow-card-hover dark:shadow-card-hover-dark animate-fade-in overflow-hidden ${
                            isButton ? 'w-full max-w-[26rem]' : 'right-0'
                        }`}
                    >
                        {isButton ? (
                            <div className="p-1.5 pb-0.5">
                                <input
                                    id={searchInputId}
                                    type="text"
                                    role="combobox"
                                    autoComplete="off"
                                    autoFocus
                                    aria-label="Поиск города"
                                    aria-expanded={open}
                                    aria-controls={listId}
                                    aria-activedescendant={activeOptionId}
                                    aria-autocomplete="list"
                                    aria-haspopup="listbox"
                                    placeholder={placeholder || 'Поиск города'}
                                    value={query}
                                    onChange={(event) => {
                                        setQuery(event.target.value);
                                        setCreateError('');
                                    }}
                                    onKeyDown={handleKeyDown}
                                    className="input !min-h-[44px]"
                                />
                            </div>
                        ) : null}

                        <div
                            id={listId}
                            role="listbox"
                            aria-label="Города"
                            className="max-h-[280px] overflow-y-auto overscroll-contain"
                        >
                            {listBody()}
                        </div>

                        {createError ? (
                            <p className="px-3 py-2 text-xs text-hot-600 dark:text-hot-400">{createError}</p>
                        ) : null}
                    </div>
                ) : null}
            </div>

            {errorText ? (
                <p id={errorId} className="text-xs font-semibold text-hot-600 dark:text-hot-400 mt-1.5">
                    {errorText}
                </p>
            ) : null}
            {hint ? (
                <p id={hintId} className="text-xs text-ink-500 dark:text-ink-400 mt-1.5">
                    {hint}
                </p>
            ) : null}
        </div>
    );
}

export default CityCombobox;
