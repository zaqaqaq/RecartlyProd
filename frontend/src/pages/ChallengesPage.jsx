import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
    checkAchievements,
    getAchievementsCatalog,
    getChallenges,
    getLeaderboard,
    getMyAchievements,
    joinChallenge,
} from '../services/smeta';

const money = (value) =>
    typeof value === 'number'
        ? `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value)} ₽`
        : '—';

/**
 * Челленджи бюджета и награды: «Ужин за 300 ₽», лидерборд и ачивки за полезные действия.
 */
function ChallengesPage() {
    const navigate = useNavigate();
    const [tab, setTab] = useState('challenges');
    const [challenges, setChallenges] = useState([]);
    const [achievements, setAchievements] = useState(null);
    const [catalog, setCatalog] = useState([]);
    const [boards, setBoards] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [joining, setJoining] = useState(null);
    const [recipeId, setRecipeId] = useState('');
    const [showJoin, setShowJoin] = useState(null);

    const isAuthenticated = !!localStorage.getItem('access_token');

    useEffect(() => {
        let cancelled = false;
        setLoading(true);

        const tasks = [getChallenges(), getAchievementsCatalog()];
        if (isAuthenticated) {
            tasks.push(getMyAchievements());
        }

        Promise.allSettled(tasks)
            .then((results) => {
                if (cancelled) return;
                if (results[0].status === 'fulfilled') setChallenges(results[0].value || []);
                if (results[1].status === 'fulfilled') setCatalog(results[1].value || []);
                if (isAuthenticated && results[2]?.status === 'fulfilled') {
                    setAchievements(results[2].value);
                }
            })
            .catch((err) => setError(err.message || 'Не удалось загрузить данные'))
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [isAuthenticated]);

    const loadBoard = async (challengeId) => {
        if (boards[challengeId]) return;
        try {
            const data = await getLeaderboard(challengeId);
            setBoards((prev) => ({ ...prev, [challengeId]: data.rows || [] }));
        } catch (err) {
            console.error(err);
        }
    };

    const handleJoin = async (challenge) => {
        if (!isAuthenticated) {
            navigate('/login');
            return;
        }
        const id = Number(recipeId);
        if (!id) {
            setError('Укажите ID рецепта для участия');
            return;
        }
        setJoining(challenge.id);
        setError('');
        try {
            const result = await joinChallenge(challenge.id, { recipe_id: id });
            setChallenges((prev) =>
                prev.map((row) =>
                    row.id === challenge.id
                        ? { ...row, my_entry: { recipe_id: id, total_price: result.total_price, score: result.score } }
                        : row
                )
            );
            setShowJoin(null);
            setBoards((prev) => ({ ...prev, [challenge.id]: undefined }));
            loadBoard(challenge.id);
            if (result.message) setError('');
        } catch (err) {
            setError(err.message || 'Не удалось участвовать в челлендже');
        } finally {
            setJoining(null);
        }
    };

    const handleCheck = async () => {
        try {
            const result = await checkAchievements();
            setAchievements((prev) => (prev ? { ...prev, level: result.level } : prev));
            const fresh = await getMyAchievements();
            setAchievements(fresh);
        } catch (err) {
            setError(err.message || 'Не удалось обновить награды');
        }
    };

    const earnedTypes = new Set((achievements?.earned || []).map((row) => row.type));

    return (
        <div className="max-w-3xl mx-auto animate-fade-in pb-bottom-nav">
            <header className="mb-4">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary-100 dark:bg-primary-900/25 text-primary-700 dark:text-primary-300 text-[11px] font-bold uppercase tracking-wide">
                    🎯 челленджи и награды
                </span>
                <h1 className="heading-1 mt-2">Уложитесь в бюджет</h1>
                <p className="text-sm text-ink-500 dark:text-ink-400 mt-1.5">
                    Готовьте по заданной сумме, попадайте в лидерборд и получайте награды за полезные действия.
                </p>
            </header>

            <div className="hscroll mb-4">
                {[
                    { key: 'challenges', label: 'Челленджи', emoji: '🎯' },
                    { key: 'awards', label: 'Мои награды', emoji: '🏆' },
                ].map((item) => (
                    <button
                        key={item.key}
                        type="button"
                        onClick={() => setTab(item.key)}
                        className={`tab-pill ${tab === item.key ? 'tab-pill-active' : ''}`}
                    >
                        <span>{item.emoji}</span>
                        {item.label}
                    </button>
                ))}
            </div>

            {error && <p className="text-sm text-hot-600 dark:text-hot-400 mb-3">{error}</p>}

            {tab === 'challenges' && (
                <div className="space-y-3">
                    {loading && <div className="skeleton h-28" />}

                    {!loading && challenges.length === 0 && (
                        <div className="card p-6 text-center">
                            <p className="text-ink-500 dark:text-ink-400">Активных челленджей пока нет.</p>
                        </div>
                    )}

                    {challenges.map((challenge) => (
                        <article key={challenge.id} className="card p-3.5">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <h2 className="font-display font-bold text-base text-ink-900 dark:text-white">
                                        {challenge.emoji} {challenge.title}
                                    </h2>
                                    <p className="text-sm text-ink-500 dark:text-ink-400 mt-1">
                                        {challenge.description}
                                    </p>
                                </div>
                                <span className="price text-xl whitespace-nowrap">{money(challenge.budget)}</span>
                            </div>

                            <div className="flex items-center gap-3 mt-2 text-xs text-ink-500 dark:text-ink-400">
                                <span>🍽 {challenge.servings} порц.</span>
                                <span>👥 {challenge.entries_count} участников</span>
                                {challenge.my_entry && (
                                    <span className="budget-pill budget-ok">
                                        мой результат {money(challenge.my_entry.total_price)}
                                    </span>
                                )}
                            </div>

                            <div className="flex flex-wrap items-center gap-2 mt-3">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setShowJoin(showJoin === challenge.id ? null : challenge.id);
                                        loadBoard(challenge.id);
                                    }}
                                    className="btn-secondary !min-h-[38px] !px-3.5 text-sm"
                                >
                                    🏅 Лидерборд
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowJoin(showJoin === challenge.id ? null : challenge.id)}
                                    className="btn-primary !min-h-[38px] !px-3.5 text-sm"
                                >
                                    {challenge.my_entry ? 'Обновить результат' : 'Участвовать'}
                                </button>
                            </div>

                            {showJoin === challenge.id && (
                                <div className="mt-3 pt-3 border-t border-ink-100 dark:border-ink-800">
                                    <label className="label" htmlFor={`recipe-${challenge.id}`}>
                                        ID рецепта для участия
                                    </label>
                                    <div className="flex gap-2">
                                        <input
                                            id={`recipe-${challenge.id}`}
                                            className="input tabular"
                                            inputMode="numeric"
                                            placeholder="например, 7"
                                            value={recipeId}
                                            onChange={(e) => setRecipeId(e.target.value.replace(/[^\d]/g, ''))}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => handleJoin(challenge)}
                                            disabled={joining === challenge.id}
                                            className="btn-primary whitespace-nowrap"
                                        >
                                            {joining === challenge.id ? 'Считаем…' : 'В бой'}
                                        </button>
                                    </div>
                                    <p className="text-xs text-ink-400 dark:text-ink-500 mt-1.5">
                                        Подсказка: откройте рецепт — его номер есть в адресе страницы.
                                        Можно <Link to="/" className="text-primary-600 dark:text-primary-400">подобрать подходящий</Link>.
                                    </p>

                                    {boards[challenge.id]?.length > 0 && (
                                        <div className="mt-3 space-y-1">
                                            {boards[challenge.id].slice(0, 5).map((row) => (
                                                <div key={row.place} className="flex items-center gap-2 text-sm">
                                                    <span className="w-6 text-center font-bold text-ink-400">
                                                        {row.place}
                                                    </span>
                                                    <span className="flex-1 min-w-0 truncate text-ink-700 dark:text-ink-200">
                                                        {row.username}
                                                    </span>
                                                    <span className="tabular text-ink-500 dark:text-ink-400">
                                                        {money(row.total_price)}
                                                    </span>
                                                    <span className="ri-badge ri-mid">{Math.round(row.score)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </article>
                    ))}
                </div>
            )}

            {tab === 'awards' && (
                <div className="space-y-3">
                    {!isAuthenticated ? (
                        <div className="card p-6 text-center">
                            <p className="text-ink-500 dark:text-ink-400 mb-4">
                                Войдите, чтобы видеть свои награды и баллы.
                            </p>
                            <Link to="/login" className="btn-primary">Войти</Link>
                        </div>
                    ) : (
                        <>
                            <section className="card p-4">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <h2 className="section-title !text-sm">Уровень {achievements?.level?.level ?? 1}</h2>
                                        <p className="text-xs text-ink-500 dark:text-ink-400 mt-1">
                                            {achievements?.level?.points ?? 0} баллов · до следующего уровня{' '}
                                            {Math.max(0, (achievements?.level?.next_level_points ?? 100) - (achievements?.level?.points ?? 0))}
                                        </p>
                                    </div>
                                    <button type="button" onClick={handleCheck} className="btn-secondary !min-h-[38px] !px-3.5 text-sm">
                                        Обновить
                                    </button>
                                </div>
                                <div className="ri-bar mt-3">
                                    <div
                                        className="ri-bar-fill"
                                        style={{ width: `${Math.round((achievements?.level?.progress ?? 0) * 100)}%` }}
                                    />
                                </div>
                            </section>

                            <section className="card p-4">
                                <h2 className="section-title !text-sm mb-3">
                                    Награды: {achievements?.earned?.length ?? 0} из {catalog.length}
                                </h2>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                    {catalog.map((item) => {
                                        const earned = earnedTypes.has(item.code);
                                        return (
                                            <div
                                                key={item.code}
                                                className={`rounded-2xl border p-3 ${
                                                    earned
                                                        ? 'border-primary-300 bg-primary-50/70 dark:border-primary-500/30 dark:bg-primary-500/10'
                                                        : 'border-ink-200 dark:border-ink-800 opacity-60'
                                                }`}
                                            >
                                                <span className="text-xl">{earned ? item.icon : '🔒'}</span>
                                                <p className="text-sm font-bold text-ink-800 dark:text-ink-100 mt-1">
                                                    {item.name}
                                                </p>
                                                <p className="text-[11px] text-ink-500 dark:text-ink-400 mt-0.5">
                                                    {item.description}
                                                </p>
                                                <p className="text-[11px] font-bold text-primary-600 dark:text-primary-400 mt-1">
                                                    +{item.points} баллов
                                                </p>
                                            </div>
                                        );
                                    })}
                                </div>
                            </section>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

export default ChallengesPage;
