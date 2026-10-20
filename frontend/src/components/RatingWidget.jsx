import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getRecipeReactions, rateRecipe, deleteRecipeReaction } from '../services/api';
import RiBadge from './RiBadge';

/* Балльная оценка рецепта: три оси по 5 звёзд, отметка «я приготовил»,
   агрегаты и Индекс Recartly. Расчёт индекса — на бэкенде. */

const AXES = [
    { key: 'taste', label: 'Вкусно', emoji: '😋', hint: 'Насколько вкусным получилось блюдо' },
    { key: 'value', label: 'Выгодно', emoji: '💰', hint: 'Стоит ли результат потраченных денег' },
    { key: 'simplicity', label: 'Просто', emoji: '👌', hint: 'Насколько легко это готовить' },
];

const EMPTY_FORM = { taste: null, value: null, simplicity: null, cooked: false };

const formatAverage = (value) => {
    if (value === null || value === undefined) return '—';
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric.toFixed(1) : '—';
};

function StarScale({ axis, value, average, disabled, onChange }) {
    return (
        <div className="py-2.5 border-b last:border-0 border-ink-100 dark:border-ink-800">
            <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="font-semibold text-sm text-ink-800 dark:text-ink-100">
                    <span aria-hidden="true">{axis.emoji}</span> {axis.label}
                </span>
                <span className="text-xs text-ink-500 dark:text-ink-400 tabular-nums">
                    {value ? `ваша оценка: ${value} из 5` : 'нет вашей оценки'}
                    <span className="text-ink-400 dark:text-ink-500"> · средняя {formatAverage(average)}</span>
                </span>
            </div>

            <div className="flex items-center gap-1 mt-1" role="group" aria-label={`${axis.label}: оценка от 1 до 5`}>
                {[1, 2, 3, 4, 5].map((star) => {
                    const active = value !== null && value !== undefined && star <= value;
                    return (
                        <button
                            key={star}
                            type="button"
                            disabled={disabled}
                            aria-label={`${axis.label}: ${star} из 5`}
                            aria-pressed={active}
                            onClick={() => onChange(value === star ? null : star)}
                            className={`inline-flex items-center justify-center w-11 h-11 min-w-[44px] min-h-[44px] rounded-xl text-2xl leading-none transition-colors active:scale-95 disabled:opacity-60
                            focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/60
                            ${active
                                    ? 'text-primary-500 dark:text-primary-400'
                                    : 'text-ink-300 dark:text-ink-600 hover:text-primary-400 dark:hover:text-primary-500'}`}
                        >
                            <span aria-hidden="true">{active ? '★' : '☆'}</span>
                        </button>
                    );
                })}
            </div>

            <p className="text-xs text-ink-400 dark:text-ink-500">{axis.hint}</p>
        </div>
    );
}

