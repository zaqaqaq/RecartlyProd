import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import {
    createBasket,
    createCustomShop,
    deleteCustomShop,
    getShops,
    previewBasket,
} from '../services/smeta';
import { getRecipes, uploadPhoto } from '../services/api';
import { API_URL, mediaUrl } from '../utils/media';
import { formatCount, formatMoney, pluralRu } from '../components/BasketCard';

/* ============================================================
   Создание набора — корзины продуктов с ценами и датой покупки.

   Набор собирается двумя способами:
   1) вручную — позиции, магазины, цены;
   2) из рецепта — состав и цены приходят из `/baskets/preview` и сразу
      подставляются в редактируемый список, чтобы человек видел не пустой
      список и не ноль, а конкретные позиции и мог их поправить.

   Дата покупки обязательна: без неё непонятно, свежие это цены или нет.
   Набор создаётся публичным (скрыть/показать автор сможет в карточке набора),
   поэтому переключателя публичности в форме нет.
   ============================================================ */

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const SERVING_OPTIONS = [1, 2, 4, 6];
/** Частые единицы — подсказки в `<datalist>`: можно выбрать или напечатать своё. */
const UNIT_OPTIONS = ['кг', 'г', 'шт', 'л', 'мл', 'упак', 'ст. л.', 'щепотка'];
const DEFAULT_UNIT = 'шт';
/** Служебное значение пункта «＋ Добавить магазин» в выпадающем списке магазинов. */
const ADD_SHOP_VALUE = '__add_custom_shop__';
const CITY_KEY = 'recartly_city_id';
const MAX_SHOPS_IN_PREVIEW = 3;
/** Сложность рецепта: в API это число 1–3. */
const DIFFICULTY_LABELS = { 1: 'просто', 2: 'средне', 3: 'сложно' };
const difficultyLabel = (value) => DIFFICULTY_LABELS[Number(value)] || null;

