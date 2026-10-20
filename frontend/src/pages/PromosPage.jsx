import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { deletePromo, getMyPromos, getPromos } from '../services/smeta';
import PromoCard from '../components/PromoCard';
import PromoForm from '../components/PromoForm';

const CITY_KEY = 'recartly_city_id';

const TABS = [
    { key: 'hot', label: 'Горячие', emoji: '🔥', sort: 'hot' },
    { key: 'new', label: 'Свежие', emoji: '🆕', sort: 'new' },
    { key: 'discount', label: 'Максимальная скидка', emoji: '💸', sort: 'discount' },
    { key: 'mine', label: 'Мои акции', emoji: '👤', sort: null },
];

const PAGE_LIMIT = 30;

/* Скелетонов ровно столько, сколько помещается в ряд на десктопе */
const SKELETON_KEYS = [0, 1, 2, 3, 4, 5];

/**
 * Скелетон карточки акции — по структуре PromoCard: квадрат ценника слева
 * (w-16 h-16 sm:w-[72px] sm:h-[72px]) и тело с блоками тех же высот, что
 * заголовок, теги, цена, метаданные и ряд кнопок (у PromoCard это min-h-значения).
 */
function PromoSkeleton() {
    return (
        <article className="card p-3 sm:p-3.5 flex gap-3 h-full" aria-hidden="true">
            <div className="skeleton w-16 h-16 sm:w-[72px] sm:h-[72px] rounded-2xl flex-shrink-0" />
            <div className="flex-1 min-w-0 flex flex-col">
                <div className="skeleton min-h-[2.6em] w-4/5" />
                <div className="skeleton min-h-[54px] w-1/2 mt-1.5" />
                <div className="skeleton min-h-[32px] w-1/3 mt-1.5" />
                <div className="skeleton min-h-[20px] w-3/4 mt-1.5" />
                <div className="skeleton min-h-[44px] w-full mt-auto" />
            </div>
        </article>
    );
}

/**
 * Страница «Акции в вашем городе»: лента от людей с табами и «Моими акциями».
 *
 * Публичные табы читают `/promos/`, вкладка «Мои акции» — `/promos/my` со всеми
 * статусами модерации, поэтому у своих карточек видно плашку статуса и удаление.
 */
