import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    createPromo,
    getShops,
    searchProducts,
    uploadPromoPhoto,
} from '../services/smeta';
import { promoMoney } from '../utils/promo';
import CityCombobox from './CityCombobox';

/** Разбирает «99,90» / «99.9» / «1 299 ₽» в число. */
const parsePrice = (raw) => {
    const normalized = String(raw || '')
        .replace(/\s/g, '')
        .replace(/[₽р]/gi, '')
        .replace(',', '.');
    const value = Number(normalized);
    return Number.isFinite(value) ? value : NaN;
};

const UNITS = ['кг', 'шт', 'упак'];

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** «2026-09-25» → ISO-строка, которую примет backend (конец дня). */
const toEndsAtIso = (dateInput) => {
    if (!dateInput) return null;
    const date = new Date(`${dateInput}T23:59:59`);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
};

/**
 * Bottom-sheet «Поделиться акцией»: увидел ценник в магазине — рассказал другим.
 *
 * Пользователь описывает акцию (старая и новая цена), выбирает магазин и по
 * желанию прикладывает фото ценника. Акция уходит на модерацию, если автор ещё
 * не набрал доверие (ответ со `status='pending'`).
 *
 * Управляется снаружи: `open` + `onClose`. Если `cityId` не передан, лист сам
 * предложит выбрать город (иначе backend не примет акцию).
 */
