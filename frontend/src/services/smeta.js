/**
 * API «Сметы»: бюджетный подбор, сметы покупок, меню, остатки, челленджи.
 *
 * Вынесено отдельным модулем от `api.js`, чтобы не смешивать базовый клиент
 * (авторизация, рецепты, корзины) с новой бюджетной логикой.
 * Использует тот же `request`, что и остальное приложение.
 */
import api from './api';

const { request } = api;

const qs = (params = {}) => {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') {
            return;
        }
        // Мультивыбор (например, «на сколько человек») уходит повторяющимся ключом
        if (Array.isArray(value)) {
            value
                .filter((item) => item !== undefined && item !== null && item !== '')
                .forEach((item) => search.append(key, item));
            return;
        }
        search.append(key, value);
    });
    const query = search.toString();
    return query ? `?${query}` : '';
};

// ========== НАБОРЫ И БЛЮДА ==========

/**
 * Лента публичных наборов. `budget` — во что должен влезть набор целиком,
 * `servings` — мультивыбор «на сколько человек», `sort` — popular|cheap|expensive|fresh.
 * Токен передаём: от него зависит `is_liked` у наборов.
 */
export const getBasketFeed = ({ budget, servings, sort, limit, skip } = {}) =>
    request(`/baskets/feed${qs({ budget, servings, sort, limit, skip })}`, 'GET', null, true);

/** Лента блюд, которые готовятся из наборов. Поддерживает фильтры КБЖУ для ПП. */
export const getDishFeed = ({ budget, servings, sort, max_kcal, min_protein, limit, skip } = {}) =>
    request(
        `/baskets/dishes${qs({ budget, servings, sort, max_kcal, min_protein, limit, skip })}`,
        'GET'
    );

/** Карточка набора (увеличивает счётчик просмотров). Токен нужен для `is_liked`. */
export const getBasket = (id) => request(`/baskets/${id}`, 'GET', null, true);

/** Блюда, которые готовятся из набора: авторские и по покрытию состава. */
export const getBasketRecipes = (id) => request(`/baskets/${id}/recipes`, 'GET');

/** Комментарии набора. Токен нужен: от него зависят `is_mine` и `my_reaction`. */
export const getBasketComments = (id) => request(`/baskets/${id}/comments`, 'GET', null, true);

export const addBasketComment = (id, payload) =>
    request(`/baskets/${id}/comments`, 'POST', payload, true);

export const likeBasket = (id) => request(`/baskets/${id}/like`, 'POST', null, true);

export const unlikeBasket = (id) => request(`/baskets/${id}/like`, 'DELETE', null, true);

/** Обновление цен набора: `prices_date` обязательна, `items` — [{id, price}]. */
export const updateBasketPrices = (id, payload) =>
    request(`/baskets/${id}/prices`, 'PATCH', payload, true);

export const createBasket = (payload) => request('/baskets/', 'POST', payload, true);

export const getMyBaskets = () => request('/baskets/', 'GET', null, true);

export const deleteBasket = (id) => request(`/baskets/${id}`, 'DELETE', null, true);

export const shareBasket = (id, family = true) =>
    request(`/baskets/${id}/share${qs({ family })}`, 'POST', null, true);

// ========== ГЕОГРАФИЯ ==========

/**
 * Города России. Параметры необязательные — вызов `getCities()` без аргументов
 * по-прежнему возвращает 50 крупнейших городов (обратная совместимость).
 *
 * @param {{q?: string, limit?: number, offset?: number}} [params]
 *        `q` — поиск по названию, затем по региону; `limit` ≤ 300.
 */
export const getCities = ({ q, limit, offset } = {}) =>
    request(`/geo/cities${qs({ q, limit, offset })}`, 'GET');

/** Короткая обёртка для автодополнения города в выпадающем списке. */
export const searchCities = (q = '', limit = 20) => getCities({ q, limit });

/**
 * Добавить город, которого нет в справочнике (без авторизации).
 * Название нормализуется на бэкенде («  нижний тагил  » → «Нижний Тагил»);
 * если город уже есть, возвращается существующий — дубликатов не будет.
 */
export const createCity = ({ name, region } = {}) =>
    request('/geo/cities', 'POST', { name, region: region || null });

/**
 * Магазины города. Токен передаём: к списку добавляются личные магазины
 * пользователя («магазин у дома»), которые видны только автору.
 */
export const getShops = (cityId = null, onlyPartners = false) =>
    request(
        `/geo/shops${qs({ city_id: cityId, only_partners: onlyPartners || undefined })}`,
        'GET',
        null,
        true
    );

// ========== БЮДЖЕТНЫЙ ПОДБОР ==========

export const getBudgetSelection = ({
    budget,
    city_id,
    servings,
    category,
    max_shops,
    limit,
    max_time_min,
    difficulty,
    max_kcal,
    min_protein,
    sort,
} = {}) =>
    request(
        `/catalog/budget${qs({
            budget,
            city_id,
            servings,
            category,
            max_shops,
            limit,
            max_time_min,
            difficulty,
            max_kcal,
            min_protein,
            sort,
        })}`,
        'GET'
    );