function PromosPage() {
    const navigate = useNavigate();
    const [tab, setTab] = useState('hot');
    const [cityId] = useState(() => Number(localStorage.getItem(CITY_KEY)) || null);
    const [data, setData] = useState({ total: 0, items: [] });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [sheetOpen, setSheetOpen] = useState(false);
    const [deletingId, setDeletingId] = useState(null);

    const isAuthenticated = !!localStorage.getItem('access_token');
    const isMine = tab === 'mine';
    const activeTab = TABS.find((item) => item.key === tab) || TABS[0];

    const load = useCallback(() => {
        if (isMine && !isAuthenticated) {
            setData({ total: 0, items: [] });
            setLoading(false);
            setError('');
            return undefined;
        }

        let cancelled = false;
        setLoading(true);
        setError('');

        const promise = isMine
            ? getMyPromos(PAGE_LIMIT)
            : getPromos({ city_id: cityId, sort: activeTab.sort, limit: PAGE_LIMIT });

        promise
            .then((result) => {
                if (cancelled) return;
                setData({
                    total: Number(result?.total) || 0,
                    items: result?.items || [],
                });
            })
            .catch((err) => {
                if (!cancelled) {
                    setData({ total: 0, items: [] });
                    setError(err.message || 'Не удалось загрузить акции');
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [isMine, isAuthenticated, cityId, activeTab.sort]);

    useEffect(() => load(), [load]);

    // Новая акция (своя или чужая) — список перечитывается
    useEffect(() => {
        const onChange = () => load();
        window.addEventListener('promosChange', onChange);
        return () => window.removeEventListener('promosChange', onChange);
    }, [load]);

    const handleShare = () => {
        if (!isAuthenticated) {
            navigate('/login');
            return;
        }
        setSheetOpen(true);
    };

    const handleDelete = async (promo) => {
        if (!window.confirm(`Удалить акцию «${promo.title || 'без названия'}»?`)) return;
        setDeletingId(promo.id);
        setError('');
        try {
            await deletePromo(promo.id);
            window.dispatchEvent(new Event('promosChange'));
            setData((prev) => ({
                total: Math.max(0, prev.total - 1),
                items: prev.items.filter((row) => row.id !== promo.id),
            }));
        } catch (err) {
            setError(err.message || 'Не удалось удалить акцию');
        } finally {
            setDeletingId(null);
        }
    };

    const items = data.items;

    return (
        <div className="max-w-5xl mx-auto animate-fade-in pb-bottom-nav">
            <header className="mb-4">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 mb-2 rounded-full bg-primary-100 dark:bg-primary-900/25 text-primary-700 dark:text-primary-300 text-[11px] font-bold uppercase tracking-wide">
                    🏷️ акции
                </span>
                <h1 className="heading-1">Акции в вашем городе</h1>
                <p className="text-sm text-ink-500 dark:text-ink-400 mt-1.5">
                    Цены приносят люди, публикуем после проверки. Увидели ценник со скидкой — поделитесь,
                    и акцию увидят соседи по городу.
                </p>

                <div className="flex flex-wrap items-center gap-2 mt-3">
                    <button
                        type="button"
                        onClick={handleShare}
                        className="btn-primary btn-block sm:w-auto sm:inline-flex"
                    >
                        ＋ Поделиться акцией
                    </button>
                    {!isAuthenticated && (
                        <Link
                            to="/login"
                            className="btn-secondary btn-block sm:w-auto sm:inline-flex"
                        >
                            Войти
                        </Link>
                    )}
                </div>
            </header>

            <div className="hscroll mb-4" role="tablist" aria-label="Сортировка акций">
                {TABS.map((item) => (
                    <button
                        key={item.key}
                        type="button"
                        role="tab"
                        aria-selected={tab === item.key}
                        onClick={() => {
                            if (item.key === tab) return;
                            // Скелетоны включаются сразу: без этого кадр со старой
                            // лентой под новым табом «дёргал» высоту страницы
                            setLoading(true);
                            setTab(item.key);
                        }}
                        className={`tab-pill !min-h-[44px] ${tab === item.key ? 'tab-pill-active' : ''}`}
                    >
                        <span aria-hidden="true">{item.emoji}</span>
                        {item.label}
                    </button>
                ))}
            </div>

            {/* Ошибка: единая плашка с иконкой, пояснением и «Повторить» */}
            {error && (
                <div className="card p-6 mb-3 text-center border-hot-500/40">
                    <div className="w-14 h-14 mx-auto rounded-3xl bg-hot-50 dark:bg-hot-500/15 flex items-center justify-center text-2xl mb-3">
                        ⚠️
                    </div>
                    <p className="text-sm font-semibold text-ink-700 dark:text-ink-200">
                        Не удалось загрузить акции
                    </p>
                    <p className="text-xs text-hot-600 dark:text-hot-400 mt-1 mb-4 break-words">{error}</p>
                    <button
                        type="button"
                        onClick={load}
                        className="btn-secondary btn-block sm:w-auto"
                    >
                        Повторить
                    </button>
                </div>
            )}

            {/* Выдача: min-h держит высоту страницы при смене табов */}
            <div className="min-h-[60vh]">
                {loading ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-stretch">
                        {SKELETON_KEYS.map((key) => (
                            <PromoSkeleton key={key} />
                        ))}
                    </div>
                ) : isMine && !isAuthenticated ? (
                    <div className="card p-6 text-center">
                        <div className="w-14 h-14 mx-auto rounded-3xl bg-primary-100 dark:bg-primary-900/25 flex items-center justify-center text-2xl mb-3">
                            👤
                        </div>
                        <p className="text-sm font-semibold text-ink-700 dark:text-ink-200">
                            Свои акции видны после входа
                        </p>
                        <p className="text-[11px] text-ink-400 dark:text-ink-500 mt-1 mb-4">
                            Войдите, чтобы видеть свои акции и их статус модерации.
                        </p>
                        <Link to="/login" className="btn-primary btn-block sm:w-auto sm:inline-flex">
                            Войти
                        </Link>
                    </div>
                ) : items.length === 0 ? (
                    <div className="card p-6 text-center">
                        <div className="w-14 h-14 mx-auto rounded-3xl bg-primary-100 dark:bg-primary-900/25 flex items-center justify-center text-2xl mb-3">
                            🏷️
                        </div>
                        <p className="text-sm font-semibold text-ink-700 dark:text-ink-200">
                            {isMine
                                ? 'Вы ещё не делились акциями'
                                : 'Пока акций нет — поделитесь первой'}
                        </p>
                        <p className="text-[11px] text-ink-400 dark:text-ink-500 mt-1 mb-4">
                            {isMine
                                ? 'Сфотографируйте ценник со скидкой — акция появится здесь со статусом проверки.'
                                : 'Акции публикуют покупатели: увидели скидку в магазине — рассказали остальным.'}
                        </p>
                        <button
                            type="button"
                            onClick={handleShare}
                            className="btn-primary btn-block sm:w-auto sm:inline-flex"
                        >
                            ＋ Поделиться акцией
                        </button>
                    </div>
                ) : (
                    <>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-stretch">
                            {items.map((promo) => (
                                <PromoCard
                                    key={promo.id}
                                    promo={promo}
                                    showStatus={isMine}
                                    onDelete={isMine ? handleDelete : null}
                                    deleting={deletingId === promo.id}
                                />
                            ))}
                        </div>

                        <p className="text-[11px] text-ink-400 dark:text-ink-500 mt-3">
                            Показано {items.length}
                            {data.total > items.length ? ` из ${data.total}` : ''}. Акции проходят
                            проверку модерации, недобросовестные ценники удаляются.
                        </p>
                    </>
                )}
            </div>

            <PromoForm
                open={sheetOpen}
                onClose={() => setSheetOpen(false)}
                cityId={cityId}
            />
        </div>
    );
}

export default PromosPage;
