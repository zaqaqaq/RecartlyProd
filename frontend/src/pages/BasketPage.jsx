import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
    addBasketComment,
    deleteBasket,
    getBasket,
    getBasketComments,
    getBasketRecipes,
    getSharedBasket,
    likeBasket,
    patchBasketItem,
    setBasketVisibility,
    shareBasket,
    unlikeBasket,
    updateBasketPrices,
} from '../services/smeta';
import { uploadPhoto } from '../services/api';
import { mediaUrl } from '../utils/media';
import { formatCount, formatMoney, pluralRu, pricesFreshnessMeta } from '../components/BasketCard';
import BasketCommentList from '../components/BasketCommentList';

/* ============================================================
   Карточка набора — центральная сущность продукта.

   Набор = корзина продуктов с ценой, датой покупки и магазинами.
   Цена живёт только здесь: блюдо цены не имеет, его оценивают через набор
   («что можно приготовить из этого набора»).

   Помощники формата (деньги, число, склонения, метка свежести) берём из
   BasketCard — так карточка набора в ленте и его страница выглядят одинаково.
   ============================================================ */

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/* Количество бывает дробным (0,5 кг), поэтому округлять его нельзя. */
const QUANTITY_FORMATTER = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const formatQuantity = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? QUANTITY_FORMATTER.format(numeric) : '';
};

/** Сегодняшняя дата в формате `<input type="date">` (локальная, без сдвига по UTC). */
const todayIso = () => {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

/**
 * Значение `type="date"` → ISO-datetime для backend.
 * Полдень выбранного дня: дата покупки не «съезжает» из-за часового пояса,
 * а backend требует именно datetime (строка `2026-10-05` даёт 400).
 */
const toIsoDateTime = (dateStr) => {
    if (!dateStr) return null;
    const local = new Date(`${dateStr}T12:00:00`);
    return Number.isNaN(local.getTime()) ? null : local.toISOString();
};

/** Дата в человеческом виде: «22 сентября 2026». */
const formatFullDate = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
};

/** Аватар автора: поддерживает 'emoji:😀:bg-…:text-…' и обычный путь из /uploads. */
function AuthorAvatar({ username, avatarUrl, size = 'w-9 h-9 text-sm' }) {
    const initial = username ? username[0].toUpperCase() : '?';

    if (avatarUrl && avatarUrl.startsWith('emoji:')) {
        const [, emoji, bg = 'bg-primary-100 dark:bg-primary-900/30', text = 'text-primary-600 dark:text-primary-300'] =
            avatarUrl.split(':');
        return (
            <span className={`avatar ${bg} ${text} flex items-center justify-center ${size}`} aria-hidden="true">
                {emoji}
            </span>
        );
    }

    if (avatarUrl) {
        return <img src={mediaUrl(avatarUrl)} alt="" className={`avatar object-cover ${size}`} />;
    }

    return (
        <span className={`avatar flex items-center justify-center ${size}`} aria-hidden="true">
            {initial}
        </span>
    );
}

/**
 * Строка позиции: фото покупки, название, количество, магазин и цена
 * (со зачёркнутой старой).
 *
 * Миниатюра фиксированная (44×44, `flex-shrink-0`, `object-cover`) — высота
 * строки не зависит от того, загрузилась картинка или нет, и строки остаются
 * ровными. Битое фото просто прячем.
 */