/** Сегодняшняя дата в формате `<input type="date">` (локальная, без сдвига по UTC). */
const todayIso = () => {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

/**
 * Значение `type="date"` → ISO-datetime для backend.
 * Полдень выбранного дня: дата покупки не «съезжает» по часовому поясу, а backend
 * требует именно datetime (строка `2026-10-05` даёт 400).
 */
const toIsoDateTime = (dateStr) => {
    if (!dateStr) return null;
    const local = new Date(`${dateStr}T12:00:00`);
    return Number.isNaN(local.getTime()) ? null : local.toISOString();
};

/** «99,90» / «99.9» / «1 299» → число (или null для пустой строки). */
const parseNumber = (raw) => {
    const normalized = String(raw ?? '')
        .replace(/\s/g, '')
        .replace(',', '.');
    if (normalized === '') return null;
    const value = Number(normalized);
    return Number.isFinite(value) ? value : NaN;
};

/** Число → значение для `<input>`: 300.0 → «300». Пусто, если числа нет. */
const numberToInput = (value) => {
    if (value === null || value === undefined || value === '') return '';
    const numeric = Number(value);
    return Number.isFinite(numeric) ? String(numeric) : '';
};

/** «300 г» / «2 шт» из состава рецепта → { quantity: '300', unit: 'г' }. */
const splitIngredientAmount = (raw) => {
    const text = String(raw ?? '').trim();
    const match = text.match(/^([\d\s.,]+)\s*(.*)$/);
    if (!match) return { quantity: '', unit: DEFAULT_UNIT };
    return {
        quantity: match[1].replace(/\s/g, '').replace(',', '.'),
        unit: match[2].trim() || DEFAULT_UNIT,
    };
};

let rowCounter = 0;
const nextRowKey = () => {
    rowCounter += 1;
    return `row-${Date.now()}-${rowCounter}`;
};

const emptyRow = () => ({
    key: nextRowKey(),
    name: '',
    quantity: '',
    unit: DEFAULT_UNIT,
    shop_id: '',
    price: '',
    // Фото покупки у позиции (например, творог на полке) — необязательно
    photo_url: null,
});

/** Свои магазины («у дома») — первыми: backend отдаёт их так же, порядок держим и после добавления. */
const sortShops = (list) => {
    const rows = Array.isArray(list) ? [...list] : [];
    return rows.sort((a, b) => Number(Boolean(b.is_custom)) - Number(Boolean(a.is_custom)));
};

/** Подпись магазина со значком: свои помечаем 🏪, у сетей — их эмодзи. */
const shopOptionLabel = (shop) => {
    const emoji = shop.is_custom ? '🏪' : shop.emoji || '';
    return emoji ? `${emoji} ${shop.name}` : shop.name;
};

/**
 * Личные магазины пользователя («у дома»).
 *
 * Backend отдаёт их в `/geo/shops` только тому, кто прислал токен, а обёртка
 * `getShops` из сервиса запрашивает публичный список без авторизации. Поэтому
 * свой список дотягиваем одним запросом с токеном — тем же способом, каким
 * Navbar запрашивает профиль. Без токена просто ничего не добавляем.
 */
const fetchMyShops = async (cityId) => {
    const token = localStorage.getItem('access_token');
    if (!token) return [];

    try {
        const query = cityId ? `?city_id=${encodeURIComponent(cityId)}` : '';
        const response = await fetch(`${API_URL}/geo/shops${query}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) return [];
        const list = await response.json();
        return Array.isArray(list) ? list.filter((shop) => shop.is_custom) : [];
    } catch (err) {
        return [];
    }
};

/**
 * Подписи над полями строки позиции.
 * На мобильных они остаются только у первой строки: дальше — компактные
 * (sr-only + placeholder + aria-label), но доступность не теряется.
 * На sm+ подписи видны у всех строк.
 */
const rowLabelClass = (index) => (index === 0 ? 'label' : 'label sr-only sm:not-sr-only sm:mb-1.5');

/** Позиции предпросмотра → редактируемые строки формы. */
const rowsFromPreview = (data, fallbackRecipe) => {
    const lines = Array.isArray(data?.lines) ? data.lines : [];
    if (lines.length === 0) return rowsFromRecipe(fallbackRecipe);
    return lines.map((line) => ({
        key: nextRowKey(),
        name: line.name || '',
        quantity: numberToInput(line.quantity),
        unit: line.unit || DEFAULT_UNIT,
        shop_id: line.shop_id === null || line.shop_id === undefined ? '' : String(line.shop_id),
        price: numberToInput(line.price),
        // Предпросмотр фото позиций не отдаёт — своё человек добавит сам
        photo_url: null,
    }));
};

/**
 * Запасной вариант, если предпросмотр не ответил: состав рецепта без цен.
 * Пустого списка быть не должно — при сохранении цены подставит сервер.
 */
const rowsFromRecipe = (recipeRow) => {
    const ingredients = Array.isArray(recipeRow?.ingredients) ? recipeRow.ingredients : [];
    if (ingredients.length === 0) return [emptyRow()];
    return ingredients.map((ingredient) => {
        const { quantity, unit } = splitIngredientAmount(ingredient.quantity);
        return {
            key: nextRowKey(),
            name: ingredient.name || '',
            quantity,
            unit,
            shop_id: '',
            price: numberToInput(ingredient.price),
            photo_url: null,
        };
    });
};

/**
 * Страница создания набора: поля набора, две фотографии (блюдо и чек),
 * позиции с магазинами и ценами, сборка из рецепта (`?recipe_id=` из ссылки на блюдо).
 */
function CreateBasketPage() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const recipeIdParam = searchParams.get('recipe_id');

    const isAuthenticated = Boolean(localStorage.getItem('access_token'));
    const cityId = Number(localStorage.getItem(CITY_KEY)) || null;

    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [servings, setServings] = useState('');
    const [pricesDate, setPricesDate] = useState(todayIso);

    // Две разные картинки: что получилось (в карточке на главной) и подтверждение цен (чек)
    const [photo, setPhoto] = useState(null); // → photo_url
    const [receiptPhoto, setReceiptPhoto] = useState(null); // → receipt_photo_url
    const [photoUploading, setPhotoUploading] = useState(false);
    const [receiptUploading, setReceiptUploading] = useState(false);
    const [photoError, setPhotoError] = useState('');
    const photoInputRef = useRef(null);
    const receiptInputRef = useRef(null);

    // Фото покупки у позиции: своя загрузка на каждую строку (ключ строки)
    const [itemPhotoUploading, setItemPhotoUploading] = useState(null);
    const [itemPhotoError, setItemPhotoError] = useState('');
    /** Скрытые `<input type="file">` позиций — по ключу строки: кнопка «📷» своя у каждой. */
    const itemPhotoInputs = useRef({});

    const [items, setItems] = useState(() => [emptyRow()]);
    /** Пользователь правил строки после подстановки из рецепта — сохраняем именно его список. */
    const [itemsTouched, setItemsTouched] = useState(false);

    const [shops, setShops] = useState([]);
    const [addingShopRow, setAddingShopRow] = useState(null);
    const [newShopName, setNewShopName] = useState('');
    const [savingShop, setSavingShop] = useState(false);
    const [removingShopId, setRemovingShopId] = useState(null);
    const [shopError, setShopError] = useState('');

    const [recipes, setRecipes] = useState([]);
    const [recipesLoading, setRecipesLoading] = useState(true);
    const [recipeQuery, setRecipeQuery] = useState('');
    const [recipe, setRecipe] = useState(null);
    const [pickerOpen, setPickerOpen] = useState(false);

    const [preview, setPreview] = useState(null);
    const [previewStatus, setPreviewStatus] = useState('idle'); // idle | loading | ready | error
    const [previewNonce, setPreviewNonce] = useState(0);

    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    // Магазины нужны для выбора в позициях (без города — все доступные).
    // Свои магазины («у дома») backend отдаёт только с токеном — см. fetchMyShops.
    useEffect(() => {
        let cancelled = false;

        const loadShops = async () => {
            const [publicList, myList] = await Promise.all([
                getShops(cityId || undefined).catch(() => []),
                fetchMyShops(cityId || null),
            ]);
            if (cancelled) return;

            const own = Array.isArray(myList) ? myList : [];
            const ownIds = new Set(own.map((shop) => shop.id));
            const rest = (Array.isArray(publicList) ? publicList : []).filter(
                (shop) => !ownIds.has(shop.id)
            );
            setShops(sortShops([...own, ...rest]));
        };

        loadShops();
        return () => {
            cancelled = true;
        };
    }, [cityId]);

    // Список рецептов для «Собрать из рецепта» — фильтруем на клиенте
    useEffect(() => {
        let cancelled = false;
        setRecipesLoading(true);
        getRecipes(0, 50)
            .then((list) => {
                if (!cancelled) setRecipes(Array.isArray(list) ? list : []);
            })
            .catch(() => {
                if (!cancelled) setRecipes([]);
            })
            .finally(() => {
                if (!cancelled) setRecipesLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (!isAuthenticated) {
            navigate('/login', { replace: true });
        }
    }, [isAuthenticated, navigate]);

    /**
     * Выбор рецепта: название и порции по умолчанию.
     * Состав и цены подставит эффект предпросмотра — список позиций не остаётся пустым.
     */
    const selectRecipe = (picked) => {
        if (!picked) return;
        const sameRecipe = recipe && String(recipe.id) === String(picked.id);
        setRecipe(picked);
        setPickerOpen(false);
        setRecipeQuery('');
        setTitle((prev) => (!prev.trim() || prev.startsWith('Набор: ') ? `Набор: ${picked.title}` : prev));
        const pickedServings = Number(picked.servings);
        if (Number.isFinite(pickedServings) && pickedServings > 0) {
            setServings(String(pickedServings));
        }
        // Повторный выбор того же рецепта — просто обновляем предпросмотр
        if (sameRecipe) setPreviewNonce((nonce) => nonce + 1);
    };

    // Ссылка «Собрать набор из этого рецепта» со страницы блюда: ?recipe_id=
    useEffect(() => {
        if (!recipeIdParam || recipe || recipes.length === 0) return;
        const found = recipes.find((row) => String(row.id) === String(recipeIdParam));
        if (found) selectRecipe(found);
    }, [recipeIdParam, recipes, recipe]);

    /**
     * Предпросмотр состава: `previewBasket` возвращает те же позиции, что backend
     * положит в набор при сохранении, — поэтому список можно смело подставлять в форму.
     */
    useEffect(() => {
        if (!recipe) {
            setPreview(null);
            setPreviewStatus('idle');
            return undefined;
        }

        let cancelled = false;
        const servingsNumber = Number(servings);
        setPreviewStatus('loading');
        setPreview(null);

        previewBasket(recipe.id, {
            city_id: cityId || undefined,
            servings: Number.isFinite(servingsNumber) && servingsNumber > 0 ? servingsNumber : undefined,
        })
            .then((data) => {
                if (cancelled) return;
                setPreview(data || null);
                setPreviewStatus('ready');
                setItems(rowsFromPreview(data, recipe));
                setItemsTouched(false);
            })
            .catch(() => {
                if (cancelled) return;
                setPreview(null);
                setPreviewStatus('error');
                setItems(rowsFromRecipe(recipe));
                setItemsTouched(false);
            });

        return () => {
            cancelled = true;
        };
    }, [recipe, previewNonce]);

    const matches = useMemo(() => {
        const query = recipeQuery.trim().toLowerCase();
        if (!query) return [];
        return recipes.filter((row) => (row.title || '').toLowerCase().includes(query)).slice(0, 8);
    }, [recipeQuery, recipes]);

    const shopNameById = useMemo(() => {
        const map = new Map();
        shops.forEach((shop) => map.set(String(shop.id), shop.name));
        return map;
    }, [shops]);

    const customShops = useMemo(() => shops.filter((shop) => shop.is_custom), [shops]);

    /** Магазины предпросмотра — «где это покупать» видно сразу. */
    const previewShopNames = useMemo(() => {
        const lines = Array.isArray(preview?.lines) ? preview.lines : [];
        const names = [];
        lines.forEach((line) => {
            const name = line.shop_name || shopNameById.get(String(line.shop_id)) || '';
            if (name && !names.includes(name)) names.push(name);
        });
        return names;
    }, [preview, shopNameById]);

    const filledItems = useMemo(() => items.filter((row) => row.name.trim()), [items]);

    const itemsTotal = useMemo(
        () =>
            filledItems.reduce((sum, row) => {
                const price = parseNumber(row.price);
                return Number.isFinite(price) ? sum + price : sum;
            }, 0),
        [filledItems]
    );

    /**
     * У каких-то позиций есть фото покупки.
     * При `recipe_id` backend пересобирает состав по рецепту (`_fill_from_recipe`)
     * и `items` не смотрит — фото позиций в этом случае потерялись бы.
     */
    /**
     * Итог: у предпросмотра — его сумма (совпадает с расчётом backend),
     * у правленого списка — сумма по строкам.
     */
    const total = useMemo(() => {
        const previewTotal = Number(preview?.total);
        if (recipe && previewStatus === 'ready' && !itemsTouched && Number.isFinite(previewTotal)) {
            return previewTotal;
        }
        return Math.round(itemsTotal * 100) / 100;
    }, [recipe, previewStatus, itemsTouched, preview, itemsTotal]);

    /**
     * При сохранении позиции собирает сервер (по актуальным ценам), пока список не правили.
     * Фото покупок при этом не теряются: сервер пересобирает состав по рецепту
     * и переносит картинки по названиям позиций (`_apply_item_photos`).
     */
    const useServerRecipe =
        Boolean(recipe) && (previewStatus !== 'ready' || !itemsTouched);

    const touchItems = () => {
        if (recipe) setItemsTouched(true);
    };

    const updateItem = (key, patch) => {
        setItems((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
        touchItems();
    };

    const addItem = () => {
        setItems((prev) => [...prev, emptyRow()]);
        touchItems();
    };

    /** Последнюю строку не удаляем в пустоту: вместо неё появляется новая пустая. */
    const removeItem = (key) => {
        setItems((prev) => {
            const rest = prev.filter((row) => row.key !== key);
            return rest.length > 0 ? rest : [emptyRow()];
        });
        touchItems();
    };

    /**
     * Загрузка фото через общий аплоад (`uploadPhoto` → `{ photo_url }`):
     * отдельного загрузчика для наборов на backend нет.
     * Ошибка загрузки не блокирует создание набора — только предупреждаем.
     */
    const uploadImage = async (file, target) => {
        if (file.size > MAX_PHOTO_BYTES) {
            setPhotoError('Файл больше 5 МБ — выберите поменьше');
            return;
        }

        setPhotoError('');
        if (target === 'receipt') {
            setReceiptUploading(true);
        } else {
            setPhotoUploading(true);
        }

        try {
            const formData = new FormData();
            formData.append('file', file);
            const data = await uploadPhoto(formData);
            const uploaded = { url: data.photo_url, name: file.name };
            if (target === 'receipt') {
                setReceiptPhoto(uploaded);
            } else {
                setPhoto(uploaded);
            }
        } catch (err) {
            setPhotoError(
                err.message || 'Не удалось загрузить фото — набор можно создать и без картинки'
            );
        } finally {
            if (target === 'receipt') {
                setReceiptUploading(false);
            } else {
                setPhotoUploading(false);
            }
        }
    };

    const handlePhotoChange = async (event) => {
        const input = event.target;
        const file = input.files?.[0];
        input.value = '';
        if (file) await uploadImage(file, 'dish');
    };

    const handleReceiptPhotoChange = async (event) => {
        const input = event.target;
        const file = input.files?.[0];
        input.value = '';
        if (file) await uploadImage(file, 'receipt');
    };

    /** Фото позиции убрали: в payload уйдёт `photo_url: null`, набор создаётся как обычно. */
    const removeItemPhoto = (rowKey) => {
        setItemPhotoError('');
        setItems((prev) =>
            prev.map((row) => (row.key === rowKey ? { ...row, photo_url: null } : row))
        );
    };

    /**
     * Фото покупки у позиции набора — «вот этот творог на полке».
     *
     * Отдельного аплоада для позиций на backend нет, поэтому используем общий
     * `uploadPhoto` (POST `/recipes/upload-photo`, поле `file` → `{ photo_url }`) —
     * тот же, что для фото набора и чека.
     *
     * Ошибка загрузки не блокирует создание набора: показываем отдельное сообщение,
     * а позиция уходит с `photo_url: null`.
     *
     * Состояние строки меняем напрямую (не через `updateItem`): загрузка фото — не
     * правка состава, и отметка «список правили» не должна переключать расчёт цен.
     */
    const handleItemPhotoChange = async (rowKey, event) => {
        const input = event.target;
        const file = input.files?.[0];
        input.value = '';
        if (!file) return;

        const current = items.find((item) => item.key === rowKey);
        const itemName = current?.name?.trim() || 'без названия';

        if (file.size > MAX_PHOTO_BYTES) {
            setItemPhotoError(`Фото позиции «${itemName}» больше 5 МБ — выберите поменьше`);
            return;
        }

        setItemPhotoError('');
        setItemPhotoUploading(rowKey);
        try {
            const formData = new FormData();
            formData.append('file', file);
            const data = await uploadPhoto(formData);
            const photoUrl = data?.photo_url;
            if (!photoUrl) throw new Error('Сервер не вернул ссылку на фото');
            setItems((prev) =>
                prev.map((row) => (row.key === rowKey ? { ...row, photo_url: photoUrl } : row))
            );
        } catch (err) {
            setItemPhotoError(
                err.message ||
                    `Не удалось загрузить фото позиции «${itemName}» — набор можно создать и без картинки`
            );
        } finally {
            setItemPhotoUploading(null);
        }
    };

    const handleShopSelect = (rowKey, value) => {
        if (value === ADD_SHOP_VALUE) {
            setAddingShopRow(rowKey);
            setNewShopName('');
            setShopError('');
            return;
        }
        updateItem(rowKey, { shop_id: value });
        if (addingShopRow === rowKey) setAddingShopRow(null);
    };

    const cancelAddShop = () => {
        setAddingShopRow(null);
        setNewShopName('');
        setShopError('');
    };

    /** «магазин у дома» → backend нормализует в «Магазин у дома» и вернёт новый магазин. */
    const saveCustomShop = async (rowKey) => {
        const name = newShopName.trim();
        if (!name || savingShop) return;

        setSavingShop(true);
        setShopError('');
        try {
            const created = await createCustomShop(name);
            if (!created?.id) throw new Error('Магазин не сохранился — попробуйте ещё раз');
            setShops((prev) => sortShops([created, ...prev.filter((shop) => shop.id !== created.id)]));
            // Новый магазин сразу подставляется в текущую позицию
            updateItem(rowKey, { shop_id: String(created.id) });
            setAddingShopRow(null);
            setNewShopName('');
        } catch (err) {
            setShopError(err.message || 'Не удалось сохранить магазин');
        } finally {
            setSavingShop(false);
        }
    };

    const removeCustomShop = async (shopId) => {
        if (removingShopId) return;

        setRemovingShopId(shopId);
        setShopError('');
        try {
            await deleteCustomShop(shopId);
            setShops((prev) => prev.filter((shop) => shop.id !== shopId));
            setItems((prev) =>
                prev.map((row) =>
                    String(row.shop_id) === String(shopId) ? { ...row, shop_id: '' } : row
                )
            );
            touchItems();
        } catch (err) {
            setShopError(err.message || 'Не удалось убрать магазин из списка');
        } finally {
            setRemovingShopId(null);
        }
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (submitting) return;

        const cleanTitle = title.trim();
        if (!cleanTitle) {
            setError('Укажите название набора');
            return;
        }

        const isoDate = toIsoDateTime(pricesDate);
        if (!isoDate) {
            setError('Укажите дату покупки — без неё цены нельзя считать свежими');
            return;
        }

        const payload = {
            title: cleanTitle,
            description: description.trim() || null,
            prices_date: isoDate,
            // Фото блюда/набора показывается в карточке на главной, фото чека — подтверждение цен
            photo_url: photo?.url || null,
            receipt_photo_url: receiptPhoto?.url || null,
            // Набор всегда создаётся публичным: скрыть/показать его автор сможет в карточке набора
            is_public: true,
            city_id: cityId || undefined,
        };

        if (Number.isFinite(Number(servings)) && Number(servings) > 0) {
            payload.servings = Number(servings);
        }

        if (useServerRecipe) {
            // Состав и цены подставит backend по рецепту и магазинам города.
            // Позиции всё равно отправляем — ради фото покупок: сервер пересоберёт
            // состав и перенесёт картинки по названиям.
            payload.recipe_id = Number(recipe.id);
            payload.items = filledItems.map((row) => ({
                name: row.name.trim(),
                quantity: parseNumber(row.quantity),
                unit: row.unit || null,
                shop_id: row.shop_id ? Number(row.shop_id) : null,
                price: parseNumber(row.price),
                photo_url: row.photo_url || null,
            }));
        } else {
            if (filledItems.length === 0) {
                setError('Добавьте хотя бы одну позицию или соберите набор из рецепта');
                return;
            }

            const brokenPrice = filledItems.find((row) => {
                const price = parseNumber(row.price);
                return Number.isNaN(price) || (Number.isFinite(price) && price < 0);
            });
            if (brokenPrice) {
                setError(`Проверьте цену позиции «${brokenPrice.name.trim()}»: нужно число от 0`);
                return;
            }

            const brokenQuantity = filledItems.find((row) => {
                const quantity = parseNumber(row.quantity);
                return Number.isNaN(quantity) || (Number.isFinite(quantity) && quantity < 0);
            });
            if (brokenQuantity) {
                setError(`Проверьте количество позиции «${brokenQuantity.name.trim()}»: нужно число от 0`);
                return;
            }

            // Позиции правили руками — отправляем именно их (recipe_id не шлём, иначе сервер
            // пересоберёт состав и правки потеряются). То же и с фото позиций: см. useServerRecipe.
            payload.items = filledItems.map((row) => {
                const quantity = parseNumber(row.quantity);
                const price = parseNumber(row.price);
                return {
                    name: row.name.trim(),
                    quantity: Number.isFinite(quantity) ? quantity : null,
                    unit: row.unit || null,
                    shop_id: row.shop_id === '' ? null : Number(row.shop_id),
                    price: Number.isFinite(price) ? price : null,
                    // Фото покупки у позиции — необязательно: без него уходит null
                    photo_url: row.photo_url || null,
                };
            });
        }

        setSubmitting(true);
        setError('');
        try {
            const created = await createBasket(payload);
            navigate(`/basket/${created.id}`);
        } catch (err) {
            setError(err.message || 'Не удалось создать набор');
            setSubmitting(false);
        }
    };

    if (!isAuthenticated) {
        return <Navigate to="/login" replace />;
    }

    const totalHint =
        total > 0
            ? recipe && useServerRecipe
                ? 'Цены подставит сервер по составу рецепта'
                : `${formatCount(filledItems.length)} ${pluralRu(
                      filledItems.length,
                      'позиция',
                      'позиции',
                      'позиций'
                  )} · можно поправить перед сохранением`
            : recipe
              ? 'Для этого рецепта цен не нашлось — впишите цены в позициях или добавьте свои'
              : 'Добавьте позиции или выберите рецепт';

    return (
        <div className="max-w-2xl mx-auto animate-fade-in pb-bottom-nav">
            <nav className="text-xs text-ink-500 dark:text-ink-400 mb-2 flex items-center gap-1 min-w-0" aria-label="Навигация">
                <Link to="/" className="hover:text-primary-600 dark:hover:text-primary-400">
                    Наборы
                </Link>
                <span className="mx-1 text-ink-300 dark:text-ink-600">/</span>
                <span className="truncate text-ink-700 dark:text-ink-300">Новый набор</span>
            </nav>

            <header className="mb-4">
                <h1 className="heading-1">Создать набор</h1>
                <p className="mt-1.5 text-sm text-ink-500 dark:text-ink-400">
                    Соберите продукты с ценами и датой покупки. Из набора можно будет готовить блюда —
                    цена продуктовая, а не рецептурная.
                </p>
            </header>

            <form onSubmit={handleSubmit} className="space-y-4">
                {/* Основа набора */}
                <section className="card p-3.5 sm:p-5 space-y-3.5">
                    <div>
                        <label className="label" htmlFor="basket-title">
                            Название *
                        </label>
                        <input
                            id="basket-title"
                            type="text"
                            value={title}
                            onChange={(event) => setTitle(event.target.value)}
                            maxLength={160}
                            placeholder="Набор: ужин на четверых"
                            className="input"
                            required
                        />
                    </div>

                    <div>
                        <label className="label" htmlFor="basket-description">
                            Описание
                        </label>
                        <textarea
                            id="basket-description"
                            value={description}
                            onChange={(event) => setDescription(event.target.value)}
                            rows="3"
                            maxLength={2000}
                            placeholder="Что за закупка: на неделю, на ужин, для заготовок…"
                            className="input resize-y"
                        />
                    </div>

                    <div>
                        <span className="label">На сколько человек</span>
                        <div className="flex flex-wrap items-center gap-2">
                            {SERVING_OPTIONS.map((value) => {
                                const active = String(value) === servings;
                                return (
                                    <button
                                        key={value}
                                        type="button"
                                        onClick={() => setServings(String(value))}
                                        aria-pressed={active}
                                        className={`chip ${
                                            active
                                                ? 'chip-active dark:bg-primary-900/50 dark:text-primary-100 dark:shadow-none dark:ring-1 dark:ring-primary-500/60 dark:hover:bg-primary-900/70'
                                                : ''
                                        }`}
                                    >
                                        {value}
                                    </button>
                                );
                            })}
                            <input
                                type="number"
                                inputMode="numeric"
                                min="1"
                                max="50"
                                value={SERVING_OPTIONS.includes(Number(servings)) ? '' : servings}
                                onChange={(event) => setServings(event.target.value)}
                                placeholder="своё"
                                aria-label="Своё число человек"
                                className="input !w-24 text-center tabular-nums"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="label" htmlFor="basket-date">
                            Дата покупки *
                        </label>
                        <input
                            id="basket-date"
                            type="date"
                            value={pricesDate}
                            max={todayIso()}
                            onChange={(event) => setPricesDate(event.target.value)}
                            className="input"
                            required
                        />
                        <p className="mt-1 text-xs text-ink-400 dark:text-ink-500">
                            Дата по умолчанию — сегодня. По ней набор получит метку свежести цен.
                        </p>
                    </div>

                    {/* Два разных фото: блюдо/набор и чек — это разные смыслы, не одно поле */}
                    <div className="grid gap-3.5 sm:grid-cols-2">
                        <div>
                            <span className="label">Фото блюда/набора</span>
                            <input
                                ref={photoInputRef}
                                type="file"
                                accept="image/*"
                                onChange={handlePhotoChange}
                                className="hidden"
                            />
                            <div className="flex flex-wrap items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => photoInputRef.current?.click()}
                                    disabled={photoUploading}
                                    className="btn-secondary !min-h-[44px] text-sm"
                                >
                                    {photoUploading ? 'Загружаем…' : '📷 Загрузить фото'}
                                </button>
                                {photo && (
                                    <button
                                        type="button"
                                        onClick={() => setPhoto(null)}
                                        className="btn-ghost text-sm"
                                    >
                                        Убрать
                                    </button>
                                )}
                            </div>
                            {photo ? (
                                <img
                                    src={mediaUrl(photo.url)}
                                    alt="Фото блюда или набора"
                                    className="mt-2 w-full max-h-40 object-cover rounded-2xl border border-ink-200 dark:border-ink-800"
                                />
                            ) : (
                                <p className="mt-1.5 text-xs text-ink-400 dark:text-ink-500">
                                    Показывается в карточке набора на главной
                                </p>
                            )}
                        </div>

                        <div>
                            <span className="label">Фото чека</span>
                            <input
                                ref={receiptInputRef}
                                type="file"
                                accept="image/*"
                                onChange={handleReceiptPhotoChange}
                                className="hidden"
                            />
                            <div className="flex flex-wrap items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => receiptInputRef.current?.click()}
                                    disabled={receiptUploading}
                                    className="btn-secondary !min-h-[44px] text-sm"
                                >
                                    {receiptUploading ? 'Загружаем…' : '🧾 Загрузить чек'}
                                </button>
                                {receiptPhoto && (
                                    <button
                                        type="button"
                                        onClick={() => setReceiptPhoto(null)}
                                        className="btn-ghost text-sm"
                                    >
                                        Убрать
                                    </button>
                                )}
                            </div>
                            {receiptPhoto ? (
                                <img
                                    src={mediaUrl(receiptPhoto.url)}
                                    alt="Фото чека"
                                    className="mt-2 w-full max-h-40 object-cover rounded-2xl border border-ink-200 dark:border-ink-800"
                                />
                            ) : (
                                <p className="mt-1.5 text-xs text-ink-400 dark:text-ink-500">
                                    Необязательно — подтверждает, что цены настоящие
                                </p>
                            )}
                        </div>
                    </div>

                    {photoError && (
                        <p
                            role="status"
                            className="rounded-2xl bg-secondary-50 dark:bg-secondary-500/15 text-secondary-600 dark:text-secondary-300 text-xs font-semibold px-3.5 py-2.5"
                        >
                            {photoError}
                        </p>
                    )}
                </section>

                {/* Позиции набора */}
                <section className="card p-3.5 sm:p-5">
                    <div className="flex items-center justify-between gap-2">
                        <h2 className="section-title">🧺 Позиции набора</h2>
                        <span className="text-sm font-semibold text-ink-500 dark:text-ink-400 tabular-nums">
                            {formatCount(filledItems.length)}{' '}
                            {pluralRu(filledItems.length, 'позиция', 'позиции', 'позиций')}
                        </span>
                    </div>

                    {recipe && previewStatus === 'loading' ? (
                        <div className="mt-3 space-y-3" aria-live="polite">
                            <div className="skeleton h-32" />
                            <div className="skeleton h-32" />
                            <p className="text-xs text-ink-400 dark:text-ink-500">
                                Считаем состав и цены по рецепту…
                            </p>
                        </div>
                    ) : (
                        <>
                            {recipe && (
                                <p className="mt-2 text-xs text-ink-500 dark:text-ink-400">
                                    {previewStatus === 'ready'
                                        ? itemsTouched
                                            ? 'Позиции из рецепта — вы их поправили, сохраним список как есть.'
                                            : 'Состав и цены из рецепта подставлены автоматически — любую строку можно поправить.'
                                        : 'Заранее цены получить не удалось — при сохранении состав и цены подставит сервер по рецепту.'}
                                </p>
                            )}

                            {shopError && (
                                <p
                                    role="status"
                                    className="mt-2 rounded-2xl bg-hot-50 dark:bg-hot-500/10 text-hot-600 dark:text-hot-400 text-xs font-semibold px-3.5 py-2.5"
                                >
                                    {shopError}
                                </p>
                            )}

                            {/* Ошибка фото позиции — отдельное сообщение: набор создаётся и без картинки */}
                            {itemPhotoError && (
                                <p
                                    role="status"
                                    className="mt-2 rounded-2xl bg-secondary-50 dark:bg-secondary-500/15 text-secondary-600 dark:text-secondary-300 text-xs font-semibold px-3.5 py-2.5"
                                >
                                    {itemPhotoError}
                                </p>
                            )}

                            <div className="mt-3 space-y-3">
                                {items.map((row, index) => {
                                    const selectedShop = shops.find(
                                        (shop) => String(shop.id) === String(row.shop_id)
                                    );
                                    const isCustomSelected = Boolean(selectedShop?.is_custom);
                                    const labelClass = rowLabelClass(index);
                                    const nameId = `item-name-${row.key}`;
                                    const quantityId = `item-quantity-${row.key}`;
                                    const unitId = `item-unit-${row.key}`;
                                    const shopId = `item-shop-${row.key}`;
                                    const priceId = `item-price-${row.key}`;
                                    const number = index + 1;

                                    return (
                                        <div
                                            key={row.key}
                                            className="rounded-2xl border border-ink-200 dark:border-ink-800 p-3 space-y-2.5"
                                        >
                                            <div>
                                                <label className={labelClass} htmlFor={nameId}>
                                                    Название продукта
                                                </label>
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        id={nameId}
                                                        type="text"
                                                        value={row.name}
                                                        onChange={(event) =>
                                                            updateItem(row.key, { name: event.target.value })
                                                        }
                                                        maxLength={160}
                                                        placeholder={`Продукт ${number}`}
                                                        aria-label={`Название продукта, позиция ${number}`}
                                                        className="input min-w-0 flex-1"
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => removeItem(row.key)}
                                                        aria-label={`Удалить позицию ${number}`}
                                                        className="w-11 h-11 flex-shrink-0 flex items-center justify-center rounded-xl text-hot-600 dark:text-hot-400 hover:bg-hot-50 dark:hover:bg-hot-500/10 transition-colors"
                                                    >
                                                        ✕
                                                    </button>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                                <div>
                                                    <label className={labelClass} htmlFor={quantityId}>
                                                        Кол-во
                                                    </label>
                                                    <input
                                                        id={quantityId}
                                                        type="number"
                                                        inputMode="decimal"
                                                        min="0"
                                                        step="0.01"
                                                        value={row.quantity}
                                                        onChange={(event) =>
                                                            updateItem(row.key, { quantity: event.target.value })
                                                        }
                                                        placeholder="Кол-во"
                                                        aria-label={`Количество, позиция ${number}`}
                                                        className="input tabular-nums"
                                                    />
                                                </div>

                                                <div>
                                                    <label className={labelClass} htmlFor={unitId}>
                                                        Ед. изм.
                                                    </label>
                                                    {/* Ввод с подсказками: можно выбрать частую единицу или напечатать свою */}
                                                    <input
                                                        id={unitId}
                                                        type="text"
                                                        list="basket-units"
                                                        value={row.unit}
                                                        onChange={(event) =>
                                                            updateItem(row.key, { unit: event.target.value })
                                                        }
                                                        placeholder={DEFAULT_UNIT}
                                                        maxLength={16}
                                                        aria-label={`Единица измерения, позиция ${number}`}
                                                        className="input"
                                                    />
                                                </div>

                                                <div className="col-span-2 sm:col-span-1">
                                                    <label className={labelClass} htmlFor={shopId}>
                                                        Магазин
                                                    </label>
                                                    <div className="flex items-center gap-1.5">
                                                        <select
                                                            id={shopId}
                                                            value={row.shop_id}
                                                            onChange={(event) =>
                                                                handleShopSelect(row.key, event.target.value)
                                                            }
                                                            aria-label={`Магазин, позиция ${number}`}
                                                            className="input min-w-0 flex-1"
                                                        >
                                                            <option value="">Магазин не выбран</option>
                                                            {shops.map((shop) => (
                                                                <option key={shop.id} value={shop.id}>
                                                                    {shopOptionLabel(shop)}
                                                                </option>
                                                            ))}
                                                            <option value={ADD_SHOP_VALUE}>
                                                                ＋ Добавить магазин
                                                            </option>
                                                        </select>
                                                        {isCustomSelected && (
                                                            <button
                                                                type="button"
                                                                onClick={() => removeCustomShop(selectedShop.id)}
                                                                disabled={removingShopId === selectedShop.id}
                                                                aria-label={`Убрать магазин «${selectedShop.name}» из моих`}
                                                                className="w-11 h-11 flex-shrink-0 flex items-center justify-center rounded-xl text-hot-600 dark:text-hot-400 hover:bg-hot-50 dark:hover:bg-hot-500/10 transition-colors disabled:opacity-50"
                                                            >
                                                                {removingShopId === selectedShop.id ? '…' : '🗑'}
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>

                                                <div>
                                                    <label className={labelClass} htmlFor={priceId}>
                                                        Цена
                                                    </label>
                                                    <input
                                                        id={priceId}
                                                        type="number"
                                                        inputMode="decimal"
                                                        min="0"
                                                        step="0.01"
                                                        value={row.price}
                                                        onChange={(event) =>
                                                            updateItem(row.key, { price: event.target.value })
                                                        }
                                                        placeholder="Цена, ₽"
                                                        aria-label={`Цена, позиция ${number}`}
                                                        className="input tabular-nums"
                                                    />
                                                </div>
                                            </div>

                                            {/* Фото покупки у позиции — «вот этот творог на полке».
                                                Кнопка «📷» (44×44) и миниатюра 40×40 внутри неё:
                                                размеры фиксированные, поэтому высота строки
                                                не скачет при загрузке картинки. */}
                                            <div className="flex flex-wrap items-center gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => itemPhotoInputs.current[row.key]?.click()}
                                                    disabled={itemPhotoUploading === row.key}
                                                    aria-label={`${
                                                        row.photo_url ? 'Заменить' : 'Добавить'
                                                    } фото покупки, позиция ${number}`}
                                                    title={
                                                        row.photo_url
                                                            ? 'Заменить фото покупки'
                                                            : 'Добавить фото покупки'
                                                    }
                                                    className="w-11 h-11 flex-shrink-0 flex items-center justify-center rounded-xl border border-ink-200 dark:border-ink-700 bg-white dark:bg-ink-850 hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors disabled:opacity-60"
                                                >
                                                    {row.photo_url ? (
                                                        <img
                                                            src={mediaUrl(row.photo_url)}
                                                            alt=""
                                                            className="w-10 h-10 flex-shrink-0 rounded-xl object-cover border border-ink-200 dark:border-ink-800 bg-ink-100 dark:bg-ink-800"
                                                        />
                                                    ) : (
                                                        <span
                                                            aria-hidden="true"
                                                            className="text-lg text-ink-500 dark:text-ink-400"
                                                        >
                                                            {itemPhotoUploading === row.key ? '…' : '📷'}
                                                        </span>
                                                    )}
                                                </button>

                                                <input
                                                    ref={(node) => {
                                                        if (node) itemPhotoInputs.current[row.key] = node;
                                                        else delete itemPhotoInputs.current[row.key];
                                                    }}
                                                    type="file"
                                                    accept="image/*"
                                                    onChange={(event) =>
                                                        handleItemPhotoChange(row.key, event)
                                                    }
                                                    className="hidden"
                                                />

                                                {row.photo_url && (
                                                    <button
                                                        type="button"
                                                        onClick={() => removeItemPhoto(row.key)}
                                                        aria-label={`Убрать фото покупки, позиция ${number}`}
                                                        title="Убрать фото"
                                                        className="w-11 h-11 flex-shrink-0 flex items-center justify-center rounded-xl text-hot-600 dark:text-hot-400 hover:bg-hot-50 dark:hover:bg-hot-500/10 transition-colors"
                                                    >
                                                        ✕
                                                    </button>
                                                )}

                                                <span className="text-xs text-ink-400 dark:text-ink-500">
                                                    Фото покупки — необязательно
                                                </span>
                                            </div>

                                            {addingShopRow === row.key && (
                                                <div className="rounded-xl border border-primary-300 dark:border-primary-800 bg-primary-50/70 dark:bg-primary-900/30 p-2.5 space-y-2.5">
                                                    <div>
                                                        <label
                                                            className="label"
                                                            htmlFor={`new-shop-${row.key}`}
                                                        >
                                                            Свой магазин
                                                        </label>
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <input
                                                                id={`new-shop-${row.key}`}
                                                                type="text"
                                                                value={newShopName}
                                                                onChange={(event) =>
                                                                    setNewShopName(event.target.value)
                                                                }
                                                                onKeyDown={(event) => {
                                                                    // Внутри формы Enter отправляет форму целиком —
                                                                    // перехватываем и сохраняем только магазин
                                                                    if (event.key === 'Enter') {
                                                                        event.preventDefault();
                                                                        saveCustomShop(row.key);
                                                                    }
                                                                }}
                                                                maxLength={80}
                                                                placeholder="Магазин у дома"
                                                                className="input min-w-[9rem] flex-1"
                                                            />
                                                            <button
                                                                type="button"
                                                                onClick={() => saveCustomShop(row.key)}
                                                                disabled={savingShop || !newShopName.trim()}
                                                                className="btn-primary text-sm"
                                                            >
                                                                {savingShop ? 'Сохраняем…' : 'Сохранить'}
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={cancelAddShop}
                                                                className="btn-ghost text-sm"
                                                            >
                                                                Отмена
                                                            </button>
                                                        </div>
                                                        <p className="mt-1.5 text-xs text-ink-500 dark:text-ink-400">
                                                            Можно строчными: «магазин у дома» — сохранится как
                                                            «Магазин у дома» и появится в списке в следующий раз.
                                                        </p>
                                                    </div>

                                                    {customShops.length > 0 && (
                                                        <div>
                                                            <p className="text-[11px] font-bold uppercase tracking-wide text-ink-500 dark:text-ink-400">
                                                                Мои магазины
                                                            </p>
                                                            <ul className="mt-1.5 flex flex-wrap gap-1.5">
                                                                {customShops.map((shop) => (
                                                                    <li
                                                                        key={shop.id}
                                                                        className="inline-flex items-center gap-1 rounded-full bg-white dark:bg-ink-900 border border-ink-200 dark:border-ink-700 pl-2.5 min-h-[44px]"
                                                                    >
                                                                        <span className="text-xs font-semibold text-ink-700 dark:text-ink-200">
                                                                            🏪 {shop.name}
                                                                        </span>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => removeCustomShop(shop.id)}
                                                                            disabled={removingShopId === shop.id}
                                                                            aria-label={`Убрать магазин «${shop.name}» из моих`}
                                                                            className="w-11 h-11 flex items-center justify-center rounded-full text-hot-600 dark:text-hot-400 hover:bg-hot-50 dark:hover:bg-hot-500/10 transition-colors disabled:opacity-50"
                                                                        >
                                                                            {removingShopId === shop.id ? '…' : '🗑'}
                                                                        </button>
                                                                    </li>
                                                                ))}
                                                            </ul>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            <datalist id="basket-units">
                                {UNIT_OPTIONS.map((unit) => (
                                    <option key={unit} value={unit} />
                                ))}
                            </datalist>

                            <button type="button" onClick={addItem} className="btn-outline btn-block mt-3">
                                ➕ Добавить позицию
                            </button>
                        </>
                    )}
                </section>

                {/* Альтернатива: собрать из рецепта */}
                <section className="card p-3.5 sm:p-5">
                    <h2 className="section-title">🍲 Собрать из рецепта</h2>

                    {recipe ? (
                        <div className="mt-3 rounded-2xl border border-primary-300 dark:border-primary-800 bg-primary-50/70 dark:bg-primary-900/30 p-3.5">
                            <p className="text-sm font-semibold text-ink-900 dark:text-ink-100">
                                {recipe.title}
                            </p>
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                {recipe.cook_time_min ? (
                                    <span className="tag">⏱ {formatCount(recipe.cook_time_min)} мин</span>
                                ) : null}
                                {recipe.servings ? (
                                    <span className="tag">на {formatCount(recipe.servings)} порц.</span>
                                ) : null}
                                {recipe.category ? <span className="tag">{recipe.category}</span> : null}
                                {recipe.difficulty ? (
                                    <span className="tag">
                                        сложность: {difficultyLabel(recipe.difficulty) || '—'}
                                    </span>
                                ) : null}
                            </div>

                            {previewStatus === 'loading' && (
                                <p className="mt-2.5 text-xs text-ink-500 dark:text-ink-400" aria-live="polite">
                                    Считаем состав, магазины и стоимость…
                                </p>
                            )}

                            {previewStatus === 'ready' && preview && (
                                <div className="mt-2.5 grid grid-cols-2 gap-2">
                                    <div className="rounded-xl bg-white/80 dark:bg-ink-900/70 p-2.5">
                                        <span className="block text-[10px] font-bold uppercase tracking-wide text-ink-400 dark:text-ink-500">
                                            Состав
                                        </span>
                                        <span className="mt-0.5 block text-xs font-semibold text-ink-800 dark:text-ink-100 tabular-nums">
                                            {formatCount(preview.matched_positions ?? preview.lines?.length ?? 0)} из{' '}
                                            {formatCount(preview.total_positions ?? preview.lines?.length ?? 0)} поз.
                                        </span>
                                    </div>
                                    <div className="rounded-xl bg-white/80 dark:bg-ink-900/70 p-2.5">
                                        <span className="block text-[10px] font-bold uppercase tracking-wide text-ink-400 dark:text-ink-500">
                                            Магазины
                                        </span>
                                        <span className="mt-0.5 block text-xs font-semibold text-ink-800 dark:text-ink-100">
                                            {previewShopNames.length > 0
                                                ? `${previewShopNames.slice(0, MAX_SHOPS_IN_PREVIEW).join(', ')}${
                                                      previewShopNames.length > MAX_SHOPS_IN_PREVIEW ? ' и др.' : ''
                                                  }`
                                                : '—'}
                                        </span>
                                    </div>
                                    <div className="col-span-2 rounded-xl bg-white/80 dark:bg-ink-900/70 p-2.5 flex items-baseline justify-between gap-3">
                                        <span className="text-[10px] font-bold uppercase tracking-wide text-ink-400 dark:text-ink-500">
                                            Итого по рецепту
                                        </span>
                                        <span className="price text-xl">{formatMoney(preview.total)} ₽</span>
                                    </div>
                                </div>
                            )}

                            {previewStatus === 'ready' &&
                                preview &&
                                Number(preview.matched_positions) < Number(preview.total_positions) && (
                                    <p className="mt-2 text-xs text-secondary-600 dark:text-secondary-300">
                                        Часть ингредиентов без цены — их можно дописать вручную в позициях.
                                    </p>
                                )}

                            {previewStatus === 'error' && (
                                <p className="mt-2.5 text-xs font-semibold text-hot-600 dark:text-hot-400">
                                    Не удалось получить состав заранее. При сохранении позиции и цены
                                    подставит сервер по рецепту.
                                </p>
                            )}

                            <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={() => setPreviewNonce((nonce) => nonce + 1)}
                                    disabled={previewStatus === 'loading'}
                                    className="btn-secondary text-sm"
                                >
                                    🔄 Обновить по ценам
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setPickerOpen(true)}
                                    className="btn-secondary text-sm"
                                >
                                    Выбрать другой
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        // Убираем рецепт, но оставляем подставленные позиции как ручные
                                        setRecipe(null);
                                        setPreview(null);
                                        setPreviewStatus('idle');
                                        setPickerOpen(false);
                                        setItemsTouched(true);
                                    }}
                                    className="btn-ghost text-sm"
                                >
                                    Убрать рецепт
                                </button>
                            </div>
                        </div>
                    ) : (
                        <p className="mt-2 text-sm text-ink-500 dark:text-ink-400">
                            Не хотите вводить позиции вручную? Найдите рецепт — состав, магазины и цены
                            сразу подставятся в список, и их можно будет поправить.
                        </p>
                    )}

                    {(!recipe || pickerOpen) && (
                        <div className="mt-3">
                            <label className="label" htmlFor="recipe-search">
                                Поиск рецепта
                            </label>
                            <input
                                id="recipe-search"
                                type="search"
                                value={recipeQuery}
                                onChange={(event) => setRecipeQuery(event.target.value)}
                                placeholder="Например, сырники"
                                className="input"
                            />

                            {recipesLoading ? (
                                <div className="mt-2 space-y-2">
                                    <div className="skeleton h-12" />
                                    <div className="skeleton h-12" />
                                </div>
                            ) : recipeQuery.trim() === '' ? (
                                <p className="mt-2 text-xs text-ink-400 dark:text-ink-500">
                                    Начните вводить название блюда — покажем подходящие рецепты.
                                </p>
                            ) : matches.length === 0 ? (
                                <p className="mt-2 text-xs text-ink-400 dark:text-ink-500">
                                    Ничего не нашлось. Попробуйте другое название.
                                </p>
                            ) : (
                                <div className="mt-2 space-y-2">
                                    {matches.map((row) => {
                                        const active = recipe && String(recipe.id) === String(row.id);
                                        return (
                                            <button
                                                key={row.id}
                                                type="button"
                                                onClick={() => selectRecipe(row)}
                                                aria-pressed={Boolean(active)}
                                                className={`w-full text-left rounded-2xl border p-3 min-h-[44px] transition-colors ${
                                                    active
                                                        ? 'border-primary-400 bg-primary-50 dark:border-primary-500/70 dark:bg-primary-900/40'
                                                        : 'border-ink-200 dark:border-ink-800 hover:border-primary-400 dark:hover:border-primary-500/70 hover:bg-primary-50/60 dark:hover:bg-primary-900/30'
                                                }`}
                                            >
                                                <span className="block text-sm font-semibold text-ink-900 dark:text-ink-100">
                                                    {active ? '✓ ' : ''}
                                                    {row.title}
                                                </span>
                                                <span className="block text-xs text-ink-500 dark:text-ink-400 mt-0.5">
                                                    {row.ingredients?.length
                                                        ? `${formatCount(row.ingredients.length)} ${pluralRu(
                                                              row.ingredients.length,
                                                              'ингредиент',
                                                              'ингредиента',
                                                              'ингредиентов'
                                                          )}`
                                                        : 'состав не указан'}
                                                    {row.servings
                                                        ? ` · на ${formatCount(row.servings)} порц.`
                                                        : ''}
                                                    {row.category ? ` · ${row.category}` : ''}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                </section>

                {error && (
                    <p
                        role="alert"
                        className="rounded-2xl bg-hot-50 dark:bg-hot-500/10 text-hot-600 dark:text-hot-400 text-sm font-semibold px-3.5 py-3"
                    >
                        {error}
                    </p>
                )}

                {/* CTA: итог крупно над кнопкой, кнопка — всегда под большим пальцем */}
                <div className="sticky bottom-0 -mx-3 sm:mx-0 px-3 sm:px-0 pt-2 pb-3 bg-ink-50/95 dark:bg-ink-950/95 backdrop-blur safe-bottom space-y-2">
                    <div className="card border-primary-300/80 dark:border-primary-800 bg-primary-50/80 dark:bg-primary-900/30 p-3.5 sm:p-4">
                        <div className="flex items-end justify-between gap-3">
                            <div className="min-w-0">
                                <p className="text-[11px] sm:text-xs font-bold uppercase tracking-wide text-primary-700 dark:text-primary-300">
                                    Итого по позициям
                                </p>
                                <p
                                    className={`mt-1 text-xs ${
                                        total > 0
                                            ? 'text-ink-600 dark:text-ink-300'
                                            : 'font-semibold text-secondary-600 dark:text-secondary-300'
                                    }`}
                                >
                                    {totalHint}
                                </p>
                            </div>
                            <p
                                className={`price price-lg flex-shrink-0 text-2xl sm:text-3xl ${
                                    total > 0 ? '' : 'text-ink-400 dark:text-ink-500'
                                }`}
                            >
                                {formatMoney(total)} ₽
                            </p>
                        </div>
                    </div>

                    <button type="submit" disabled={submitting} className="btn-primary btn-block">
                        {submitting ? 'Создаём набор…' : '🧺 Создать набор'}
                    </button>
                </div>
            </form>
        </div>
    );
}

export default CreateBasketPage;