function PromoForm({ open, onClose, cityId = null, onCreated = null }) {
    const navigate = useNavigate();

    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');

    const [product, setProduct] = useState(null);
    const [query, setQuery] = useState('');
    const [suggestions, setSuggestions] = useState([]);
    const [searching, setSearching] = useState(false);
    const [showSuggestions, setShowSuggestions] = useState(false);

    const [shops, setShops] = useState([]);
    const [shop, setShop] = useState(null);
    const [shopsLoading, setShopsLoading] = useState(false);

    const [city, setCity] = useState(cityId || null);
    const [cityName, setCityName] = useState('');

    const [oldPriceInput, setOldPriceInput] = useState('');
    const [newPriceInput, setNewPriceInput] = useState('');
    const [unit, setUnit] = useState('кг');
    const [endsAt, setEndsAt] = useState('');

    const [photo, setPhoto] = useState(null);
    const [photoPreview, setPhotoPreview] = useState('');

    const [error, setError] = useState('');
    const [sending, setSending] = useState(false);
    const [result, setResult] = useState('');

    const fileInputRef = useRef(null);

    // Город из пропса важнее внутреннего состояния
    const effectiveCityId = cityId || city;

    // При открытии — чистое состояние, при закрытии — сброс ошибок
    useEffect(() => {
        if (!open) return;
        setTitle('');
        setDescription('');
        setProduct(null);
        setQuery('');
        setSuggestions([]);
        setShop(null);
        setOldPriceInput('');
        setNewPriceInput('');
        setUnit('кг');
        setEndsAt('');
        setPhoto(null);
        setError('');
        setResult('');
    }, [open]);

    // Блокируем прокрутку фона, пока открыт лист
    useEffect(() => {
        document.body.style.overflow = open ? 'hidden' : '';
        return () => {
            document.body.style.overflow = '';
        };
    }, [open]);

    // Escape закрывает лист
    useEffect(() => {
        if (!open) return undefined;
        const onKeyDown = (event) => {
            if (event.key === 'Escape') onClose?.();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [open, onClose]);

    // Магазины выбранного города
    useEffect(() => {
        if (!open || !effectiveCityId) {
            setShops([]);
            return undefined;
        }
        let cancelled = false;
        setShopsLoading(true);
        getShops(effectiveCityId)
            .then((list) => {
                if (!cancelled) setShops(list || []);
            })
            .catch(() => {
                if (!cancelled) setShops([]);
            })
            .finally(() => {
                if (!cancelled) setShopsLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [open, effectiveCityId]);

    // Автодополнение продукта: debounce 300 мс, чтобы не дёргать API на каждый символ
    useEffect(() => {
        if (!open) return undefined;
        const term = query.trim();
        if (product || term.length < 2) {
            setSuggestions([]);
            setSearching(false);
            return undefined;
        }

        let cancelled = false;
        setSearching(true);
        const timer = setTimeout(() => {
            searchProducts(term)
                .then((list) => {
                    if (!cancelled) {
                        setSuggestions(list || []);
                        setShowSuggestions(true);
                    }
                })
                .catch(() => {
                    if (!cancelled) setSuggestions([]);
                })
                .finally(() => {
                    if (!cancelled) setSearching(false);
                });
        }, 300);

        return () => {
            cancelled = true;
            clearTimeout(timer);
            setSearching(false);
        };
    }, [open, query, product]);

    // Превью фото живёт в blob-URL: освобождаем память при замене и размонтировании
    useEffect(() => {
        if (!photo) {
            setPhotoPreview('');
            return undefined;
        }
        const url = URL.createObjectURL(photo);
        setPhotoPreview(url);
        return () => URL.revokeObjectURL(url);
    }, [photo]);

    const oldPrice = useMemo(() => parsePrice(oldPriceInput), [oldPriceInput]);
    const newPrice = useMemo(() => parsePrice(newPriceInput), [newPriceInput]);

    const bothPrices = Number.isFinite(oldPrice) && oldPrice > 0 && Number.isFinite(newPrice) && newPrice > 0;
    const discountPercent = bothPrices && newPrice < oldPrice
        ? Math.round((1 - newPrice / oldPrice) * 1000) / 10
        : null;

    const handlePickPhoto = (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            setError('Приложите фото: jpg, png или webp');
            return;
        }
        if (file.size > MAX_PHOTO_BYTES) {
            setError('Фото больше 5 МБ — сделайте снимок поменьше');
            return;
        }
        setError('');
        setPhoto(file);
    };

    const handleSubmit = async () => {
        if (!title.trim()) {
            setError('Придумайте название акции');
            return;
        }
        if (!shop) {
            setError('Выберите магазин');
            return;
        }
        if (!Number.isFinite(oldPrice) || oldPrice <= 0) {
            setError('Укажите старую цену больше нуля');
            return;
        }
        if (!Number.isFinite(newPrice) || newPrice <= 0) {
            setError('Укажите новую цену больше нуля');
            return;
        }
        if (newPrice >= oldPrice) {
            setError('Новая цена должна быть ниже старой — иначе это не акция');
            return;
        }
        if (!effectiveCityId) {
            setError('Выберите город');
            return;
        }
        if (!localStorage.getItem('access_token')) {
            navigate('/login');
            return;
        }

        setSending(true);
        setError('');
        try {
            let photoUrl = null;
            if (photo) {
                const formData = new FormData();
                formData.append('file', photo);
                const uploaded = await uploadPromoPhoto(formData);
                photoUrl = uploaded?.photo_url || null;
            }

            const created = await createPromo({
                title: title.trim(),
                description: description.trim() || null,
                shop_id: shop.id,
                city_id: effectiveCityId,
                product_id: product?.id ?? null,
                old_price: oldPrice,
                new_price: newPrice,
                unit: unit || null,
                photo_url: photoUrl,
                ends_at: toEndsAtIso(endsAt),
            });

            setResult(created?.status === 'published' ? 'published' : 'pending');
            window.dispatchEvent(new Event('promosChange'));
            if (onCreated) onCreated(created);
        } catch (err) {
            setError(err.message || 'Не удалось отправить акцию');
        } finally {
            setSending(false);
        }
    };

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Поделиться акцией">
            <div
                className="absolute inset-0 bg-ink-950/50 backdrop-blur-sm animate-fade-in"
                onClick={() => onClose?.()}
            />

            <div className="absolute inset-x-0 bottom-0 bg-white dark:bg-ink-900 rounded-t-3xl shadow-2xl animate-sheet-up safe-bottom max-h-[92vh] overflow-y-auto">
                <div className="w-10 h-1 rounded-full bg-ink-300 dark:bg-ink-700 mx-auto mt-3" />

                <div className="px-5 pt-4 pb-6">
                    {result ? (
                        <div className="text-center py-4">
                            <div className="text-4xl mb-2">{result === 'published' ? '🎉' : '🙌'}</div>
                            <h2 className="text-lg font-extrabold text-ink-900 dark:text-white">
                                {result === 'published'
                                    ? 'Акция опубликована'
                                    : 'Акция отправлена на проверку'}
                            </h2>
                            <p className="text-sm text-ink-500 dark:text-ink-400 mt-1.5">
                                {result === 'published'
                                    ? 'Ваше доверие позволяет публиковать акции сразу — она уже видна в ленте города.'
                                    : 'Модераторы проверят ценник, после этого акция появится в ленте города. Статус виден в «Моих акциях».'}
                            </p>
                            <div className="flex flex-col-reverse xs:flex-row gap-2 mt-4">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setResult('');
                                        setTitle('');
                                        setDescription('');
                                        setProduct(null);
                                        setQuery('');
                                        setShop(null);
                                        setOldPriceInput('');
                                        setNewPriceInput('');
                                        setEndsAt('');
                                        setPhoto(null);
                                    }}
                                    className="btn-secondary flex-1"
                                >
                                    Добавить ещё
                                </button>
                                <button type="button" onClick={() => onClose?.()} className="btn-primary flex-1">
                                    Понятно
                                </button>
                            </div>
                        </div>
                    ) : (
                        <>
                            <h2 className="text-lg font-extrabold text-ink-900 dark:text-white">
                                🏷️ Поделиться акцией
                            </h2>
                            <p className="text-sm text-ink-500 dark:text-ink-400 mt-1">
                                Сфотографировали ценник в магазине? Расскажите о скидке — её увидят соседи по городу.
                            </p>

                            {!cityId && (
                                <div className="mt-4">
                                    <CityCombobox
                                        id="promo-city"
                                        label="Город"
                                        value={effectiveCityId}
                                        valueName={cityName}
                                        onChange={(picked) => {
                                            setCity(picked ? picked.id : null);
                                            setCityName(picked ? picked.name : '');
                                            setError('');
                                        }}
                                        placeholder="Начните вводить название"
                                    />
                                </div>
                            )}

                            {/* --- Название акции --- */}
                            <div className="mt-4">
                                <label className="label" htmlFor="promo-title">
                                    Название акции
                                </label>
                                <input
                                    id="promo-title"
                                    type="text"
                                    className="input"
                                    placeholder="Например: Картофель по 19,90 ₽ за кг"
                                    maxLength={160}
                                    value={title}
                                    onFocus={() => setShowSuggestions(false)}
                                    onChange={(event) => {
                                        setTitle(event.target.value);
                                        setError('');
                                    }}
                                />
                                <p className="text-[11px] text-ink-400 dark:text-ink-500 mt-1.5 text-right">
                                    {title.length}/160
                                </p>
                            </div>

                            {/* --- Магазин --- */}
                            <div className="mt-4">
                                <span className="label">Магазин</span>
                                {shopsLoading ? (
                                    <div className="hscroll">
                                        {[0, 1, 2, 3].map((key) => (
                                            <div key={key} className="skeleton h-[44px] w-28" />
                                        ))}
                                    </div>
                                ) : shops.length === 0 ? (
                                    <p className="text-sm text-ink-500 dark:text-ink-400">
                                        Для этого города магазинов пока нет.
                                    </p>
                                ) : (
                                    <div className="hscroll">
                                        {shops.map((item) => (
                                            <button
                                                key={item.id}
                                                type="button"
                                                onClick={() => {
                                                    setShop(item);
                                                    setShowSuggestions(false);
                                                    setError('');
                                                }}
                                                aria-pressed={shop?.id === item.id}
                                                className={`chip min-h-[44px] ${shop?.id === item.id ? 'chip-active' : ''}`}
                                            >
                                                {item.emoji ? `${item.emoji} ` : ''}
                                                {item.name}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* --- Товар (необязательно) --- */}
                            <div className="mt-4">
                                <label className="label" htmlFor="promo-product">
                                    Товар (необязательно)
                                </label>

                                {product ? (
                                    <div className="flex items-center gap-2 min-h-[44px] px-4 rounded-2xl border border-primary-400 bg-primary-50 dark:bg-primary-500/10">
                                        <span className="flex-1 min-w-0">
                                            <span className="block text-sm font-semibold text-ink-900 dark:text-ink-100 truncate">
                                                {product.name}
                                            </span>
                                            <span className="block text-[11px] text-ink-500 dark:text-ink-400">
                                                {product.category || 'продукт'} · за 1 {product.unit || 'шт'}
                                            </span>
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setProduct(null);
                                                setQuery('');
                                                setSuggestions([]);
                                            }}
                                            className="btn-ghost"
                                            aria-label="Сменить товар"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                ) : (
                                    <div className="relative">
                                        <input
                                            id="promo-product"
                                            type="text"
                                            className="input"
                                            placeholder="Начните вводить: молоко, картофель…"
                                            value={query}
                                            autoComplete="off"
                                            onChange={(event) => {
                                                setQuery(event.target.value);
                                                setShowSuggestions(true);
                                            }}
                                            onFocus={() => setShowSuggestions(true)}
                                        />

                                        {showSuggestions && query.trim().length >= 2 && (
                                            <div className="absolute left-0 right-0 top-full mt-1 z-10 card shadow-card-hover dark:shadow-card-hover-dark max-h-64 overflow-y-auto">
                                                {searching && suggestions.length === 0 ? (
                                                    <p className="px-4 py-3 text-sm text-ink-500 dark:text-ink-400">
                                                        Ищем…
                                                    </p>
                                                ) : suggestions.length === 0 ? (
                                                    <p className="px-4 py-3 text-sm text-ink-500 dark:text-ink-400">
                                                        Ничего не нашли. Попробуйте другое название.
                                                    </p>
                                                ) : (
                                                    suggestions.map((item) => (
                                                        <button
                                                            key={item.id}
                                                            type="button"
                                                            onClick={() => {
                                                                setProduct(item);
                                                                setQuery('');
                                                                setSuggestions([]);
                                                                setShowSuggestions(false);
                                                                setError('');
                                                            }}
                                                            className="w-full text-left min-h-[44px] px-4 py-2 hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors"
                                                        >
                                                            <span className="block text-sm font-medium text-ink-800 dark:text-ink-100">
                                                                {item.name}
                                                            </span>
                                                            <span className="block text-[11px] text-ink-400 dark:text-ink-500">
                                                                {item.category || 'продукт'} · за 1 {item.unit || 'шт'}
                                                            </span>
                                                        </button>
                                                    ))
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* --- Две цены --- */}
                            <div className="mt-4">
                                <span className="label">Цены</span>
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label
                                            className="block text-[11px] font-semibold text-ink-500 dark:text-ink-400 mb-1"
                                            htmlFor="promo-old-price"
                                        >
                                            Старая цена
                                        </label>
                                        <div className="relative">
                                            <input
                                                id="promo-old-price"
                                                type="text"
                                                inputMode="decimal"
                                                className="input !min-h-[56px] !text-xl !font-extrabold tabular text-center pr-8"
                                                placeholder="0"
                                                value={oldPriceInput}
                                                onFocus={() => setShowSuggestions(false)}
                                                onChange={(event) => {
                                                    setOldPriceInput(event.target.value);
                                                    setError('');
                                                }}
                                            />
                                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-base font-bold text-ink-400 dark:text-ink-500">
                                                ₽
                                            </span>
                                        </div>
                                    </div>

                                    <div>
                                        <label
                                            className="block text-[11px] font-semibold text-ink-500 dark:text-ink-400 mb-1"
                                            htmlFor="promo-new-price"
                                        >
                                            Новая цена
                                        </label>
                                        <div className="relative">
                                            <input
                                                id="promo-new-price"
                                                type="text"
                                                inputMode="decimal"
                                                className="input !min-h-[56px] !text-xl !font-extrabold tabular text-center pr-8 !border-primary-400"
                                                placeholder="0"
                                                value={newPriceInput}
                                                onFocus={() => setShowSuggestions(false)}
                                                onChange={(event) => {
                                                    setNewPriceInput(event.target.value);
                                                    setError('');
                                                }}
                                            />
                                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-base font-bold text-primary-500">
                                                ₽
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex flex-wrap items-center gap-2 mt-2 min-h-[26px]">
                                    {discountPercent != null ? (
                                        <>
                                            <span className="budget-pill budget-ok">
                                                −{promoMoney(discountPercent)} %
                                            </span>
                                            <span className="text-[11px] text-ink-500 dark:text-ink-400">
                                                экономия {promoMoney(oldPrice - newPrice)} ₽
                                            </span>
                                        </>
                                    ) : bothPrices && newPrice >= oldPrice ? (
                                        <span className="text-[11px] font-semibold text-hot-600 dark:text-hot-400">
                                            Новая цена должна быть ниже старой
                                        </span>
                                    ) : (
                                        <span className="text-[11px] text-ink-400 dark:text-ink-500">
                                            Заполните обе цены — скидку посчитаем сами
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* --- Единица измерения --- */}
                            <div className="mt-4">
                                <span className="label">Единица измерения</span>
                                <div className="hscroll">
                                    {UNITS.map((item) => (
                                        <button
                                            key={item}
                                            type="button"
                                            onClick={() => setUnit(item)}
                                            aria-pressed={unit === item}
                                            className={`chip min-h-[44px] ${unit === item ? 'chip-active' : ''}`}
                                        >
                                            {item}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* --- Срок действия --- */}
                            <div className="mt-4">
                                <label className="label" htmlFor="promo-ends-at">
                                    Акция действует до (необязательно)
                                </label>
                                <input
                                    id="promo-ends-at"
                                    type="date"
                                    className="input"
                                    value={endsAt}
                                    onChange={(event) => setEndsAt(event.target.value)}
                                />
                            </div>

                            {/* --- Описание --- */}
                            <div className="mt-4">
                                <label className="label" htmlFor="promo-description">
                                    Описание (необязательно)
                                </label>
                                <textarea
                                    id="promo-description"
                                    className="input min-h-[88px] resize-y"
                                    placeholder="Что за акция, до какого числа, нужна ли карта магазина…"
                                    maxLength={1000}
                                    value={description}
                                    onChange={(event) => setDescription(event.target.value)}
                                />
                            </div>

                            {/* --- Фото ценника --- */}
                            <div className="mt-4">
                                <span className="label">Фото ценника (необязательно)</span>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*"
                                    capture="environment"
                                    className="hidden"
                                    onChange={handlePickPhoto}
                                />

                                {photoPreview ? (
                                    <div className="flex items-center gap-3">
                                        <img
                                            src={photoPreview}
                                            alt="Превью ценника"
                                            className="w-20 h-20 object-cover rounded-2xl border border-ink-200 dark:border-ink-700"
                                        />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-semibold text-ink-800 dark:text-ink-100 truncate">
                                                {photo?.name || 'ценник'}
                                            </p>
                                            <p className="text-[11px] text-ink-400 dark:text-ink-500">
                                                {photo ? `${Math.round(photo.size / 1024)} КБ` : ''}
                                            </p>
                                            <button
                                                type="button"
                                                onClick={() => setPhoto(null)}
                                                className="btn-ghost mt-1"
                                            >
                                                Убрать фото
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => fileInputRef.current?.click()}
                                        className="btn-secondary btn-block"
                                    >
                                        📷 Приложить ценник
                                    </button>
                                )}
                                <p className="text-[11px] text-ink-400 dark:text-ink-500 mt-1.5">
                                    jpg, png или webp до 5 МБ. Фото помогает модерации проверить акцию.
                                </p>
                            </div>

                            {error && (
                                <p className="text-sm font-semibold text-hot-600 dark:text-hot-400 mt-3">
                                    {error}
                                </p>
                            )}

                            <div className="flex flex-col-reverse xs:flex-row gap-2 mt-5">
                                <button type="button" onClick={() => onClose?.()} className="btn-secondary xs:w-36">
                                    Отмена
                                </button>
                                <button
                                    type="button"
                                    onClick={handleSubmit}
                                    disabled={sending}
                                    className="btn-primary flex-1"
                                >
                                    {sending ? 'Отправляем…' : 'Опубликовать акцию'}
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

export default PromoForm;