function BasketItemRow({ item, checkable, onToggle, busy }) {
    const hasPrev = item.prev_price != null && Number(item.prev_price) !== Number(item.price);
    const checked = Boolean(item.is_checked);
    const [photoBroken, setPhotoBroken] = useState(false);

    // Другая ссылка на фото — снова пробуем показать картинку
    useEffect(() => {
        setPhotoBroken(false);
    }, [item.photo_url]);

    const photo = item.photo_url && !photoBroken ? mediaUrl(item.photo_url) : null;

    const body = (
        <>
            {checkable && (
                <input
                    type="checkbox"
                    checked={checked}
                    disabled={busy}
                    onChange={() => onToggle(item)}
                    aria-label={`Куплено: ${item.name}`}
                    className="w-5 h-5 flex-shrink-0 rounded-md border-ink-300 text-primary-500 focus:ring-primary-500/50"
                />
            )}

            <span className="flex-1 min-w-0">
                <span
                    className={`block text-sm font-medium break-words ${
                        checked
                            ? 'line-through text-ink-400 dark:text-ink-500'
                            : 'text-ink-800 dark:text-ink-100'
                    }`}
                >
                    {item.name}
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-ink-400 dark:text-ink-500 tabular-nums">
                        {item.quantity != null && item.quantity !== ''
                            ? `${formatQuantity(item.quantity)} `
                            : ''}
                        {item.unit || ''}
                    </span>
                    {item.shop_name && (
                        <span className="tag !py-0.5 !px-2">
                            <span aria-hidden="true">{item.shop_emoji || '🏬'}</span>
                            {item.shop_name}
                        </span>
                    )}
                </span>
            </span>

            <span className="flex flex-col items-end flex-shrink-0">
                <span className={`price ${checked ? 'opacity-60' : ''}`}>
                    {formatMoney(item.price)}
                    <span className="text-[11px]"> ₽</span>
                </span>
                {hasPrev && (
                    <span
                        className="text-xs text-ink-400 dark:text-ink-500 line-through tabular-nums"
                        title="Цена до последнего обновления"
                    >
                        {formatMoney(item.prev_price)} ₽
                    </span>
                )}
            </span>
        </>
    );

    return (
        <div className="check-row">
            {/* Фото покупки у позиции — миниатюра слева. Отдельная ссылка вне <label>:
                иначе клик открывал бы картинку и заодно переключал чекбокс семейного режима. */}
            {photo && (
                <a
                    href={photo}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Открыть фото покупки: ${item.name}`}
                    className="w-11 h-11 flex-shrink-0 inline-flex rounded-xl overflow-hidden border border-ink-200 dark:border-ink-800 bg-ink-100 dark:bg-ink-800"
                >
                    <img
                        src={photo}
                        alt=""
                        loading="lazy"
                        onError={() => setPhotoBroken(true)}
                        className="w-full h-full object-cover"
                    />
                </a>
            )}

            {checkable ? (
                <label className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer">
                    {body}
                </label>
            ) : (
                <div className="flex items-center gap-3 flex-1 min-w-0">{body}</div>
            )}
        </div>
    );
}

/**
 * Страница набора: картинка набора, цена и свежесть цен, состав с магазинами,
 * блюда, которые готовятся из набора, обсуждение и лайки.
 *
 * На широких экранах (lg:) — две колонки: слева карточка и состав, справа
 * закреплённое обсуждение. На мобильных одна колонка, обсуждение внизу.
 *
 * Обновлять цены, менять видимость, делиться ссылкой и удалять набор может
 * только автор.
 */
function BasketPage() {
    const { id, token } = useParams();
    const navigate = useNavigate();

    const [basket, setBasket] = useState(null);
    const [recipes, setRecipes] = useState([]);
    const [comments, setComments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [liking, setLiking] = useState(false);
    const [togglingItemId, setTogglingItemId] = useState(null);

    // Обновление цен (bottom-sheet)
    const [pricesOpen, setPricesOpen] = useState(false);
    const [pricesDate, setPricesDate] = useState(todayIso());
    const [priceValues, setPriceValues] = useState({});
    const [receipt, setReceipt] = useState(null);
    const [uploadingPhoto, setUploadingPhoto] = useState(false);
    const [savingPrices, setSavingPrices] = useState(false);
    const [pricesError, setPricesError] = useState('');
    const receiptInputRef = useRef(null);

    // Обсуждение
    const [commentText, setCommentText] = useState('');
    const [replyTo, setReplyTo] = useState(null);
    const [sendingComment, setSendingComment] = useState(false);

    // Действия автора
    const [sharing, setSharing] = useState(false);
    const [shareUrl, setShareUrl] = useState('');
    const [deleting, setDeleting] = useState(false);
    const [togglingVisibility, setTogglingVisibility] = useState(false);
    const [photoBroken, setPhotoBroken] = useState(false);

    const isAuthenticated = Boolean(localStorage.getItem('access_token'));
    const isSharedView = Boolean(token) && !id;
    const basketId = basket?.id ?? null;

    // Автор определяется по имени пользователя: backend не отдаёт user_id набора
    const currentUsername = localStorage.getItem('username');
    const isOwner = Boolean(
        isAuthenticated && currentUsername && basket?.username && basket.username === currentUsername
    );

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError('');
        // Другой набор — другая картинка: сбрасываем признак битого фото
        setPhotoBroken(false);
        const loader = token ? getSharedBasket(token) : getBasket(id);
        loader
            .then((data) => {
                if (!cancelled) setBasket(data);
            })
            .catch((err) => {
                if (!cancelled) setError(err.message || 'Не удалось открыть набор');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [id, token]);

    // Блюда из набора и обсуждение — только когда набор уже загружен
    useEffect(() => {
        if (!basketId) return undefined;
        let cancelled = false;

        getBasketRecipes(basketId)
            .then((list) => {
                if (!cancelled) setRecipes(list || []);
            })
            .catch(() => {
                if (!cancelled) setRecipes([]);
            });

        getBasketComments(basketId)
            .then((list) => {
                if (!cancelled) setComments(list || []);
            })
            .catch(() => undefined);

        return () => {
            cancelled = true;
        };
    }, [basketId]);

    // Подсказка об успехе гаснет сама
    useEffect(() => {
        if (!notice) return undefined;
        const timer = setTimeout(() => setNotice(''), 4000);
        return () => clearTimeout(timer);
    }, [notice]);

    // Escape закрывает форму обновления цен
    useEffect(() => {
        if (!pricesOpen) return undefined;
        const onKeyDown = (event) => {
            if (event.key === 'Escape') setPricesOpen(false);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [pricesOpen]);

    const fresh = useMemo(
        () => pricesFreshnessMeta(basket?.prices_freshness, basket?.prices_date),
        [basket?.prices_freshness, basket?.prices_date]
    );

    const items = basket?.items || [];
    const servings = Number(basket?.servings) || 0;
    const checkedCount = items.filter((item) => item.is_checked).length;

    /**
     * Ответы API приходят в разных объёмах: like/visibility отвечают без состава
     * (items: []), обновление цен — полным набором. Состав не теряем: пустой
     * список items оставляем прежним.
     */
    const applyBasketPatch = (updated) => {
        if (!updated) return;
        setBasket((prev) => ({
            ...prev,
            ...updated,
            items: Array.isArray(updated.items) && updated.items.length ? updated.items : prev?.items || [],
        }));
    };

    const handleLike = async () => {
        if (!isAuthenticated) {
            navigate('/login');
            return;
        }
        if (!basketId || liking) return;

        const wasLiked = Boolean(basket.is_liked);
        setLiking(true);
        // Оптимистично: сердечко меняется сразу, при ошибке откатываем
        setBasket((prev) => ({
            ...prev,
            is_liked: !wasLiked,
            likes_count: Math.max(0, (Number(prev.likes_count) || 0) + (wasLiked ? -1 : 1)),
        }));

        try {
            const updated = wasLiked ? await unlikeBasket(basketId) : await likeBasket(basketId);
            // like/unlike отвечают без состава — переносим только счётчики
            setBasket((prev) => ({
                ...prev,
                is_liked: Boolean(updated.is_liked),
                likes_count: Number(updated.likes_count) || 0,
            }));
        } catch (err) {
            setBasket((prev) => ({
                ...prev,
                is_liked: wasLiked,
                likes_count: Math.max(0, (Number(prev.likes_count) || 0) + (wasLiked ? 1 : -1)),
            }));
            setError(err.message || 'Не удалось обновить лайк');
        } finally {
            setLiking(false);
        }
    };

    const handleToggleItem = async (item) => {
        if (!isAuthenticated) {
            navigate('/login');
            return;
        }
        if (togglingItemId) return;

        const nextChecked = !item.is_checked;
        setTogglingItemId(item.id);
        setBasket((prev) => ({
            ...prev,
            items: prev.items.map((row) =>
                row.id === item.id ? { ...row, is_checked: nextChecked } : row
            ),
        }));

        try {
            const updated = await patchBasketItem(basketId, item.id, { is_checked: nextChecked });
            setBasket(updated);
        } catch (err) {
            setBasket((prev) => ({
                ...prev,
                items: prev.items.map((row) =>
                    row.id === item.id ? { ...row, is_checked: item.is_checked } : row
                ),
            }));
            setError(err.message || 'Не удалось обновить позицию');
        } finally {
            setTogglingItemId(null);
        }
    };

    const openPrices = () => {
        setPricesDate(todayIso());
        setPriceValues(
            Object.fromEntries(
                items.map((item) => [item.id, item.price == null ? '' : String(item.price)])
            )
        );
        setReceipt(null);
        setPricesError('');
        setPricesOpen(true);
    };

    const handleReceiptChange = async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;

        if (file.size > MAX_PHOTO_BYTES) {
            setPricesError('Фото чека больше 5 МБ — выберите файл поменьше');
            event.target.value = '';
            return;
        }

        setUploadingPhoto(true);
        setPricesError('');
        try {
            const formData = new FormData();
            formData.append('file', file);
            // Отдельной загрузки для наборов на backend нет, используем общий
            // загрузчик фото (возвращает { photo_url }).
            const data = await uploadPhoto(formData);
            setReceipt({ url: data.photo_url, name: file.name });
        } catch (err) {
            setPricesError(err.message || 'Не удалось загрузить фото чека');
        } finally {
            setUploadingPhoto(false);
            event.target.value = '';
        }
    };

    const handleSavePrices = async (event) => {
        event.preventDefault();
        if (!basketId) return;

        const isoDate = toIsoDateTime(pricesDate);
        if (!isoDate) {
            setPricesError('Укажите дату покупки');
            return;
        }

        // Отправляем только изменённые позиции: они уходят в историю как prev_price
        const changed = [];
        items.forEach((item) => {
            const raw = priceValues[item.id];
            if (raw === undefined || String(raw).trim() === '') return;
            const value = Number(String(raw).replace(',', '.').replace(/\s/g, ''));
            if (!Number.isFinite(value) || value < 0) return;
            if (Number(item.price) !== value) changed.push({ id: item.id, price: value });
        });

        setSavingPrices(true);
        setPricesError('');
        try {
            const updated = await updateBasketPrices(basketId, {
                prices_date: isoDate,
                photo_url: receipt?.url || null,
                items: changed,
            });
            // Ответ содержит полный набор: страница сразу показывает новые цены
            setBasket(updated);
            setPricesOpen(false);
            setNotice(
                changed.length
                    ? `Цены обновлены: ${formatCount(changed.length)} ${pluralRu(
                          changed.length,
                          'позиция',
                          'позиции',
                          'позиций'
                      )}`
                    : 'Дата покупки обновлена'
            );
        } catch (err) {
            setPricesError(err.message || 'Не удалось обновить цены');
        } finally {
            setSavingPrices(false);
        }
    };

    const handleCommentSubmit = async (event) => {
        event.preventDefault();
        if (!basketId) return;
        const text = commentText.trim();
        if (!text) return;

        setSendingComment(true);
        try {
            const created = await addBasketComment(basketId, { text, parent_id: replyTo?.id ?? null });
            if (created && created.id) {
                // POST отвечает готовым комментарием (с флагом is_mine) — добавляем его
                // в список, а не перечитываем обсуждение: так флаги не теряются
                setComments((prev) => [...prev, created]);
            } else {
                const list = await getBasketComments(basketId);
                setComments(list || []);
            }
            setCommentText('');
            setReplyTo(null);
        } catch (err) {
            setError(err.message || 'Не удалось отправить комментарий');
        } finally {
            setSendingComment(false);
        }
    };

    /** Скрыть набор из ленты или вернуть обратно — решает автор (правка 9). */
    const handleToggleVisibility = async () => {
        if (!basketId || togglingVisibility) return;

        const nextPublic = !basket.is_public;
        setTogglingVisibility(true);
        setError('');
        try {
            const updated = await setBasketVisibility(basketId, nextPublic);
            applyBasketPatch(updated);
            setNotice(nextPublic ? 'Набор снова виден в ленте' : 'Набор скрыт из ленты');
        } catch (err) {
            setError(err.message || 'Не удалось изменить видимость набора');
        } finally {
            setTogglingVisibility(false);
        }
    };

    const handleShare = async () => {
        if (!basketId || sharing) return;
        setSharing(true);
        try {
            const updated = await shareBasket(basketId, true);
            setBasket(updated);
            const url = `${window.location.origin}/basket/shared/${updated.share_token}`;
            setShareUrl(url);
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(url).catch(() => undefined);
            }
            setNotice('Ссылка на набор готова');
        } catch (err) {
            setError(err.message || 'Не удалось поделиться набором');
        } finally {
            setSharing(false);
        }
    };

    const handleDelete = async () => {
        if (!basketId || deleting) return;
        if (!window.confirm(`Удалить набор «${basket.title}»? Действие необратимо.`)) return;

        setDeleting(true);
        try {
            await deleteBasket(basketId);
            navigate('/my-baskets');
        } catch (err) {
            setError(err.message || 'Не удалось удалить набор');
            setDeleting(false);
        }
    };

    if (loading) {
        return (
            <div className="max-w-3xl mx-auto space-y-3 animate-fade-in">
                <div className="skeleton h-4 w-40" />
                <div className="skeleton h-32" />
                <div className="skeleton h-20" />
                <div className="skeleton h-20" />
            </div>
        );
    }

    if (!basket) {
        return (
            <div className="max-w-3xl mx-auto card p-6 text-center animate-fade-in">
                <div className="text-4xl mb-2" aria-hidden="true">
                    🧺
                </div>
                <p className="text-ink-600 dark:text-ink-300 mb-4">
                    {error || 'Набор не найден'}
                </p>
                <Link to="/" className="btn-primary">
                    К наборам
                </Link>
            </div>
        );
    }

    const photo = basket.photo_url && !photoBroken ? mediaUrl(basket.photo_url) : null;
    const receiptPhoto = basket.receipt_photo_url ? mediaUrl(basket.receipt_photo_url) : null;
    const coverageLabel = (recipe) =>
        `покрывает ${formatCount(recipe.coverage)} из ${formatCount(recipe.total_positions)} ингредиентов`;

    return (
        <div className="max-w-3xl mx-auto animate-fade-in pb-bottom-nav">
            {/* Хлебные крошки */}
            <nav className="text-xs text-ink-500 dark:text-ink-400 mb-2 flex items-center gap-1 min-w-0" aria-label="Навигация">
                <Link to="/" className="hover:text-primary-600 dark:hover:text-primary-400">
                    Наборы
                </Link>
                <span className="mx-1 text-ink-300 dark:text-ink-600">/</span>
                <span className="truncate text-ink-700 dark:text-ink-300">{basket.title}</span>
            </nav>

            {/* На широких экранах обсуждение уезжает в правую колонку (360 px) и
                закрепляется: состав и блюда можно листать, не теряя разговор.
                На мобильных колонка одна — обсуждение остаётся внизу. */}
            {/* Одноколоночный макет: обсуждение идёт после состава и действий */}
            <div className="space-y-4">
                <div>

                {/* Шапка: картинка набора, название, автор, цена и дата цен */}
                    <header className="card overflow-hidden">
                        {/* Правка 6 + 11: картинка набора (photo_url) — крупно сверху.
                            Фиксированная высота + object-cover + скруглённые верхние углы:
                            изображение вписывается целиком, без растягивания и «живой» обрезки. */}
                        {photo ? (
                            <a
                                href={photo}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block w-full h-56 sm:h-72 rounded-t-2xl overflow-hidden bg-ink-100 dark:bg-ink-800"
                                aria-label="Открыть фото набора"
                            >
                                <img
                                    src={photo}
                                    alt={`Фото набора «${basket.title}»`}
                                    className="w-full h-full object-cover"
                                    onError={() => setPhotoBroken(true)}
                                />
                            </a>
                        ) : (
                            <div
                                className="w-full h-40 sm:h-56 rounded-t-2xl bg-gradient-to-br from-primary-100 to-ink-100 dark:from-primary-900/30 dark:to-ink-850 flex flex-col items-center justify-center gap-1.5"
                                aria-hidden="true"
                            >
                                <span className="text-4xl">🧺</span>
                                <span className="text-xs font-semibold text-ink-500 dark:text-ink-400">
                                    Фото набора пока нет
                                </span>
                            </div>
                        )}

                        <div className="p-3.5 sm:p-5">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <h1 className="heading-2 break-words">{basket.title}</h1>
                                    <div className="mt-2 flex items-center gap-2 min-w-0">
                                        <AuthorAvatar username={basket.username} avatarUrl={basket.avatar_url} />
                                        <div className="min-w-0">
                                            <p className="text-sm font-semibold text-ink-800 dark:text-ink-100 truncate">
                                                {basket.username || 'Пользователь'}
                                            </p>
                                            <p className="text-xs text-ink-400 dark:text-ink-500">
                                                {basket.city_name ? `${basket.city_name} · ` : ''}
                                                {basket.prices_date
                                                    ? `цены собраны ${formatFullDate(basket.prices_date)}`
                                                    : 'дата цен не указана'}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {basket.description && (
                                <p className="mt-3 text-sm text-ink-600 dark:text-ink-300">{basket.description}</p>
                            )}

                            {/* Крупно: цена набора и «на N человек» */}
                            <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
                                <div>
                                    <span className="price price-lg">
                                        {formatMoney(basket.total_price)}
                                        <span className="text-base"> ₽</span>
                                    </span>
                                    <p className="mt-1 text-sm font-semibold text-ink-600 dark:text-ink-300">
                                        {servings > 0
                                            ? `на ${formatCount(servings)} ${pluralRu(
                                                  servings,
                                                  'человека',
                                                  'человека',
                                                  'человек'
                                              )}`
                                            : 'число порций не указано'}
                                    </p>
                                </div>

                                <div className="flex flex-wrap items-center gap-1.5">
                                    <span className={fresh.className} title={fresh.title}>
                                        {fresh.tone === 'stale' && isOwner ? `${fresh.label}, обновите` : fresh.label}
                                    </span>
                                    {Number(basket.budget) > 0 && (
                                        <span
                                            className={`budget-pill ${
                                                Number(basket.total_price) > Number(basket.budget)
                                                    ? 'budget-over'
                                                    : 'budget-ok'
                                            }`}
                                        >
                                            бюджет {formatMoney(basket.budget)} ₽
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Правка 6: фото чека (receipt_photo_url) — подтверждение цен.
                                Компактно в блоке цен и отдельно от картинки набора:
                                миниатюра + подпись «Фото чека», а не вместо основной картинки. */}
                            {receiptPhoto && (
                                <a
                                    href={receiptPhoto}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="mt-3 inline-flex items-center gap-2 min-h-[44px] pl-1.5 pr-3.5 py-1.5 rounded-2xl border border-ink-200 dark:border-ink-800 bg-ink-50 dark:bg-ink-850 hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors"
                                >
                                    <img src={receiptPhoto} alt="" loading="lazy" className="w-10 h-10 rounded-xl object-cover" />
                                    <span className="flex flex-col text-left">
                                        <span className="text-xs font-bold text-ink-700 dark:text-ink-200">📷 Фото чека</span>
                                        <span className="text-[11px] text-ink-400 dark:text-ink-500">
                                            открыть подтверждение цен
                                        </span>
                                    </span>
                                </a>
                            )}

                            <div className="mt-3 flex flex-wrap items-center gap-1.5">
                                <span className="tag">
                                    {formatCount(items.length)} {pluralRu(items.length, 'позиция', 'позиции', 'позиций')}
                                </span>
                                {basket.is_public ? (
                                    <span className="tag">🌍 публичный</span>
                                ) : (
                                    <span className="tag">🔒 приватный</span>
                                )}
                                {basket.status && basket.status !== 'published' && (
                                    <span className="tag">⏳ на модерации</span>
                                )}
                                {Number(basket.recipes_count) > 0 && (
                                    <span className="tag">
                                        🍲 {formatCount(basket.recipes_count)}{' '}
                                        {pluralRu(basket.recipes_count, 'блюдо', 'блюда', 'блюд')}
                                    </span>
                                )}
                            </div>

                            {/* Лайк и просмотры */}
                            <div className="mt-3 flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={handleLike}
                                    disabled={liking}
                                    aria-pressed={Boolean(basket.is_liked)}
                                    aria-label={basket.is_liked ? 'Убрать лайк' : 'Поставить лайк'}
                                    className={`inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-xl text-sm font-bold transition-colors disabled:opacity-60
                                    ${
                                        basket.is_liked
                                            ? 'text-hot-600 dark:text-hot-400 bg-hot-50 dark:bg-hot-500/10'
                                            : 'text-ink-500 dark:text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800'
                                    }`}
                                >
                                    <span aria-hidden="true">{basket.is_liked ? '❤️' : '🤍'}</span>
                                    <span className="tabular-nums">{formatCount(basket.likes_count)}</span>
                                </button>

                                <span className="tag">
                                    <span aria-hidden="true">👁</span>
                                    <span className="tabular-nums">{formatCount(basket.views_count)}</span>
                                    {pluralRu(basket.views_count, 'просмотр', 'просмотра', 'просмотров')}
                                </span>
                            </div>

                            {/* Цена и кнопка обновления — только автор */}
                            {isOwner && (
                                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    <button type="button" onClick={openPrices} className="btn-primary">
                                        💰 Обновить цены
                                    </button>
                                    {basket.recipe_id && (
                                        <Link
                                            to={`/recipe/${basket.recipe_id}`}
                                            className="btn-secondary"
                                        >
                                            🍲 Блюдо набора
                                        </Link>
                                    )}
                                </div>
                            )}

                            {!isOwner && (
                                <p className="mt-3 text-xs text-ink-400 dark:text-ink-500">
                                    Цены обновляет автор набора — вы видите состав и дату покупки.
                                </p>
                            )}

                            {!isSharedView && !isAuthenticated && (
                                <p className="mt-3 text-xs text-ink-500 dark:text-ink-400">
                                    <Link to="/login" className="font-semibold text-primary-600 dark:text-primary-400 hover:underline">
                                        Войдите
                                    </Link>
                                    , чтобы лайкать, комментировать и отмечать покупки.
                                </p>
                            )}
                        </div>
                    </header>

                    {notice && (
                        <p className="mt-3 rounded-2xl bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300 text-sm font-semibold px-3.5 py-2.5">
                            {notice}
                        </p>
                    )}

                    {error && <p className="mt-3 text-sm text-hot-600 dark:text-hot-400">{error}</p>}

                    {/* Список позиций */}
                    <section className="card p-3.5 sm:p-5 mt-4">
                        <div className="flex items-center justify-between gap-2">
                            <h2 className="section-title">🧺 Состав набора</h2>
                            <span className="text-sm font-semibold text-ink-500 dark:text-ink-400 tabular-nums">
                                {formatCount(items.length)} {pluralRu(items.length, 'позиция', 'позиции', 'позиций')}
                            </span>
                        </div>

                        {basket.is_family && (
                            <p className="mt-1.5 text-xs text-ink-500 dark:text-ink-400">
                                Семейный режим: отмечайте купленное — отметку увидят все, кто открыл набор.
                                {items.length > 0 ? ` Куплено ${formatCount(checkedCount)} из ${formatCount(items.length)}.` : ''}
                            </p>
                        )}

                        {items.length === 0 ? (
                            <p className="mt-3 text-sm text-ink-500 dark:text-ink-400">
                                В наборе пока нет позиций.
                            </p>
                        ) : (
                            <div className="mt-2 divide-y divide-ink-100 dark:divide-ink-800">
                                {items.map((item) => (
                                    <BasketItemRow
                                        key={item.id}
                                        item={item}
                                        checkable={Boolean(basket.is_family)}
                                        busy={togglingItemId === item.id}
                                        onToggle={handleToggleItem}
                                    />
                                ))}
                            </div>
                        )}

                        <div className="mt-3 pt-3 border-t border-ink-100 dark:border-ink-800 flex items-center justify-between gap-2">
                            <span className="font-semibold text-ink-700 dark:text-ink-200">Итого по набору</span>
                            <span className="price price-lg">
                                {formatMoney(basket.total_price)}
                                <span className="text-base"> ₽</span>
                            </span>
                        </div>
                    </section>

                    {/* Что можно приготовить из этого набора */}
                    <section className="mt-4">
                        <h2 className="section-title mb-2.5">🍲 Что можно приготовить из этого набора</h2>

                        {recipes.length === 0 ? (
                            <div className="card p-4 text-sm text-ink-500 dark:text-ink-400">
                                Пока не нашлось блюд, которые готовятся из этих продуктов. Соберите набор из
                                рецепта — и блюдо появится здесь.
                                <Link
                                    to="/create-basket"
                                    className="mt-2 block font-semibold text-primary-600 dark:text-primary-400 hover:underline"
                                >
                                    Собрать набор →
                                </Link>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {recipes.map((recipe) => (
                                    <Link
                                        key={recipe.recipe_id}
                                        to={`/recipe/${recipe.recipe_id}`}
                                        className="card card-hover overflow-hidden flex flex-col"
                                    >
                                        <span className="block w-full h-32 bg-ink-100 dark:bg-ink-800 overflow-hidden">
                                            {recipe.photo_url ? (
                                                <img
                                                    src={mediaUrl(recipe.photo_url)}
                                                    alt=""
                                                    loading="lazy"
                                                    className="w-full h-full object-cover"
                                                />
                                            ) : (
                                                <span className="w-full h-full flex items-center justify-center text-3xl" aria-hidden="true">
                                                    🍲
                                                </span>
                                            )}
                                        </span>
                                        <span className="p-3 flex flex-col flex-1">
                                            <span className="font-display font-bold text-sm text-ink-900 dark:text-white line-clamp-2">
                                                {recipe.title}
                                            </span>
                                            <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                                {recipe.cook_time_min ? (
                                                    <span className="tag">⏱ {formatCount(recipe.cook_time_min)} мин</span>
                                                ) : null}
                                                {recipe.category ? <span className="tag">{recipe.category}</span> : null}
                                            </span>
                                            <span className="mt-2 text-xs text-ink-500 dark:text-ink-400">
                                                {coverageLabel(recipe)}
                                            </span>
                                        </span>
                                    </Link>
                                ))}
                            </div>
                        )}
                    </section>

                    {/* Действия автора: видимость, ссылка для семьи и удаление */}
                    {isOwner && (
                        <section className="card p-4 mt-4">
                            <h2 className="section-title !text-sm">Действия с набором</h2>

                            {/* Правка 9: видимость набора переехала из формы создания в карточку */}
                            <button
                                type="button"
                                onClick={handleToggleVisibility}
                                disabled={togglingVisibility}
                                aria-pressed={!basket.is_public}
                                className="btn-outline btn-block mt-3"
                            >
                                {togglingVisibility
                                    ? 'Меняем видимость…'
                                    : basket.is_public
                                    ? '🙈 Скрыть из ленты'
                                    : '🌍 Показать в ленте'}
                            </button>
                            <p className="mt-1.5 text-[11px] text-ink-400 dark:text-ink-500">
                                {basket.is_public
                                    ? 'Набор показывается в ленте и поиске.'
                                    : 'Набор скрыт из ленты — он открывается только по ссылке.'}
                            </p>

                            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <button
                                    type="button"
                                    onClick={handleShare}
                                    disabled={sharing}
                                    className="btn-secondary"
                                >
                                    {sharing ? 'Готовим ссылку…' : '🔗 Поделиться'}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleDelete}
                                    disabled={deleting}
                                    className="btn-danger"
                                >
                                    {deleting ? 'Удаляем…' : '🗑 Удалить'}
                                </button>
                            </div>

                            {shareUrl && (
                                <p className="mt-3 text-xs text-ink-500 dark:text-ink-400 break-all">
                                    Ссылка для семьи:{' '}
                                    <a
                                        href={shareUrl}
                                        className="font-semibold text-primary-600 dark:text-primary-400 hover:underline"
                                    >
                                        {shareUrl}
                                    </a>
                                </p>
                            )}

                            <p className="mt-2 text-[11px] text-ink-400 dark:text-ink-500">
                                Цены — данные сообщества: тот, кто купил, уточняет цену и дату покупки.
                            </p>
                        </section>
                    )}
                </div>

                {/* Обсуждение — снизу, как и было: на широком экране в правой
                    колонке тред выглядел оторванным от набора */}
                <div className="min-w-0">
                    <section aria-label="Обсуждение набора">
                        <h2 className="section-title mb-3">
                            💬 Обсуждение {comments.length > 0 ? `(${formatCount(comments.length)})` : ''}
                        </h2>

                        {isAuthenticated ? (
                            <form onSubmit={handleCommentSubmit} className="mb-4">
                                {replyTo && (
                                    <div className="mb-2 flex items-center justify-between gap-2 rounded-2xl bg-ink-100 dark:bg-ink-800 px-3 py-2">
                                        <span className="text-xs text-ink-600 dark:text-ink-300 truncate">
                                            Ответ для {replyTo.username || 'пользователя'}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => setReplyTo(null)}
                                            className="inline-flex items-center min-h-[44px] px-2 text-xs font-semibold text-ink-500 dark:text-ink-400 hover:text-hot-600 dark:hover:text-hot-400"
                                        >
                                            Отменить
                                        </button>
                                    </div>
                                )}
                                <textarea
                                    value={commentText}
                                    onChange={(event) => setCommentText(event.target.value)}
                                    className="input resize-y"
                                    rows="3"
                                    maxLength={2000}
                                    placeholder="Спросите про состав, магазины или цены…"
                                />
                                <button
                                    type="submit"
                                    disabled={sendingComment || !commentText.trim()}
                                    className="btn-primary btn-block mt-2.5"
                                >
                                    {sendingComment ? 'Отправляем…' : 'Отправить'}
                                </button>
                            </form>
                        ) : (
                            <p className="mb-4 rounded-2xl bg-ink-50 dark:bg-ink-850 border border-ink-100 dark:border-ink-800 p-3.5 text-sm text-ink-600 dark:text-ink-300 text-center">
                                <Link to="/login" className="font-semibold text-primary-600 dark:text-primary-400 hover:underline">
                                    Войдите
                                </Link>
                                , чтобы участвовать в обсуждении
                            </p>
                        )}

                        <BasketCommentList
                            basketId={basketId}
                            comments={comments}
                            isAuthenticated={isAuthenticated}
                            currentUsername={currentUsername}
                            onCommentsChange={setComments}
                            onReply={setReplyTo}
                            onError={setError}
                            onRequireAuth={() => navigate('/login')}
                            replyToId={replyTo?.id ?? null}
                        />
                    </section>
                </div>
            </div>

            {/* Обновление цен: дата покупки обязательна, цены — по позициям */}
            {pricesOpen && (
                <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label="Обновить цены набора">
                    <button
                        type="button"
                        aria-label="Закрыть форму"
                        onClick={() => setPricesOpen(false)}
                        className="absolute inset-0 bg-ink-950/60 backdrop-blur-sm"
                    />
                    <form
                        onSubmit={handleSavePrices}
                        className="relative w-full sm:max-w-lg max-h-[92vh] overflow-y-auto bg-white dark:bg-ink-900 rounded-t-3xl sm:rounded-3xl shadow-card animate-sheet-up"
                    >
                        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-white dark:bg-ink-900 px-4 pt-3 pb-2 border-b border-ink-100 dark:border-ink-800">
                            <h2 className="font-display font-extrabold text-lg text-ink-900 dark:text-white">
                                Обновить цены
                            </h2>
                            <button
                                type="button"
                                onClick={() => setPricesOpen(false)}
                                aria-label="Закрыть"
                                className="w-10 h-10 flex items-center justify-center rounded-xl text-ink-500 dark:text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800"
                            >
                                ✕
                            </button>
                        </div>

                        <div className="p-4 space-y-4">
                            <div>
                                <label className="label" htmlFor="prices-date">
                                    Дата покупки *
                                </label>
                                <input
                                    id="prices-date"
                                    type="date"
                                    value={pricesDate}
                                    max={todayIso()}
                                    onChange={(event) => setPricesDate(event.target.value)}
                                    required
                                    className="input"
                                />
                                <p className="mt-1 text-xs text-ink-400 dark:text-ink-500">
                                    По этой дате набор получит метку свежести цен.
                                </p>
                            </div>

                            <div>
                                <span className="label">Фото чека (необязательно)</span>
                                <input
                                    ref={receiptInputRef}
                                    type="file"
                                    accept="image/*"
                                    onChange={handleReceiptChange}
                                    className="hidden"
                                />
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => receiptInputRef.current?.click()}
                                        disabled={uploadingPhoto}
                                        className="btn-secondary !min-h-[44px] text-sm"
                                    >
                                        {uploadingPhoto ? 'Загружаем…' : '📷 Приложить фото'}
                                    </button>
                                    {receipt && (
                                        <span className="text-xs text-ink-500 dark:text-ink-400 truncate">
                                            {receipt.name}
                                        </span>
                                    )}
                                </div>
                                {receipt && (
                                    <img
                                        src={mediaUrl(receipt.url)}
                                        alt="Фото чека"
                                        className="mt-2 w-full max-h-48 object-cover rounded-2xl border border-ink-200 dark:border-ink-800"
                                    />
                                )}
                            </div>

                            <div>
                                <span className="label">Цены по позициям</span>
                                {items.length === 0 ? (
                                    <p className="text-sm text-ink-500 dark:text-ink-400">
                                        В наборе нет позиций.
                                    </p>
                                ) : (
                                    <div className="space-y-2">
                                        {items.map((item) => (
                                            <div key={item.id} className="flex items-center gap-2">
                                                <span className="flex-1 min-w-0">
                                                    <span className="block text-sm text-ink-800 dark:text-ink-100 truncate">
                                                        {item.name}
                                                    </span>
                                                    <span className="block text-[11px] text-ink-400 dark:text-ink-500">
                                                        {item.shop_name || 'магазин не указан'}
                                                        {item.prev_price != null
                                                            ? ` · было ${formatMoney(item.prev_price)} ₽`
                                                            : ''}
                                                    </span>
                                                </span>
                                                <input
                                                    type="number"
                                                    inputMode="decimal"
                                                    min="0"
                                                    step="0.01"
                                                    value={priceValues[item.id] ?? ''}
                                                    onChange={(event) =>
                                                        setPriceValues((prev) => ({
                                                            ...prev,
                                                            [item.id]: event.target.value,
                                                        }))
                                                    }
                                                    aria-label={`Цена: ${item.name}`}
                                                    className="input !w-28 text-right tabular-nums"
                                                />
                                                <span className="text-sm text-ink-400 dark:text-ink-500">₽</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <p className="mt-2 text-xs text-ink-400 dark:text-ink-500">
                                    Старая цена сохранится и будет зачёркнута рядом с новой.
                                </p>
                            </div>

                            {pricesError && (
                                <p className="text-sm text-hot-600 dark:text-hot-400">{pricesError}</p>
                            )}
                        </div>

                        <div className="sticky bottom-0 bg-white dark:bg-ink-900 px-4 pt-2 pb-4 border-t border-ink-100 dark:border-ink-800 safe-bottom">
                            <button type="submit" disabled={savingPrices} className="btn-primary btn-block">
                                {savingPrices ? 'Сохраняем…' : 'Сохранить цены'}
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
}

export default BasketPage;