export const getBudgetShelves = ({ city_id, servings, max_shops } = {}) =>
    request(`/catalog/shelves${qs({ city_id, servings, max_shops })}`, 'GET');

export const getRecipeCost = (recipeId, { city_id, servings, max_shops, budget } = {}) =>
    request(
        `/catalog/recipes/${recipeId}/cost${qs({ city_id, servings, max_shops, budget })}`,
        'GET'
    );

export const getSeasonalProducts = (cityId = null) =>
    request(`/catalog/seasonal${qs({ city_id: cityId })}`, 'GET');

export const getPriceHistory = (productId, { city_id, shop_id, limit } = {}) =>
    request(`/catalog/price-history/${productId}${qs({ city_id, shop_id, limit })}`, 'GET');

// ========== ПАРТНЁРСКИЕ ССЫЛКИ ==========

export const getAffiliateLink = (shopId, query = null) =>
    request(`/go/link/${shopId}${qs({ query })}`, 'GET');

/** Прямой переход в магазин с фиксацией клика (открывать в новой вкладке). */
export const getShopRedirectUrl = (shopId, { query, recipe_id, basket_id } = {}) => {
    const base = (process.env.REACT_APP_API_URL || 'http://localhost:8000').replace(/\/$/, '');
    return `${base}/go/${shopId}${qs({ query, recipe_id, basket_id })}`;
};

// ========== НАБОР: ССЫЛКИ И ОТМЕТКИ ==========

/** Набор по ссылке-токену — доступен без авторизации (семейная закупка). */
export const getSharedBasket = (token) => request(`/baskets/shared/${token}`, 'GET');

/**
 * Что подставится в набор по рецепту — до сохранения.
 * Возвращает {recipe_id, title, servings, total, lines: [{name, quantity, unit, shop_name, price}]}.
 */
export const previewBasket = (recipeId, { city_id, servings } = {}) =>
    request(`/baskets/preview${qs({ recipe_id: recipeId, city_id, servings })}`, 'GET');

/** Реакция на комментарий набора. Повторный вызов с тем же эмодзи снимает реакцию. */
export const reactToComment = (basketId, commentId, emoji) =>
    request(`/baskets/${basketId}/comments/${commentId}/reactions`, 'POST', { emoji }, true);

export const deleteBasketComment = (basketId, commentId) =>
    request(`/baskets/${basketId}/comments/${commentId}`, 'DELETE', null, true);

/** Скрыть набор из ленты или вернуть обратно (решает автор). */
export const setBasketVisibility = (basketId, isPublic) =>
    request(`/baskets/${basketId}/visibility${qs({ is_public: isPublic })}`, 'PATCH', null, true);

/** Добавить свой магазин («магазин у дома») — появится в списках выбора. */
export const createCustomShop = (name) => request('/geo/shops', 'POST', { name }, true);

export const deleteCustomShop = (shopId) => request(`/geo/shops/${shopId}`, 'DELETE', null, true);

/** Отметить позицию купленной (в том числе в семейном наборе) или поправить количество. */
export const patchBasketItem = (basketId, itemId, payload) =>
    request(`/baskets/${basketId}/items/${itemId}`, 'PATCH', payload, true);

/** Пересобрать состав набора по ценам магазинов. */
export const optimizeBasket = (basketId, cityId = null) =>
    request(`/baskets/${basketId}/optimize${qs({ city_id: cityId })}`, 'POST', null, true);

// ========== ПЛАН ПИТАНИЯ ==========

/** save=true — сохранить план (нужна авторизация), иначе только предпросмотр. */
export const generateMealPlan = (payload, save = false) =>
    save
        ? request('/mealplans/', 'POST', payload, true)
        : request('/mealplans/preview', 'POST', payload);

export const getMyMealPlans = () => request('/mealplans/', 'GET', null, true);

export const getMealPlan = (planId) => request(`/mealplans/${planId}`, 'GET', null, true);

export const deleteMealPlan = (planId) => request(`/mealplans/${planId}`, 'DELETE', null, true);

// ========== ОСТАТКИ ДОМА ==========

export const getPantry = () => request('/pantry/', 'GET', null, true);

export const addPantryItem = (payload) => request('/pantry/', 'POST', payload, true);

export const deletePantryItem = (itemId) => request(`/pantry/${itemId}`, 'DELETE', null, true);

export const suggestByPantry = ({ city_id, limit, min_covered } = {}) =>
    request(`/pantry/suggest${qs({ city_id, limit, min_covered })}`, 'POST', null, true);

// ========== ЧЕЛЛЕНДЖИ И НАГРАДЫ ==========

export const getChallenges = (activeOnly = true) =>
    request(`/challenges/${qs({ active_only: activeOnly })}`, 'GET');

