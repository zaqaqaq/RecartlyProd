import React, { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

/**
 * Приветственный онбординг Recartly.
 *
 * Показывается один раз: если в localStorage нет флага `recartly_onboarded`.
 * Собирает две настройки «Сметы» (бюджет и число порций) и объясняет,
 * из каких разделов состоит приложение. Города здесь нет: цены авторские,
 * город для интерфейса не обязателен.
 *
 * Рендерить внутри <Router> (использует <Link> и useLocation), например рядом
 * с <Navbar />. На страницах входа и регистрации лист не открывается сам —
 * он появится сразу после успешного входа/регистрации.
 */

const ONBOARDED_KEY = 'recartly_onboarded';
const BUDGET_KEY = 'recartly_budget';
const SERVINGS_KEY = 'recartly_servings';

const BUDGET_PRESETS = [300, 500, 1000, 2000];
const SERVINGS_PRESETS = [1, 2, 3, 4, 6];

const STEPS = [
    { key: 'budget', title: 'Сколько тратите на еду?', hint: 'Подберём блюда и смету под эту сумму.' },
    { key: 'servings', title: 'На сколько человек готовите?', hint: 'Пересчитаем граммовки и стоимость.' },
    { key: 'ready', title: 'Всё готово', hint: 'Коротко о том, что есть внутри.' },
];

const SECTIONS = [
    { to: '/', emoji: '🧾', title: 'Витрина', hint: 'Наборы и блюда под ваш бюджет' },
    { to: '/recipes', emoji: '🍳', title: 'Блюда', hint: 'Рецепты без набора' },
    { to: '/pp', emoji: '🥗', title: 'Правильное питание', hint: 'Фильтры по калориям и белку' },
    { to: '/my-baskets', emoji: '🛒', title: 'Мои наборы', hint: 'Список покупок с ценами' },
    { to: '/feed', emoji: '🍲', title: 'Лента', hint: 'Обсуждения сообщества' },
];

function Onboarding() {
    const location = useLocation();
    const [open, setOpen] = useState(false);
    const [step, setStep] = useState(0);
    const [closing, setClosing] = useState(false);

    const [budget, setBudget] = useState(() => {
        const saved = Number(localStorage.getItem(BUDGET_KEY));
        return Number.isFinite(saved) && saved > 0 ? saved : null;
    });
    const [budgetInput, setBudgetInput] = useState(() => {
        const saved = Number(localStorage.getItem(BUDGET_KEY));
        return Number.isFinite(saved) && saved > 0 ? String(saved) : '';
    });
    const [servings, setServings] = useState(() => {
        const saved = Number(localStorage.getItem(SERVINGS_KEY));
        return Number.isFinite(saved) && saved > 0 ? saved : null;
    });

    const totalSteps = STEPS.length;
    const currentStep = STEPS[step];

    // ---------- Показ один раз ----------
    // На экранах входа/регистрации не мешаем: лист появится после перехода на витрину
    const isAuthScreen = location.pathname === '/login' || location.pathname === '/register';

    useEffect(() => {
        if (localStorage.getItem(ONBOARDED_KEY) === '1') return undefined;

        let timer = null;
        const show = () => {
            if (localStorage.getItem(ONBOARDED_KEY) !== '1') {
                setOpen(true);
                setClosing(false);
            }
        };

        if (!isAuthScreen) {
            timer = setTimeout(show, 600);
        }

        // После регистрации/входа App.js шлёт authChange — показываем сразу
        const handleAuthChange = () => {
            if (!isAuthScreen) show();
        };

        window.addEventListener('authChange', handleAuthChange);
        return () => {
            if (timer) clearTimeout(timer);
            window.removeEventListener('authChange', handleAuthChange);
        };
    }, [isAuthScreen]);

    const persist = useCallback(() => {
        if (budget && budget > 0) localStorage.setItem(BUDGET_KEY, String(budget));
        if (servings && servings > 0) localStorage.setItem(SERVINGS_KEY, String(servings));
    }, [budget, servings]);

    const close = useCallback(() => {
        localStorage.setItem(ONBOARDED_KEY, '1');
        setClosing(true);
        // Небольшая задержка, чтобы анимация закрытия успела проиграть
        window.setTimeout(() => setOpen(false), 160);
    }, []);

    /** Завершение (или «Пропустить»): сохраняем выбранное и ставим флаг «показано». */
    const finish = useCallback(() => {
        persist();
        close();
    }, [persist, close]);

    // Esc — закрыть, фон не скроллится, пока лист открыт
    useEffect(() => {
        if (!open) return undefined;
        const handleKey = (e) => {
            if (e.key === 'Escape') finish();
        };
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        window.addEventListener('keydown', handleKey);
        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener('keydown', handleKey);
        };
    }, [open, finish]);

    const applyBudgetInput = (raw) => {
        const digits = String(raw).replace(/[^\d]/g, '').slice(0, 6);
        setBudgetInput(digits);
        const value = Number(digits);
        if (Number.isFinite(value) && value > 0) {
            setBudget(Math.min(100000, value));
        }
    };

    const handleNext = () => {
        if (step === totalSteps - 1) {
            persist();
            close();
            return;
        }
        persist();
        setStep((prev) => Math.min(prev + 1, totalSteps - 1));
    };

    const handleBack = () => setStep((prev) => Math.max(prev - 1, 0));

    if (!open) return null;

    const isLast = step === totalSteps - 1;

    return (
        <div
            className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center"
            role="dialog"
            aria-modal="true"
            aria-labelledby="onboarding-title"
        >
            <div
                className={`absolute inset-0 bg-ink-900/60 dark:bg-ink-950/80 backdrop-blur-sm transition-opacity duration-200 ${closing ? 'opacity-0' : 'opacity-100'}`}
                onClick={finish}
                aria-hidden="true"
            />

            <div
                className={`relative w-full sm:max-w-lg card rounded-b-none rounded-t-3xl sm:rounded-3xl
                    p-5 sm:p-6 max-h-[92vh] overflow-y-auto safe-bottom
                    ${closing ? 'opacity-0 translate-y-4' : 'animate-sheet-up sm:animate-fade-in-up'}
                    transition-all duration-200`}
            >
                {/* Шапка: прогресс и «Пропустить» */}
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <div
                            className="flex items-center gap-1.5"
                            role="progressbar"
                            aria-valuemin={1}
                            aria-valuemax={totalSteps}
                            aria-valuenow={step + 1}
                            aria-label="Шаг знакомства"
                        >
                            {STEPS.map((item, index) => (
                                <span
                                    key={item.key}
                                    className={`h-1.5 rounded-full transition-all duration-300 ${
                                        index === step
                                            ? 'w-6 bg-primary-500'
                                            : index < step
                                                ? 'w-1.5 bg-primary-400'
                                                : 'w-1.5 bg-ink-200 dark:bg-ink-700'
                                    }`}
                                />
                            ))}
                        </div>
                        <p className="text-xs text-ink-500 dark:text-ink-400 mt-2 tabular">
                            Шаг {step + 1} из {totalSteps}
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={finish}
                        className="btn-ghost min-h-[44px] text-sm"
                    >
                        Пропустить
                    </button>
                </div>

                <h2 id="onboarding-title" className="heading-3 mt-3">
                    {currentStep.title}
                </h2>
                <p className="text-sm text-ink-500 dark:text-ink-400 mt-1">{currentStep.hint}</p>

                {/* ---------- Шаг 1: бюджет ---------- */}
                {currentStep.key === 'budget' && (
                    <div className="mt-4">
                        <div className="hscroll">
                            {BUDGET_PRESETS.map((amount) => (
                                <button
                                    key={amount}
                                    type="button"
                                    onClick={() => {
                                        setBudget(amount);
                                        setBudgetInput(String(amount));
                                    }}
                                    aria-pressed={budget === amount}
                                    className={`chip min-h-[44px] px-4 tabular ${budget === amount ? 'chip-active' : ''}`}
                                >
                                    {amount} ₽
                                </button>
                            ))}
                        </div>

                        <div className="mt-4">
                            <label htmlFor="onboarding-budget" className="label">
                                Своя сумма, ₽
                            </label>
                            <input
                                id="onboarding-budget"
                                type="text"
                                inputMode="numeric"
                                value={budgetInput}
                                onChange={(e) => applyBudgetInput(e.target.value)}
                                className="input tabular"
                                placeholder="Например, 1500"
                            />
                        </div>
                    </div>
                )}

                {/* ---------- Шаг 2: порции ---------- */}
                {currentStep.key === 'servings' && (
                    <div className="mt-4">
                        <div className="hscroll">
                            {SERVINGS_PRESETS.map((count) => (
                                <button
                                    key={count}
                                    type="button"
                                    onClick={() => setServings(count)}
                                    aria-pressed={servings === count}
                                    className={`chip min-h-[44px] px-4 tabular ${servings === count ? 'chip-active' : ''}`}
                                >
                                    {count} {count === 1 ? 'человек' : 'чел.'}
                                </button>
                            ))}
                        </div>
                        <p className="text-xs text-ink-500 dark:text-ink-400 mt-3">
                            {servings
                                ? `Считаем смету на ${servings} ${servings === 1 ? 'порцию' : 'порции'}.`
                                : 'Можно изменить в любой момент на витрине.'}
                        </p>
                    </div>
                )}

                {/* ---------- Шаг 3: разделы ---------- */}
                {currentStep.key === 'ready' && (
                    <div className="mt-4 space-y-2">
                        {SECTIONS.map((section) => (
                            <Link
                                key={section.to}
                                to={section.to}
                                onClick={finish}
                                className="card card-hover flex items-center gap-3 min-h-[56px] px-3 py-2.5 press"
                            >
                                <span className="text-xl" aria-hidden="true">{section.emoji}</span>
                                <span className="min-w-0">
                                    <span className="block font-semibold text-ink-900 dark:text-ink-100">
                                        {section.title}
                                    </span>
                                    <span className="block text-xs text-ink-500 dark:text-ink-400">
                                        {section.hint}
                                    </span>
                                </span>
                                <span className="ml-auto text-ink-400 dark:text-ink-500" aria-hidden="true">
                                    →
                                </span>
                            </Link>
                        ))}
                    </div>
                )}

                {/* ---------- Навигация ---------- */}
                <div className="flex items-center gap-2 mt-5">
                    {step > 0 && (
                        <button
                            type="button"
                            onClick={handleBack}
                            className="btn-secondary flex-1"
                        >
                            Назад
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={handleNext}
                        className="btn-primary flex-1"
                    >
                        {isLast ? 'Начать' : 'Далее'}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default Onboarding;
