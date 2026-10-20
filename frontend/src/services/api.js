import { API_URL } from '../utils/media';

async function request(endpoint, method = 'GET', body = null, requiresAuth = false, isFormData = false) {
    const headers = {};

    if (!isFormData) {
        headers['Content-Type'] = 'application/json';
    }

    if (requiresAuth) {
        const token = localStorage.getItem('access_token');
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
    }

    const options = {
        method,
        headers,
    };

    if (body) {
        if (isFormData) {
            options.body = body;
        } else {
            options.body = JSON.stringify(body);
        }
    }

    const response = await fetch(`${API_URL}${endpoint}`, options);

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || `HTTP ${response.status}`);
    }

    if (response.status === 204) {
        return null;
    }

    return await response.json();
}

// ========== АВТОРИЗАЦИЯ ==========
export const register = (email, username, password) =>
    request('/auth/register', 'POST', { email, username, password });

export const login = async (email, password) => {
    const data = await request('/auth/login', 'POST', { email, password });
    if (data.access_token) {
        localStorage.setItem('access_token', data.access_token);
        try {
            const userData = await getMyProfile();
            localStorage.setItem('username', userData.username);
            if (userData.avatar_url) {
                localStorage.setItem('avatar_url', userData.avatar_url);
            }
            // Роль нужна Navbar, чтобы показать пункт «Модерация»
            if (userData.role) {
                localStorage.setItem('role', userData.role);
            } else {
                localStorage.removeItem('role');
            }
        } catch (e) {
            console.error('Failed to get user data', e);
        }
    }
    return data;
};

export const getCurrentUser = () =>
    request('/auth/me', 'GET', null, true);

// ========== РЕЦЕПТЫ ==========
export const getRecipes = (skip = 0, limit = 20) =>
    request(`/recipes?skip=${skip}&limit=${limit}`, 'GET');

export const searchRecipes = (q = '', minPrice = null, maxPrice = null, skip = 0, limit = 20) => {
    let url = `/recipes/search?q=${encodeURIComponent(q)}&skip=${skip}&limit=${limit}`;
    if (minPrice !== null) url += `&min_price=${minPrice}`;
    if (maxPrice !== null) url += `&max_price=${maxPrice}`;
    return request(url, 'GET');
};

export const getRecipe = (id) =>
    request(`/recipes/${id}`, 'GET');

export const createRecipe = (recipeData) =>
    request('/recipes/', 'POST', recipeData, true);

export const deleteRecipe = (id) =>
    request(`/recipes/${id}`, 'DELETE', null, true);

export const uploadPhoto = (formData) =>
    request('/recipes/upload-photo', 'POST', formData, true, true);

export const getMyRecipes = () =>
    request('/recipes/my', 'GET', null, true);

// ========== РЕАКЦИИ И ИНДЕКС RECARTLY ==========
/* Токен отправляем, если он есть: публичный GET вернёт ещё и мою реакцию. */
export const getRecipeReactions = (recipeId) =>
    request(`/recipes/${recipeId}/reactions`, 'GET', null, true);

export const rateRecipe = (recipeId, payload) =>
    request(`/recipes/${recipeId}/reactions`, 'POST', payload, true);

export const deleteRecipeReaction = (recipeId) =>
    request(`/recipes/${recipeId}/reactions`, 'DELETE', null, true);

export const uploadCookedPhoto = (recipeId, formData) =>
    request(`/recipes/${recipeId}/cooked-photo`, 'POST', formData, true, true);

// ========== ИЗБРАННОЕ ==========
export const addFavorite = (recipeId) =>
    request(`/favorites/${recipeId}`, 'POST', null, true);

export const removeFavorite = (recipeId) =>
    request(`/favorites/${recipeId}`, 'DELETE', null, true);

export const getFavorites = () =>
    request('/favorites/', 'GET', null, true);

// ========== КОММЕНТАРИИ К РЕЦЕПТАМ ==========
export const getComments = (recipeId, skip = 0, limit = 50) =>
    request(`/comments/${recipeId}?skip=${skip}&limit=${limit}`, 'GET');

export const createComment = (recipeId, text) =>
    request(`/comments/${recipeId}`, 'POST', { text }, true);

export const deleteComment = (commentId) =>
    request(`/comments/${commentId}`, 'DELETE', null, true);

export const getLatestComments = (limit = 10) =>
    request(`/comments/latest?limit=${limit}`, 'GET');

// ========== ПРОФИЛЬ ==========
export const getMyProfile = () =>
    request('/profile/me', 'GET', null, true);

export const updateProfile = (data) =>
    request('/profile/me', 'PUT', data, true);

export const getUserProfile = (userId) =>
    request(`/profile/${userId}`, 'GET');

export const uploadAvatar = (formData) =>
    request('/profile/upload-avatar', 'POST', formData, true, true);

// ========== НАСТРОЙКИ ==========
export const updatePassword = (data) =>
    request('/profile/change-password', 'POST', data, true);

// ========== НАБОРЫ, КОРЗИНЫ И ОТЗЫВЫ ==========
// Разделы «корзины сообщества» и «отзывы» удалены из продукта: корзины стали
// наборами (см. `smeta.js`: getBasketFeed, getBasket, createBasket),
// а отзывы слились в комментарии. Эндпоинты /carts и /reviews отключены на бэкенде.

// ========== ДОСТИЖЕНИЯ ==========
export const getMyAchievements = () =>
    request('/profile/me/achievements', 'GET', null, true);

// ========== МОДЕРАЦИЯ И АДМИНКА ==========
export const getAdminWhoami = () =>
    request('/admin/whoami', 'GET', null, true);

export const getAdminStats = () =>
    request('/admin/stats', 'GET', null, true);

export const getModerationQueue = (status = 'pending', targetType = null, limit = 20, skip = 0) => {
    let url = `/admin/queue?status=${encodeURIComponent(status)}&limit=${limit}&skip=${skip}`;
    if (targetType) url += `&target_type=${encodeURIComponent(targetType)}`;
    return request(url, 'GET', null, true);
};

export const approveModerationTask = (taskId) =>
    request(`/admin/tasks/${taskId}/approve`, 'POST', null, true);

export const rejectModerationTask = (taskId, reasonCode, comment = null) =>
    request(`/admin/tasks/${taskId}/reject`, 'POST', { reason_code: reasonCode, comment }, true);

export const needsChangesModerationTask = (taskId, comment = null) =>
    request(`/admin/tasks/${taskId}/needs-changes`, 'POST', { comment }, true);

export const getAdminReports = (status = 'open', limit = 50, skip = 0) =>
    request(`/admin/reports?status=${encodeURIComponent(status)}&limit=${limit}&skip=${skip}`, 'GET', null, true);

export const resolveAdminReport = (reportId, resolution, status = 'resolved') =>
    request(`/admin/reports/${reportId}/resolve`, 'POST', { resolution, status }, true);

export const createUserSanction = (userId, kind, reason = null, expiresAt = null) =>
    request('/admin/sanctions', 'POST', {
        user_id: userId,
        kind,
        reason,
        expires_at: expiresAt,
    }, true);

export const getAdminAudit = (limit = 50, skip = 0) =>
    request(`/admin/audit?limit=${limit}&skip=${skip}`, 'GET', null, true);

export default { request };