export const getLeaderboard = (challengeId, limit = 20) =>
    request(`/challenges/${challengeId}/leaderboard${qs({ limit })}`, 'GET');

export const joinChallenge = (challengeId, payload) =>
    request(`/challenges/${challengeId}/join`, 'POST', payload, true);

export const getMyAchievements = () => request('/achievements/', 'GET', null, true);

export const getAchievementsCatalog = () => request('/achievements/catalog', 'GET');

export const checkAchievements = () => request('/achievements/check', 'POST', null, true);

// ========== ЖАЛОБЫ ==========

export const getReportReasons = () => request('/reports/reasons', 'GET');

export const createReport = (payload) => request('/reports/', 'POST', payload, true);

export const getMyReports = () => request('/reports/my', 'GET', null, true);

// ========== УВЕДОМЛЕНИЯ ==========

export const getNotifications = ({ unreadOnly = false, limit = 30, skip = 0 } = {}) =>
    request(
        `/notifications${qs({ unread_only: unreadOnly || undefined, limit, skip })}`,
        'GET',
        null,
        true
    );

export const getUnreadNotificationsCount = () =>
    request('/notifications/unread-count', 'GET', null, true);

export const markNotificationRead = (id) =>
    request(`/notifications/${id}/read`, 'POST', null, true);

export const markAllNotificationsRead = () =>
    request('/notifications/read-all', 'POST', null, true);

export const deleteNotification = (id) =>
    request(`/notifications/${id}`, 'DELETE', null, true);

// ========== ЦЕНЫ ГОРОДА (тренды) ==========

export const getPriceTrends = ({ city_id, days, limit } = {}) =>
    request(`/catalog/trends${qs({ city_id, days, limit })}`, 'GET');

// ========== ЦЕНЫ ОТ ЛЮДЕЙ (краудсорсинг) ==========
// Пользователь приносит цену из магазина с фото ценника, модерация её проверяет,
// после чего цена попадает в расчёты смет.

/** Автодополнение продукта по названию и алиасам. */
export const searchProducts = (q = '', limit = 20) =>
    request(`/prices/products${qs({ q, limit })}`, 'GET');

/** Создать цену. Ответ содержит status: 'pending' (на модерации) или 'confirmed'. */
export const createPrice = (payload) => request('/prices/', 'POST', payload, true);

/** Загрузить фото ценника (FormData с полем file) → { photo_url }. */
export const uploadPricePhoto = (formData) =>
    request('/prices/upload-photo', 'POST', formData, true, true);

/** Мои цены со статусами: видно, приняли цену или отклонили. */
export const getMyPrices = (limit = 50) => request(`/prices/my${qs({ limit })}`, 'GET', null, true);

/** Последние подтверждённые цены города — лента «кто что видел». */
export const getRecentPrices = (cityId = null, limit = 10) =>
    request(`/prices/recent${qs({ city_id: cityId, limit })}`, 'GET');

/** Подтвердить цену вручную (только модератор/админ). */
export const confirmPrice = (id) => request(`/prices/${id}/confirm`, 'POST', null, true);

// ========== МОЯ НЕДЕЛЯ ==========

/** Сводка: план питания, сметы, траты, экономия и сравнение с доставкой. */
export const getWeekSummary = (days = 7) =>
    request(`/dashboard/week${qs({ days })}`, 'GET', null, true);

// ========== АКЦИИ ОТ ЛЮДЕЙ ==========
// «Увидел ценник в магазине — поделился»: пользователь описывает акцию
// (старая и новая цена), модерация её проверяет, после чего она попадает в ленту.

/** Опубликованные и не истёкшие акции города: { total, items }.
 *  sort: 'hot' (популярные) | 'new' (свежие) | 'discount' (максимальная скидка). */
export const getPromos = ({ city_id, shop_id, sort, limit, skip } = {}) =>
    request(`/promos/${qs({ city_id, shop_id, sort, limit, skip })}`, 'GET');

/** Мои акции со всеми статусами: pending, published, rejected, needs_changes. */
export const getMyPromos = (limit = 50) => request(`/promos/my${qs({ limit })}`, 'GET', null, true);

/** Одна акция. Внимание: backend увеличивает счётчик просмотров. */
export const getPromo = (id) => request(`/promos/${id}`, 'GET');

/** Создать акцию. Ответ содержит status: 'pending' (на модерации) или 'published'. */
export const createPromo = (payload) => request('/promos/', 'POST', payload, true);

/** Загрузить фото ценника (FormData с полем file) → { photo_url }. */
export const uploadPromoPhoto = (formData) =>
    request('/promos/upload-photo', 'POST', formData, true, true);

export const likePromo = (id) => request(`/promos/${id}/like`, 'POST', null, true);

export const unlikePromo = (id) => request(`/promos/${id}/like`, 'DELETE', null, true);

/** Удалить свою акцию (модератор может удалить любую). */
export const deletePromo = (id) => request(`/promos/${id}`, 'DELETE', null, true);