function Aggregates({ ri, loading }) {
    if (loading) {
        return <div className="skeleton h-28 w-full" />;
    }

    const raw = ri?.ri;
    const numeric = raw === null || raw === undefined ? NaN : Number(raw);
    const hasValue = Number.isFinite(numeric);
    const width = hasValue ? Math.max(0, Math.min(100, numeric)) : 0;

    return (
        <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-ink-700 dark:text-ink-200">Индекс Recartly</span>
                    <RiBadge value={hasValue ? numeric : null} size="lg" showEmpty />
                </div>
                <div className="flex items-center gap-3 text-xs text-ink-500 dark:text-ink-400">
                    <span>
                        🗳 Голосов:{' '}
                        <span className="font-bold tabular-nums text-ink-700 dark:text-ink-200">
                            {ri?.reactions_count ?? 0}
                        </span>
                    </span>
                    <span>
                        🍳 Приготовили:{' '}
                        <span className="font-bold tabular-nums text-ink-700 dark:text-ink-200">
                            {ri?.cooked_count ?? 0}
                        </span>
                    </span>
                </div>
            </div>

            <div
                className="ri-bar mt-2.5"
                role="img"
                aria-label={hasValue ? `Индекс Recartly ${Math.round(numeric)} из 100` : 'Индекс Recartly не рассчитан'}
            >
                <div className="ri-bar-fill" style={{ width: `${width}%` }} />
            </div>

            <div className="grid grid-cols-3 gap-3 mt-3.5">
                {AXES.map((axis) => (
                    <div key={axis.key} className="metric">
                        <span className="metric-value">{formatAverage(ri?.[`avg_${axis.key}`])}</span>
                        <span className="metric-label">{axis.label}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function RatingWidget({ recipeId, onUpdate }) {
    const isAuthenticated = !!localStorage.getItem('access_token');

    const [ri, setRi] = useState(null);
    const [hasMyReaction, setHasMyReaction] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    useEffect(() => {
        if (!recipeId) return undefined;

        let alive = true;
        setLoading(true);

        (async () => {
            try {
                const data = await getRecipeReactions(recipeId);
                if (!alive) return;
                setRi(data?.ri || null);
                const mine = data?.my || null;
                setHasMyReaction(!!mine);
                setForm({
                    taste: mine?.taste ?? null,
                    value: mine?.value ?? null,
                    simplicity: mine?.simplicity ?? null,
                    cooked: !!mine?.cooked,
                });
            } catch (err) {
                if (alive) setError('Не удалось загрузить оценки');
            } finally {
                if (alive) setLoading(false);
            }
        })();

        return () => {
            alive = false;
        };
    }, [recipeId]);

    const canSave = !saving && (
        form.cooked ||
        form.taste !== null ||
        form.value !== null ||
        form.simplicity !== null
    );

    const handleAxisChange = (axis, value) => {
        setSuccess('');
        setForm((prev) => ({ ...prev, [axis]: value }));
    };

    const handleSave = async () => {
        setError('');
        setSuccess('');
        setSaving(true);
        try {
            const payload = {
                taste: form.taste,
                value: form.value,
                simplicity: form.simplicity,
                cooked: form.cooked,
            };
            const data = await rateRecipe(recipeId, payload);
            setRi(data);
            setHasMyReaction(true);
            setSuccess('Спасибо! Оценка сохранена, Индекс Recartly обновлён.');
            if (onUpdate) onUpdate(data);
        } catch (err) {
            setError(err?.message || 'Не удалось сохранить оценку');
        } finally {
            setSaving(false);
        }
    };

    const handleReset = async () => {
        setError('');
        setSuccess('');
        setSaving(true);
        try {
            const data = await deleteRecipeReaction(recipeId);
            setRi(data);
            setHasMyReaction(false);
            setForm(EMPTY_FORM);
            setSuccess('Ваша оценка удалена.');
            if (onUpdate) onUpdate(data);
        } catch (err) {
            setError(err?.message || 'Не удалось удалить оценку');
        } finally {
            setSaving(false);
        }
    };

    return (
        <section className="card p-4 sm:p-5 mb-6">
            <h2 className="section-title mb-3">⭐ Оценка рецепта</h2>

            <Aggregates ri={ri} loading={loading} />

            {error && !isAuthenticated && (
                <p
                    role="alert"
                    className="mt-3 text-sm font-semibold text-hot-600 dark:text-hot-400 rounded-2xl bg-hot-50 dark:bg-hot-600/10 px-3.5 py-2.5"
                >
                    {error}
                </p>
            )}

            <div className="mt-4 pt-4 border-t border-ink-100 dark:border-ink-800">
                {!isAuthenticated ? (
                    <div className="rounded-2xl border border-dashed border-ink-200 dark:border-ink-700 p-4 text-center">
                        <p className="text-ink-600 dark:text-ink-300 text-sm">
                            Оценивать рецепты могут только участники сообщества.
                            Ваш голос сразу влияет на Индекс Recartly.
                        </p>
                        <Link to="/login" className="btn-primary btn-block sm:w-auto sm:inline-flex mt-3">
                            Войти, чтобы оценить
                        </Link>
                    </div>
                ) : (
                    <div>
                        <p className="text-sm text-ink-500 dark:text-ink-400 mb-1">
                            Поставьте оценку по каждой оси — можно изменить её в любой момент.
                        </p>

                        {AXES.map((axis) => (
                            <StarScale
                                key={axis.key}
                                axis={axis}
                                value={form[axis.key]}
                                average={ri?.[`avg_${axis.key}`]}
                                disabled={saving}
                                onChange={(value) => handleAxisChange(axis.key, value)}
                            />
                        ))}

                        <button
                            type="button"
                            role="switch"
                            aria-checked={form.cooked}
                            disabled={saving}
                            onClick={() => {
                                setSuccess('');
                                setForm((prev) => ({ ...prev, cooked: !prev.cooked }));
                            }}
                            className={`w-full min-h-[56px] flex items-start gap-3 p-3 mt-3 rounded-2xl border text-left transition-colors disabled:opacity-60
                            focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/60
                            ${form.cooked
                                    ? 'border-primary-400 bg-primary-50 dark:bg-primary-500/10 dark:border-primary-700'
                                    : 'border-ink-200 dark:border-ink-700 hover:bg-ink-50 dark:hover:bg-ink-850'}`}
                        >
                            <span
                                aria-hidden="true"
                                className={`mt-0.5 w-6 h-6 rounded-lg border-2 flex items-center justify-center text-sm font-black flex-shrink-0
                                ${form.cooked
                                        ? 'bg-primary-500 border-primary-500 text-white'
                                        : 'border-ink-300 dark:border-ink-600 text-transparent'}`}
                            >
                                ✓
                            </span>
                            <span className="min-w-0">
                                <span className="block font-semibold text-ink-900 dark:text-white">
                                    Я приготовил(а) это
                                </span>
                                <span className="block text-xs text-ink-500 dark:text-ink-400 mt-0.5">
                                    Голос того, кто действительно приготовил, весит в два раза больше
                                    при расчёте Индекса Recartly.
                                </span>
                            </span>
                        </button>

                        {error && (
                            <p
                                role="alert"
                                className="mt-3 text-sm font-semibold text-hot-600 dark:text-hot-400 rounded-2xl bg-hot-50 dark:bg-hot-600/10 px-3.5 py-2.5"
                            >
                                {error}
                            </p>
                        )}

                        {success && (
                            <p
                                role="status"
                                className="mt-3 text-sm font-semibold text-primary-700 dark:text-primary-300 rounded-2xl bg-primary-50 dark:bg-primary-500/10 px-3.5 py-2.5"
                            >
                                {success}
                            </p>
                        )}

                        <div className="flex flex-wrap items-center gap-2 mt-3.5">
                            <button
                                type="button"
                                onClick={handleSave}
                                disabled={!canSave}
                                className="btn-primary btn-block sm:w-auto disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                {saving ? 'Сохраняем…' : 'Сохранить оценку'}
                            </button>
                            {hasMyReaction && (
                                <button
                                    type="button"
                                    onClick={handleReset}
                                    disabled={saving}
                                    className="btn-ghost btn-block sm:w-auto"
                                >
                                    Удалить мою оценку
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
}

export default RatingWidget;
