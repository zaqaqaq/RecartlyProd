import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getBasketFeed, getDishFeed } from '../services/smeta';
import BasketCard from './BasketCard';
import DishCard from './DishCard';

/* ============================================================
   Презентационный экран для ГОСТЯ (нет access_token на главной).

   Задача экрана — за одну прокрутку объяснить, что такое Recartly,
   и показать живое сообщество. Инструмента подбора здесь нет:
   фильтры, табы и сортировки гость увидит после входа.

   Данные лент — публичные (`getBasketFeed` / `getDishFeed`), но если
   API молчит, гость не должен видеть ни одной ошибки: лента просто
   не показывается (или уступает место скелетонам во время загрузки).
   ============================================================ */

const FEED_LIMIT = 9;
/** Шаг автопрокрутки: одна карточка примерно каждые 4 секунды. */
const SLIDE_INTERVAL = 4000;
/** После касания даём человеку договорить с карточкой, потом снова листаем. */
const RESUME_DELAY = 6000;
/** Ширина одной карточки в ленте: на мобильном уже, на десктопе чуть шире. */
const SLIDE_WIDTH = 'w-[16.5rem] sm:w-[17rem]';

const FEATURES = [
    {
        emoji: '🧺',
        title: 'Соберите набор под бюджет',
        text: 'Закупка в пределах суммы, которую вы назвали.',
    },
    {
        emoji: '🍲',
        title: 'Готовьте из него',
        text: 'Из одного набора получается несколько блюд.',
    },
    {
        emoji: '🗓️',
        title: 'Цены с датой',
        text: 'Видно, когда цены собраны, — ничего не выдумываем.',
    },
    {
        emoji: '🥗',
        title: 'Правильное питание',
        text: 'Фильтры по калориям и белку для лёгких блюд.',
    },
];

const STEPS = [
    {
        title: 'Укажите бюджет',
        text: 'Сумма на закупку и число человек — этого достаточно.',
    },
    {
        title: 'Получите набор и блюда',
        text: 'Что купить, что из этого приготовить и сколько потратите.',
    },
    {
        title: 'Идите в магазин',
        text: 'Список покупок с ценами можно сохранить и отметить купленное.',
    },
];

