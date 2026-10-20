import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
    addPantryItem,
    createBasket,
    deletePantryItem,
    getPantry,
    suggestByPantry,
} from '../services/smeta';
import { mediaUrl } from '../utils/media';

const money = (value, digits = 0) =>
    typeof value === 'number'
        ? `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value)} ₽`
        : '—';

/**
 * «Собери из того, что есть» — анти-фуд-вейст.
 * Пользователь перечисляет остатки дома, а сервис показывает блюда,
 * которые почти целиком из них собираются, и считает стоимость докупки.
 */
function PantryPage() {
    const navigate = useNavigate();
    const [items, setItems] = useState([]);
    const [name, setName] = useState('');
    const [quantity, setQuantity] = useState('');
    const [unit, setUnit] = useState('');
    const [suggestions, setSuggestions] = useState(null);
    const [loading, setLoading] = useState(true);
    const [suggesting, setSuggesting] = useState(false);
    const [creating, setCreating] = useState(null);
    const [error, setError] = useState('');

    const isAuthenticated = !!localStorage.getItem('access_token');

    useEffect(() => {
        if (!isAuthenticated) {
            setLoading(false);
            return;
        }
        getPantry()
            .then((list) => setItems(list || []))
            .catch((err) => setError(err.message || 'Не удалось загрузить остатки'))
            .finally(() => setLoading(false));
    }, [isAuthenticated]);

    const handleAdd = async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        if (!isAuthenticated) {
            navigate('/login');
            return;
        }
        try {
            const created = await addPantryItem({
                name: name.trim(),
                quantity: quantity ? Number(quantity) : null,
                unit: unit || null,
            });
            setItems((prev) => [created, ...prev]);
            setName('');
            setQuantity('');
            setUnit('');
            setSuggestions(null);
        } catch (err) {
            setError(err.message || 'Не удалось добавить продукт');
        }
    };

    const handleRemove = async (item) => {
        try {
            await deletePantryItem(item.id);
            setItems((prev) => prev.filter((row) => row.id !== item.id));
            setSuggestions(null);
        } catch (err) {
            setError(err.message || 'Не удалось убрать продукт');
        }
    };

    const handleSuggest = async () => {
        setSuggesting(true);
        setError('');
        try {
            const result = await suggestByPantry({
                city_id: Number(localStorage.getItem('recartly_city_id')) || null,
                limit: 12,
            });
            setSuggestions(result || []);
        } catch (err) {
            setError(err.message || 'Не удалось подобрать рецепты');
        } finally {
            setSuggesting(false);
        }
    };

    const handleCreateBasket = async (recipeId) => {
        setCreating(recipeId);
        try {
            const basket = await createBasket({
                recipe_id: recipeId,
                city_id: Number(localStorage.getItem('recartly_city_id')) || null,
                strategy: 'split',
            });
            navigate(`/basket/${basket.id}`);
        } catch (err) {
            setError(err.message || 'Не удалось собрать смету');
        } finally {
            setCreating(null);
        }
    };

    if (!isAuthenticated) {
        return (
            <div className="max-w-2xl mx-auto card p-6 text-center animate-fade-in">
                <div className="w-14 h-14 mx-auto rounded-3xl bg-primary-100 dark:bg-primary-900/25 flex items-center justify-center text-2xl mb-3">
                    🧺
                </div>
                <h1 className="heading-3 mb-2">Что уже есть дома?</h1>
                <p className="text-ink-500 dark:text-ink-400 mb-4">
                    Войдите, чтобы записать остатки и получать рецепты с минимальной докупкой.
                </p>
                <Link to="/login" className="btn-primary">Войти</Link>
            </div>
        );
    }

    return (
        <div className="max-w-3xl mx-auto animate-fade-in pb-bottom-nav">
            <header className="mb-4">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary-100 dark:bg-primary-900/25 text-primary-700 dark:text-primary-300 text-[11px] font-bold uppercase tracking-wide">
                    🧺 остатки дома
                </span>
                <h1 className="heading-1 mt-2">Собери из того, что есть</h1>
                <p className="text-sm text-ink-500 dark:text-ink-400 mt-1.5">
                    Добавьте продукты, которые уже лежат дома, — покажем блюда, где докупить нужно меньше всего.
                </p>
            </header>

            <form onSubmit={handleAdd} className="card p-3.5 sm:p-4">
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_5rem_5rem_auto] gap-2">
                    <input
                        className="input"
                        placeholder="Например, картофель"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        aria-label="Название продукта"
                    />
                    <input
                        className="input tabular"
                        placeholder="Кол-во"
                        inputMode="decimal"
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                        aria-label="Количество"
                    />
                    <input
                        className="input"
                        placeholder="кг / шт"
                        value={unit}
                        onChange={(e) => setUnit(e.target.value)}
                        aria-label="Единица измерения"
                    />
                    <button type="submit" className="btn-primary sm:w-auto">
                        Добавить
                    </button>
                </div>
            </form>

            {error && (
                <p className="text-sm text-hot-600 dark:text-hot-400 mt-3">{error}</p>
            )}

            <section className="mt-4">
                <div className="flex items-center justify-between gap-2 mb-2">
                    <h2 className="section-title !text-sm">В наличии: {items.length}</h2>
                    {items.length > 0 && (
                        <button
                            type="button"
                            onClick={handleSuggest}
                            disabled={suggesting}
                            className="btn-primary !min-h-[40px] !px-4 text-sm"
                        >
                            {suggesting ? 'Подбираем…' : '✨ Подобрать блюда'}
                        </button>
                    )}
                </div>

                {loading ? (
                    <div className="space-y-2">
                        <div className="skeleton h-10" />
                        <div className="skeleton h-10" />
                    </div>
                ) : items.length === 0 ? (
                    <div className="card p-6 text-center">
                        <p className="text-ink-500 dark:text-ink-400">
                            Пока пусто. Добавьте продукты — например, «картофель», «куриное бедро», «лук».
                        </p>
                    </div>
                ) : (
                    <div className="flex flex-wrap gap-2">
                        {items.map((item) => (
                            <span key={item.id} className="chip !min-h-[38px] pr-1.5">
                                {item.name}
                                {item.quantity ? (
                                    <span className="text-ink-400 dark:text-ink-500 tabular">
                                        {' '}{item.quantity} {item.unit || ''}
                                    </span>
                                ) : null}
                                <button
                                    type="button"
                                    onClick={() => handleRemove(item)}
                                    aria-label={`Убрать ${item.name}`}
                                    className="ml-1 w-6 h-6 rounded-full flex items-center justify-center text-ink-400 hover:bg-ink-200 dark:hover:bg-ink-700 transition-colors"
                                >
                                    ×
                                </button>
                            </span>
                        ))}
                    </div>
                )}
            </section>

            {suggestions && (
                <section className="mt-5 space-y-3">
                    <h2 className="section-title">Что можно приготовить</h2>

                    {suggestions.length === 0 && (
                        <div className="card p-4">
                            <p className="text-sm text-ink-500 dark:text-ink-400">
                                Пока не нашлось подходящих блюд. Добавьте ещё продукты.
                            </p>
                        </div>
                    )}

                    {suggestions.map((item) => {
                        const percent = Math.round((item.covered_ratio || 0) * 100);
                        return (
                            <article key={item.recipe_id} className="card card-hover overflow-hidden">
                                <Link to={`/recipe/${item.recipe_id}`} className="flex gap-3 p-3">
                                    <div className="w-20 h-20 rounded-2xl overflow-hidden bg-ink-100 dark:bg-ink-800 flex-shrink-0">
                                        {item.photo_url ? (
                                            <img
                                                src={mediaUrl(item.photo_url)}
                                                alt={item.title}
                                                loading="lazy"
                                                className="w-full h-full object-cover"
                                            />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-2xl text-ink-300 dark:text-ink-600">
                                                🍲
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        <h3 className="font-display font-bold text-[15px] text-ink-900 dark:text-white line-clamp-2">
                                            {item.title}
                                        </h3>

                                        <div className="mt-1.5">
                                            <div className="ri-bar">
                                                <div className="ri-bar-fill" style={{ width: `${percent}%` }} />
                                            </div>
                                            <p className="text-[11px] text-ink-500 dark:text-ink-400 mt-1">
                                                Есть дома: {item.covered_positions} из {item.total_positions} ({percent}%)
                                            </p>
                                        </div>

                                        <div className="flex items-baseline justify-between gap-2 mt-2">
                                            <span className="price text-lg">{money(item.missing_price)}</span>
                                            <span className="text-[11px] text-ink-400 dark:text-ink-500">
                                                докупить
                                            </span>
                                        </div>
                                    </div>
                                </Link>

                                {item.missing_items?.length > 0 && (
                                    <div className="px-3 pb-2">
                                        <p className="text-xs text-ink-500 dark:text-ink-400 line-clamp-2">
                                            <span className="font-semibold">Купить: </span>
                                            {item.missing_items.join(', ')}
                                        </p>
                                    </div>
                                )}

                                <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-ink-100 dark:border-ink-800">
                                    <span className="text-[11px] text-ink-400 dark:text-ink-500">
                                        Вся смета: {money(item.full_price)}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => handleCreateBasket(item.recipe_id)}
                                        disabled={creating === item.recipe_id}
                                        className="inline-flex items-center gap-1 min-h-[36px] px-3 rounded-xl text-sm font-bold text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors disabled:opacity-50"
                                    >
                                        {creating === item.recipe_id ? 'Собираем…' : '🛒 Смета'}
                                    </button>
                                </div>
                            </article>
                        );
                    })}
                </section>
            )}
        </div>
    );
}

export default PantryPage;