/** Автопрокрутка мешает тем, кто просил меньше движения. */
function prefersReducedMotion() {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Шаг ленты — расстояние между двумя соседними карточками. */
function laneStep(rail) {
    if (!rail || rail.children.length === 0) return 0;
    if (rail.children.length > 1) {
        const step = rail.children[1].offsetLeft - rail.children[0].offsetLeft;
        if (step > 0) return step;
    }
    const width = rail.children[0].getBoundingClientRect().width;
    return width > 0 ? width : 0;
}

/** Позиции карточек внутри ленты — от левого края первой карточки. */
function laneOffsets(rail) {
    if (!rail || rail.children.length === 0) return [];
    const base = rail.children[0].offsetLeft;
    return Array.from(rail.children, (child) => child.offsetLeft - base);
}

/** Скелетон карточки в ленте: та же структура и высоты, что у BasketCard/DishCard. */
function SlideSkeleton() {
    return (
        <div className={`${SLIDE_WIDTH} card overflow-hidden flex flex-col h-full`}>
            <div className="skeleton w-full h-40 sm:h-44 flex-shrink-0" />
            <div className="p-3.5 flex flex-col flex-1">
                <div className="skeleton h-8 w-1/2 min-h-[32px]" />
                <div className="skeleton h-4 w-full mt-2 min-h-[2.6em]" />
                <div className="skeleton h-3 w-3/4 mt-1 min-h-[2.4em]" />
                <div className="skeleton h-7 w-24 mt-3 min-h-[32px]" />
                {/* Две строки чипов — как у реальной карточки */}
                <div className="skeleton h-[54px] w-full mt-2" />
                <div className="skeleton h-11 w-full mt-auto" />
            </div>
        </div>
    );
}

/**
 * Горизонтальная лента с автопрокруткой, точками и стрелками.
 *
 * Листается сама (~4 с на карточку), останавливается при наведении мыши,
 * при касании на телефоне и при фокусе с клавиатуры; свайп и перетаскивание
 * мышью отданы классу `.hscroll` (он это уже умеет). Стрелки — только
 * на десктопе, точки-индикаторы — на всех экранах.
 */
function CommunitySlider({ title, emoji, ariaLabel, count, children }) {
    const railRef = useRef(null);
    const resumeTimer = useRef(null);
    const [index, setIndex] = useState(0);
    // Две независимые причины паузы: наведение/касание и явная кнопка «⏸».
    // Разделяем их, чтобы пауза, включённая человеком, не снималась уходом мыши.
    const [autoPaused, setAutoPaused] = useState(false);
    const [userPaused, setUserPaused] = useState(false);
    const paused = autoPaused || userPaused;
    const reducedMotion = useMemo(prefersReducedMotion, []);

    const clearResume = useCallback(() => {
        if (resumeTimer.current) {
            window.clearTimeout(resumeTimer.current);
            resumeTimer.current = null;
        }
    }, []);

    // Уходим со страницы — таймеры за собой убираем
    useEffect(() => () => clearResume(), [clearResume]);

    const scrollToIndex = useCallback(
        (next, instant = false) => {
            const rail = railRef.current;
            if (!rail) return;
            const offsets = laneOffsets(rail);
            if (offsets.length === 0) return;

            const target = ((next % offsets.length) + offsets.length) % offsets.length;
            const behavior = instant || reducedMotion ? 'auto' : 'smooth';
            if (typeof rail.scrollTo === 'function') {
                rail.scrollTo({ left: offsets[target], behavior });
            } else {
                rail.scrollLeft = offsets[target];
            }
            setIndex(target);
        },
        [reducedMotion]
    );

    // Автопрокрутка: пауза (наведение/касание/фокус), скрытая вкладка
    useEffect(() => {
        if (paused || reducedMotion || count < 2) return undefined;

        const timer = window.setInterval(() => {
            const rail = railRef.current;
            if (!rail) return;
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;

            const step = laneStep(rail);
            const offsets = laneOffsets(rail);
            if (!step || offsets.length === 0) return;
            // Всё влезло в экран — листать нечего
            if (rail.scrollWidth <= rail.clientWidth + 2) return;

            // Край ленты — возвращаемся к началу без обратного проезда через все карточки
            const atEnd = rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 2;
            if (atEnd) {
                scrollToIndex(0, true);
                return;
            }

            const current = Math.round(rail.scrollLeft / step);
            scrollToIndex(Math.min(current + 1, offsets.length - 1));
        }, SLIDE_INTERVAL);

        return () => window.clearInterval(timer);
    }, [paused, reducedMotion, count, scrollToIndex]);

    // Свайп руками: точки должны успевать за пальцем
    useEffect(() => {
        const rail = railRef.current;
        if (!rail) return undefined;

        let frame = 0;
        const sync = () => {
            if (frame) return;
            frame = window.requestAnimationFrame(() => {
                frame = 0;
                const offsets = laneOffsets(rail);
                if (offsets.length === 0) return;

                let best = 0;
                let bestDiff = Infinity;
                offsets.forEach((offset, position) => {
                    const diff = Math.abs(offset - rail.scrollLeft);
                    if (diff < bestDiff) {
                        bestDiff = diff;
                        best = position;
                    }
                });
                setIndex(best);
            });
        };

        rail.addEventListener('scroll', sync, { passive: true });
        return () => {
            rail.removeEventListener('scroll', sync);
            if (frame) window.cancelAnimationFrame(frame);
        };
    }, [count]);

    const pauseAuto = useCallback(() => {
        clearResume();
        setAutoPaused(true);
    }, [clearResume]);

    const resumeAuto = useCallback(() => {
        clearResume();
        setAutoPaused(false);
    }, [clearResume]);

    // После касания не возобновляем мгновенно — иначе карточка «уезжает» из-под пальца
    const resumeAutoSoon = useCallback(() => {
        clearResume();
        resumeTimer.current = window.setTimeout(() => {
            resumeTimer.current = null;
            setAutoPaused(false);
        }, RESUME_DELAY);
    }, [clearResume]);

    const handlePointerEnter = (event) => {
        if (event.pointerType === 'mouse') pauseAuto();
    };

    const handlePointerLeave = (event) => {
        if (event.pointerType === 'mouse') resumeAuto();
    };

    return (
        <section
            className="mt-5"
            onPointerEnter={handlePointerEnter}
            onPointerLeave={handlePointerLeave}
            onTouchStart={pauseAuto}
            onTouchEnd={resumeAutoSoon}
            onTouchCancel={resumeAutoSoon}
            onFocusCapture={pauseAuto}
            onBlurCapture={resumeAuto}
        >
            <div className="flex items-start justify-between gap-2">
                <h3 className="section-title min-w-0">
                    <span aria-hidden="true">{emoji}</span>
                    <span className="line-clamp-1">{title}</span>
                </h3>

                {count > 1 && (
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button
                            type="button"
                            onClick={() => setUserPaused((value) => !value)}
                            aria-label={
                                userPaused ? 'Включить автопрокрутку' : 'Приостановить автопрокрутку'
                            }
                            aria-pressed={userPaused}
                            className="w-11 h-11 inline-flex items-center justify-center rounded-full text-ink-500 dark:text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors"
                        >
                            <span aria-hidden="true">{userPaused ? '▶' : '⏸'}</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => scrollToIndex(index - 1)}
                            aria-label="Предыдущие карточки"
                            className="hidden sm:inline-flex w-11 h-11 items-center justify-center rounded-full border border-ink-200 dark:border-ink-700 text-ink-600 dark:text-ink-300 hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors"
                        >
                            <span aria-hidden="true">‹</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => scrollToIndex(index + 1)}
                            aria-label="Следующие карточки"
                            className="hidden sm:inline-flex w-11 h-11 items-center justify-center rounded-full border border-ink-200 dark:border-ink-700 text-ink-600 dark:text-ink-300 hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors"
                        >
                            <span aria-hidden="true">›</span>
                        </button>
                    </div>
                )}
            </div>

            <div
                ref={railRef}
                className="hscroll mt-2 -mx-3 px-3 sm:mx-0 sm:px-0"
                role="group"
                aria-label={ariaLabel}
            >
                {children}
            </div>

            {count > 1 && (
                <div className="flex flex-wrap items-center justify-center gap-0.5 mt-1">
                    {Array.from({ length: count }, (_, position) => (
                        <button
                            key={position}
                            type="button"
                            onClick={() => scrollToIndex(position)}
                            aria-label={`Карточка ${position + 1} из ${count}`}
                            aria-current={position === index ? 'true' : undefined}
                            className="w-7 min-h-[44px] inline-flex items-center justify-center"
                        >
                            <span
                                aria-hidden="true"
                                className={`block h-2 rounded-full transition-all duration-300 ease-smeta ${
                                    position === index
                                        ? 'w-5 bg-primary-500 dark:bg-primary-400'
                                        : 'w-2 bg-ink-300 dark:bg-ink-600'
                                }`}
                            />
                        </button>
                    ))}
                </div>
            )}
        </section>
    );
}

/** Плашка «что можно делать»: иконка, заголовок, короткое пояснение. */
function FeatureCard({ emoji, title, text }) {
    return (
        <div className="card p-4 flex items-start gap-3">
            <span
                aria-hidden="true"
                className="w-11 h-11 rounded-2xl bg-primary-50 dark:bg-primary-500/15 text-primary-600 dark:text-primary-300 flex items-center justify-center text-xl flex-shrink-0"
            >
                {emoji}
            </span>
            <div className="min-w-0">
                <p className="font-display font-extrabold text-ink-900 dark:text-white">{title}</p>
                <p className="text-sm text-ink-500 dark:text-ink-400 mt-0.5">{text}</p>
            </div>
        </div>
    );
}

function GuestsLanding() {
    // null — лента ещё грузится, [] — не получилось или пусто
    const [baskets, setBaskets] = useState(null);
    const [dishes, setDishes] = useState(null);

    useEffect(() => {
        let cancelled = false;

        const load = (promise, apply) => {
            promise
                .then((result) => {
                    if (cancelled) return;
                    apply(Array.isArray(result?.items) ? result.items : []);
                })
                // Гость не должен видеть ошибок загрузки: не вышло — лента просто не показывается
                .catch(() => {
                    if (!cancelled) apply([]);
                });
        };

        load(getBasketFeed({ sort: 'popular', limit: FEED_LIMIT }), setBaskets);
        load(getDishFeed({ sort: 'popular', limit: FEED_LIMIT }), setDishes);

        return () => {
            cancelled = true;
        };
    }, []);

    const communityLoading = baskets === null || dishes === null;
    const basketItems = baskets || [];
    const dishItems = dishes || [];
    const hasCommunity = basketItems.length > 0 || dishItems.length > 0;

    return (
        <div className="max-w-5xl mx-auto animate-fade-in pb-bottom-nav">
            {/* Герой: что это за сервис и что делать прямо сейчас */}
            <section className="rounded-3xl bg-gradient-to-br from-primary-600 via-primary-700 to-ink-900 text-white p-4 sm:p-6 shadow-brand">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15 text-[11px] font-bold uppercase tracking-wide">
                    🧺 подбор по бюджету
                </span>
                <h1 className="mt-3 text-2xl sm:text-3xl md:text-4xl font-extrabold tracking-tight">
                    Сколько у вас на еду? Соберите закупку под свой бюджет
                </h1>
                <p className="mt-2 text-sm sm:text-base text-white/85 max-w-xl">
                    Сервис собирает набор продуктов под вашу сумму и показывает, что из него можно
                    приготовить: список покупок с ценами магазинов и блюда из этого набора.
                </p>

                <div className="flex flex-col sm:flex-row gap-2.5 mt-5">
                    <Link to="/register" className="btn-primary btn-block sm:w-auto sm:px-7 text-base">
                        Зарегистрироваться
                    </Link>
                    <Link
                        to="/login"
                        className="btn-secondary btn-block sm:w-auto sm:px-7 text-base bg-white/15 text-white border border-white/30 hover:bg-white/25 dark:bg-white/15 dark:hover:bg-white/25 dark:text-white"
                    >
                        Войти
                    </Link>
                </div>

                <p className="mt-3 text-xs text-white/75">
                    Бесплатно. Достаточно суммы на закупку — считать сметы можно сразу после входа.
                </p>
            </section>

            {/* Что можно делать в сервисе */}
            <section className="mt-6">
                <h2 className="heading-2">Что здесь можно делать</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                    {FEATURES.map((feature) => (
                        <FeatureCard key={feature.title} {...feature} />
                    ))}
                </div>
            </section>

            {/* Как это работает: три шага */}
            <section className="mt-6">
                <h2 className="heading-2">Как это работает</h2>
                <ol className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                    {STEPS.map((step, position) => (
                        <li key={step.title} className="card p-4">
                            <span className="w-9 h-9 rounded-full bg-primary-500 dark:bg-primary-600 text-white font-display font-extrabold flex items-center justify-center">
                                {position + 1}
                            </span>
                            <p className="mt-2.5 font-display font-extrabold text-ink-900 dark:text-white">
                                {step.title}
                            </p>
                            <p className="text-sm text-ink-500 dark:text-ink-400 mt-0.5">{step.text}</p>
                        </li>
                    ))}
                </ol>
            </section>

            {/* Сообщество: автопрезентация публичных наборов и блюд */}
            {(communityLoading || hasCommunity) && (
                <section className="mt-6">
                    <h2 className="heading-2">Смотрите, какое у нас сообщество</h2>
                    <p className="text-sm text-ink-500 dark:text-ink-400 mt-1">
                        Публичные наборы и блюда с ценами. Ленты листаются сами — или свайпом, как удобно.
                    </p>

                    {communityLoading ? (
                        <div className="hscroll mt-4 -mx-3 px-3 sm:mx-0 sm:px-0" aria-hidden="true">
                            {[0, 1, 2].map((key) => (
                                <SlideSkeleton key={key} />
                            ))}
                        </div>
                    ) : (
                        <>
                            {basketItems.length > 0 && (
                                <CommunitySlider
                                    title="Популярные наборы"
                                    emoji="🧺"
                                    ariaLabel="Популярные наборы сообщества"
                                    count={basketItems.length}
                                >
                                    {basketItems.map((basket) => (
                                        <div key={`basket-${basket.id}`} className={`${SLIDE_WIDTH} flex items-stretch`}>
                                            <BasketCard basket={basket} guestMode />
                                        </div>
                                    ))}
                                </CommunitySlider>
                            )}

                            {dishItems.length > 0 && (
                                <CommunitySlider
                                    title="Блюда из наборов"
                                    emoji="🍲"
                                    ariaLabel="Популярные блюда сообщества"
                                    count={dishItems.length}
                                >
                                    {dishItems.map((dish) => (
                                        <div
                                            key={`dish-${dish.recipe_id}-${dish.basket_id}`}
                                            className={`${SLIDE_WIDTH} flex items-stretch`}
                                        >
                                            <DishCard dish={dish} guestMode />
                                        </div>
                                    ))}
                                </CommunitySlider>
                            )}
                        </>
                    )}
                </section>
            )}

            {/* PWA: сервис живёт на телефоне */}
            <section className="card p-4 mt-6 flex items-start gap-3">
                <span
                    aria-hidden="true"
                    className="w-11 h-11 rounded-2xl bg-secondary-50 dark:bg-secondary-500/15 text-secondary-600 dark:text-secondary-300 flex items-center justify-center text-xl flex-shrink-0"
                >
                    📲
                </span>
                <div className="min-w-0">
                    <p className="font-display font-extrabold text-ink-900 dark:text-white">
                        Работает на телефоне
                    </p>
                    <p className="text-sm text-ink-500 dark:text-ink-400 mt-0.5">
                        Добавьте на главный экран — будет как приложение: список покупок под рукой
                        прямо в магазине.
                    </p>
                </div>
            </section>

            {/* Финальный призыв */}
            <section className="mt-6 rounded-3xl bg-gradient-to-br from-primary-600 via-primary-700 to-ink-900 text-white p-5 sm:p-6 shadow-brand text-center">
                <h2 className="font-display text-xl sm:text-2xl md:text-3xl font-extrabold tracking-tight">
                    Создайте аккаунт — это минута
                </h2>
                <p className="mt-1.5 text-sm text-white/85 max-w-xl mx-auto">
                    Свои наборы, список покупок с ценами и блюда из одной закупки. Регистрация
                    бесплатная.
                </p>
                <div className="flex flex-col sm:flex-row gap-2.5 justify-center sm:items-center mt-4">
                    <Link to="/register" className="btn-primary btn-block sm:w-auto sm:px-7 text-base">
                        Зарегистрироваться
                    </Link>
                    <Link
                        to="/login"
                        className="btn-secondary btn-block sm:w-auto sm:px-7 text-base bg-white/15 text-white border border-white/30 hover:bg-white/25 dark:bg-white/15 dark:hover:bg-white/25 dark:text-white"
                    >
                        Войти
                    </Link>
                </div>
            </section>
        </div>
    );
}

export default GuestsLanding;
