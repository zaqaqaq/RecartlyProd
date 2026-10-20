import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getMyProfile, updateProfile, getMyRecipes, getFavorites, uploadAvatar } from '../services/api';
import { getMyBaskets } from '../services/smeta';
import { mediaUrl } from '../utils/media';

/* Пресеты аватарок. Значение сохраняется строкой `emoji:<emoji>:<bg>:<textColor>`
   (формат данных и вызовы API не меняются) — только палитра приведена к токенам проекта. */
const PRESET_AVATARS = [
    { emoji: '🍲', bg: 'bg-primary-100', textColor: 'text-primary-600' },
    { emoji: '👨‍🍳', bg: 'bg-blue-100', textColor: 'text-blue-600' },
    { emoji: '👩‍🍳', bg: 'bg-pink-100', textColor: 'text-pink-600' },
    { emoji: '🍕', bg: 'bg-orange-100', textColor: 'text-orange-600' },
    { emoji: '🥗', bg: 'bg-primary-100', textColor: 'text-primary-700' },
    { emoji: '🍰', bg: 'bg-rose-100', textColor: 'text-rose-600' },
    { emoji: '🐱', bg: 'bg-yellow-100', textColor: 'text-yellow-600' },
    { emoji: '🐶', bg: 'bg-amber-100', textColor: 'text-amber-600' },
    { emoji: '⭐', bg: 'bg-purple-100', textColor: 'text-purple-600' },
    { emoji: '❤️', bg: 'bg-red-100', textColor: 'text-red-600' },
    { emoji: '👍', bg: 'bg-indigo-100', textColor: 'text-indigo-600' },
    { emoji: '😋', bg: 'bg-teal-100', textColor: 'text-teal-600' },
];

/* Презентационное приведение палитры: у части пользователей аватарка сохранена
   со старыми зелёными классами — показываем её в акцентной палитре проекта. */
const AVATAR_COLOR_MAP = {
    'bg-green-100': 'bg-primary-100',
    'bg-emerald-100': 'bg-primary-100',
    'text-green-600': 'text-primary-600',
    'text-green-700': 'text-primary-700',
    'text-emerald-600': 'text-primary-600',
};

const resolveAvatarColor = (value, fallback) => AVATAR_COLOR_MAP[value] || value || fallback;

function AvatarDisplay({ avatarUrl, username, size = "w-24 h-24 text-4xl" }) {
    const getInitials = () => {
        return username ? username[0].toUpperCase() : '?';
    };

    if (avatarUrl && avatarUrl.startsWith('emoji:')) {
        const parts = avatarUrl.split(':');
        const emoji = parts[1];
        const bg = resolveAvatarColor(parts[2], 'bg-primary-100');
        const textColor = resolveAvatarColor(parts[3], 'text-primary-600');
        return (
            <span className={`${size} avatar ring-4 ring-white dark:ring-ink-900 ${bg} ${textColor}`}>
                {emoji}
            </span>
        );
    } else if (avatarUrl) {
        return (
            <img
                src={mediaUrl(avatarUrl)}
                alt={username}
                className={`${size} avatar object-cover ring-4 ring-white dark:ring-ink-900`}
            />
        );
    }
    return (
        <span className={`${size} avatar ring-4 ring-white dark:ring-ink-900`}>
            {getInitials()}
        </span>
    );
}

function ProfilePage() {
    const navigate = useNavigate();
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(false);
    const [activeTab, setActiveTab] = useState('recipes');
    const [myRecipes, setMyRecipes] = useState([]);
    const [myBaskets, setMyBaskets] = useState([]);
    const [favorites, setFavorites] = useState([]);
    const [uploading, setUploading] = useState(false);
    const [formData, setFormData] = useState({
        username: '',
        bio: '',
        city: '',
        website: ''
    });
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    useEffect(() => {
        loadProfile();
        loadMyRecipes();
        loadMyBaskets();
        loadFavorites();
    }, []);

    const loadProfile = async () => {
        try {
            const data = await getMyProfile();
            setProfile(data);
            setFormData({
                username: data.username || '',
                bio: data.bio || '',
                city: data.city || '',
                website: data.website || ''
            });
            localStorage.setItem('username', data.username);
            if (data.avatar_url) {
                localStorage.setItem('avatar_url', data.avatar_url);
            } else {
                localStorage.removeItem('avatar_url');
            }
            window.dispatchEvent(new Event('storage'));
        } catch (err) {
            console.error('Ошибка загрузки профиля:', err);
        } finally {
            setLoading(false);
        }
    };

    const loadMyRecipes = async () => {
        try {
            const data = await getMyRecipes();
            setMyRecipes(data || []);
        } catch (err) {
            console.error('Ошибка загрузки рецептов:', err);
        }
    };

    const loadMyBaskets = async () => {
        try {
            const data = await getMyBaskets();
            setMyBaskets(data || []);
        } catch (err) {
            console.error('Ошибка загрузки наборов:', err);
        }
    };

    const loadFavorites = async () => {
        try {
            const data = await getFavorites();
            setFavorites(data || []);
        } catch (err) {
            console.error('Ошибка загрузки избранного:', err);
        }
    };

    const handleChange = (e) => {
        setFormData({
            ...formData,
            [e.target.name]: e.target.value
        });
    };

    const handleSelectPreset = async (preset) => {
        const avatarValue = `emoji:${preset.emoji}:${preset.bg}:${preset.textColor}`;
        setUploading(true);
        setError('');

        try {
            await updateProfile({ avatar_url: avatarValue });
            localStorage.setItem('avatar_url', avatarValue);
            setSuccess('Аватарка обновлена!');
            setTimeout(() => setSuccess(''), 2000);
            loadProfile();
        } catch (err) {
            setError('Ошибка сохранения аватарки');
        } finally {
            setUploading(false);
        }
    };

    const handleFileUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            setError('Можно загружать только изображения');
            return;
        }

        if (file.size > 2 * 1024 * 1024) {
            setError('Файл не должен превышать 2MB');
            return;
        }

        const formDataPhoto = new FormData();
        formDataPhoto.append('file', file);

        setUploading(true);
        setError('');

        try {
            const response = await uploadAvatar(formDataPhoto);
            await updateProfile({ avatar_url: response.avatar_url });
            localStorage.setItem('avatar_url', response.avatar_url);
            setSuccess('Фото загружено!');
            setTimeout(() => setSuccess(''), 2000);
            loadProfile();
        } catch (err) {
            setError('Ошибка загрузки фото');
        } finally {
            setUploading(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setSuccess('');

        try {
            const updateData = {
                username: formData.username,
                bio: formData.bio,
                city: formData.city,
                website: formData.website
            };
            const updated = await updateProfile(updateData);
            setProfile(updated);
            localStorage.setItem('username', updated.username);
            setSuccess('Профиль успешно обновлён!');
            setEditing(false);
            setTimeout(() => setSuccess(''), 3000);
            window.dispatchEvent(new Event('storage'));
        } catch (err) {
            setError('Ошибка обновления профиля');
        }
    };

    const handleLogout = () => {
        localStorage.removeItem('access_token');
        localStorage.removeItem('username');
        localStorage.removeItem('avatar_url');
        window.dispatchEvent(new Event('storage'));
        window.dispatchEvent(new Event('authChange'));
        navigate('/login');
    };

    if (loading) {
        return (
            <div className="max-w-4xl mx-auto">
                <div className="card p-8 text-center">
                    <p className="text-ink-500 dark:text-ink-400">Загрузка профиля...</p>
                </div>
            </div>
        );
    }

    if (!profile) return null;

    const getCurrentAvatarDisplay = () => {
        if (!profile) return null;

        if (profile.avatar_url && profile.avatar_url.startsWith('emoji:')) {
            const parts = profile.avatar_url.split(':');
            const emoji = parts[1];
            const bg = resolveAvatarColor(parts[2], 'bg-primary-100');
            const textColor = resolveAvatarColor(parts[3], 'text-primary-600');
            return (
                <div className={`w-20 h-20 avatar text-3xl ${bg} ${textColor}`}>
                    {emoji}
                </div>
            );
        } else if (profile.avatar_url) {
            return (
                <img
                    src={mediaUrl(profile.avatar_url)}
                    alt="Avatar"
                    className="w-20 h-20 avatar object-cover"
                />
            );
        } else {
            return (
                <div className="w-20 h-20 avatar text-2xl">
                    {profile.username?.[0]?.toUpperCase() || '?'}
                </div>
            );
        }
    };

    const renderTabContent = () => {
        switch (activeTab) {
            case 'recipes':
                return (
                    <div className="space-y-3">
                        <h3 className="heading-3">Мои рецепты ({myRecipes.length})</h3>
                        {myRecipes.length === 0 ? (
                            <div className="card p-8 text-center">
                                <div className="w-14 h-14 mx-auto rounded-3xl bg-primary-100 dark:bg-primary-900/25 flex items-center justify-center text-2xl mb-3">
                                    📝
                                </div>
                                <p className="text-ink-600 dark:text-ink-400 mb-4">У вас пока нет рецептов</p>
                                <Link to="/create" className="btn-primary btn-block sm:w-auto sm:inline-flex">
                                    Создать рецепт
                                </Link>
                            </div>
                        ) : (
                            myRecipes.map((recipe, index) => (
                                <article
                                    key={recipe.id}
                                    className="card card-hover overflow-hidden animate-fade-in-up"
                                    style={{ animationDelay: `${Math.min(index, 6) * 45}ms` }}
                                >
                                    <div className="flex gap-3 p-3 sm:p-4">
                                        {recipe.photo_url && (
                                            <div className="w-20 h-20 xs:w-24 xs:h-24 rounded-2xl overflow-hidden bg-ink-100 dark:bg-ink-800 flex-shrink-0">
                                                <img
                                                    src={mediaUrl(recipe.photo_url)}
                                                    alt={recipe.title}
                                                    loading="lazy"
                                                    className="w-full h-full object-cover"
                                                />
                                            </div>
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <Link
                                                to={`/recipe/${recipe.id}`}
                                                className="block font-bold text-[15px] sm:text-lg leading-snug text-ink-900 dark:text-white hover:text-primary-600 dark:hover:text-primary-400 transition-colors line-clamp-2"
                                            >
                                                {recipe.title}
                                            </Link>
                                            <p className="text-ink-500 dark:text-ink-400 text-sm mt-1 line-clamp-2">{recipe.description || 'Без описания'}</p>
                                            <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
                                                <div className="flex items-center gap-3 text-sm text-ink-500 dark:text-ink-400">
                                                    <span className="inline-flex items-center gap-1 tabular-nums">❤️ {recipe.favorites_count || 0}</span>
                                                    <span className="inline-flex items-center gap-1 tabular-nums">💬 {recipe.comments_count || 0}</span>
                                                </div>
                                                <span className="price text-base sm:text-lg whitespace-nowrap">{recipe.total_price} ₽</span>
                                            </div>
                                        </div>
                                    </div>
                                </article>
                            ))
                        )}
                    </div>
                );
            case 'carts':
                return (
                    <div className="space-y-3">
                        <h3 className="heading-3">Мои наборы ({myBaskets.length})</h3>
                        {myBaskets.length === 0 ? (
                            <div className="card p-8 text-center">
                                <div className="w-14 h-14 mx-auto rounded-3xl bg-primary-100 dark:bg-primary-900/25 flex items-center justify-center text-2xl mb-3">
                                    🧺
                                </div>
                                <p className="text-ink-600 dark:text-ink-400 mb-4">У вас пока нет наборов</p>
                                <Link to="/create-basket" className="btn-primary btn-block sm:w-auto sm:inline-flex">
                                    Создать набор
                                </Link>
                            </div>
                        ) : (
                            myBaskets.map((basket, index) => (
                                <article
                                    key={basket.id}
                                    className="card card-hover p-3 sm:p-5 animate-fade-in-up"
                                    style={{ animationDelay: `${Math.min(index, 6) * 45}ms` }}
                                >
                                    <Link
                                        to={`/basket/${basket.id}`}
                                        className="block font-bold text-[15px] sm:text-lg leading-snug text-ink-900 dark:text-white hover:text-primary-600 dark:hover:text-primary-400 transition-colors line-clamp-2"
                                    >
                                        {basket.title}
                                    </Link>
                                    <p className="text-ink-500 dark:text-ink-400 text-sm mt-1 line-clamp-2">{basket.description || 'Без описания'}</p>
                                    <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
                                        <div className="flex items-center gap-3 text-sm text-ink-500 dark:text-ink-400">
                                            <span className="inline-flex items-center gap-1 tabular-nums">❤️ {basket.likes_count || 0}</span>
                                            <span className="inline-flex items-center gap-1 tabular-nums">🧺 {basket.items_count || 0}</span>
                                        </div>
                                        <span className="price text-base sm:text-lg whitespace-nowrap">{basket.total_price} ₽</span>
                                    </div>
                                </article>
                            ))
                        )}
                    </div>
                );
            case 'favorites':
                return (
                    <div className="space-y-3">
                        <h3 className="heading-3">Избранное ({favorites.length})</h3>
                        {favorites.length === 0 ? (
                            <div className="card p-8 text-center">
                                <div className="w-14 h-14 mx-auto rounded-3xl bg-hot-50 dark:bg-hot-600/15 flex items-center justify-center text-2xl mb-3">
                                    ⭐
                                </div>
                                <p className="text-ink-600 dark:text-ink-400 mb-4">У вас пока нет избранных рецептов</p>
                                <Link to="/" className="btn-primary btn-block sm:w-auto sm:inline-flex">
                                    Найти рецепты
                                </Link>
                            </div>
                        ) : (
                            favorites.map((recipe, index) => (
                                <article
                                    key={recipe.id}
                                    className="card card-hover overflow-hidden animate-fade-in-up"
                                    style={{ animationDelay: `${Math.min(index, 6) * 45}ms` }}
                                >
                                    <div className="flex gap-3 p-3 sm:p-4">
                                        {recipe.photo_url && (
                                            <div className="w-20 h-20 xs:w-24 xs:h-24 rounded-2xl overflow-hidden bg-ink-100 dark:bg-ink-800 flex-shrink-0">
                                                <img
                                                    src={mediaUrl(recipe.photo_url)}
                                                    alt={recipe.title}
                                                    loading="lazy"
                                                    className="w-full h-full object-cover"
                                                />
                                            </div>
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <Link
                                                to={`/recipe/${recipe.id}`}
                                                className="block font-bold text-[15px] sm:text-lg leading-snug text-ink-900 dark:text-white hover:text-primary-600 dark:hover:text-primary-400 transition-colors line-clamp-2"
                                            >
                                                {recipe.title}
                                            </Link>
                                            <p className="text-ink-500 dark:text-ink-400 text-sm mt-1 line-clamp-2">{recipe.description || 'Без описания'}</p>
                                            <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
                                                <div className="flex items-center gap-3 text-sm text-ink-500 dark:text-ink-400">
                                                    <span className="inline-flex items-center gap-1 tabular-nums">❤️ {recipe.favorites_count || 0}</span>
                                                    <span className="inline-flex items-center gap-1 tabular-nums">💬 {recipe.comments_count || 0}</span>
                                                </div>
                                                <span className="price text-base sm:text-lg whitespace-nowrap">{recipe.total_price} ₽</span>
                                            </div>
                                        </div>
                                    </div>
                                </article>
                            ))
                        )}
                    </div>
                );
            case 'settings':
                return (
                    <div className="space-y-3">
                        <h3 className="heading-3">⚙️ Настройки</h3>
                        <div className="card p-4 sm:p-6">
                            <div className="space-y-4">
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 bg-ink-50 dark:bg-ink-850 rounded-2xl">
                                    <div className="min-w-0">
                                        <p className="font-semibold text-ink-900 dark:text-white">Управление аккаунтом</p>
                                        <p className="text-sm text-ink-500 dark:text-ink-400">Смена пароля, информация о сайте</p>
                                    </div>
                                    <Link
                                        to="/settings"
                                        className="btn-primary btn-block sm:w-auto sm:inline-flex text-sm"
                                    >
                                        Перейти
                                    </Link>
                                </div>
                                <p className="text-xs text-ink-400 dark:text-ink-500 text-center">
                                    Настройки откроются в отдельной странице
                                </p>
                            </div>
                        </div>
                    </div>
                );
            default:
                return null;
        }
    };

    return (
        <div className="max-w-4xl mx-auto pb-bottom-nav animate-fade-in">
            {/* Шапка профиля */}
            <section className="card overflow-hidden p-4 sm:p-6">
                <div className="flex flex-col items-center text-center gap-4 sm:flex-row sm:items-center sm:text-left sm:gap-6">
                    <AvatarDisplay
                        avatarUrl={profile.avatar_url}
                        username={profile.username}
                        size="w-20 h-20 text-3xl sm:w-24 sm:h-24 sm:text-4xl"
                    />
                    <div className="flex-1 min-w-0">
                        <h1 className="heading-2 break-words">{profile.username}</h1>
                        <p className="text-ink-500 dark:text-ink-400 text-sm mt-0.5">@{profile.username}</p>
                        <p className="text-ink-400 dark:text-ink-500 text-xs mt-0.5">
                            Регистрация: {new Date(profile.created_at).toLocaleDateString('ru-RU')}
                        </p>
                    </div>
                    <div className="flex flex-col xs:flex-row sm:flex-row gap-2 w-full sm:w-auto">
                        {!editing && (
                            <button
                                onClick={() => {
                                    setEditing(true);
                                    setError('');
                                    setSuccess('');
                                }}
                                className="btn-secondary btn-block sm:w-auto"
                            >
                                ✏️ Редактировать
                            </button>
                        )}
                        <button
                            onClick={handleLogout}
                            className="btn-danger btn-block sm:w-auto"
                        >
                            🚪 Выйти
                        </button>
                    </div>
                </div>

                {/* Статистика */}
                <div className="grid grid-cols-3 gap-2 py-4 mt-4 border-t border-ink-100 dark:border-ink-800">
                    <div className="text-center">
                        <div className="text-xl sm:text-2xl font-extrabold tabular-nums text-ink-900 dark:text-white">{profile.recipes_count || 0}</div>
                        <div className="text-[11px] sm:text-xs text-ink-500 dark:text-ink-400">рецептов</div>
                    </div>
                    <div className="text-center">
                        <div className="text-xl sm:text-2xl font-extrabold tabular-nums text-ink-900 dark:text-white">{profile.comments_count || 0}</div>
                        <div className="text-[11px] sm:text-xs text-ink-500 dark:text-ink-400">комментариев</div>
                    </div>
                    <div className="text-center">
                        <div className="text-xl sm:text-2xl font-extrabold tabular-nums text-ink-900 dark:text-white">{profile.likes_received || 0}</div>
                        <div className="text-[11px] sm:text-xs text-ink-500 dark:text-ink-400">лайков</div>
                    </div>
                </div>

                {/* Информация о пользователе */}
                {!editing && (
                    <div className="mt-4 p-4 bg-ink-50 dark:bg-ink-850 rounded-2xl space-y-2 text-ink-600 dark:text-ink-300">
                        <div className="flex items-start gap-2">
                            <span className="text-lg leading-none">📝</span>
                            <span className="min-w-0 break-words">{profile.bio || <span className="text-ink-400 dark:text-ink-500 italic">О себе не указано</span>}</span>
                        </div>
                        <div className="flex items-start gap-2">
                            <span className="text-lg leading-none">📍</span>
                            <span className="min-w-0 break-words">{profile.city || <span className="text-ink-400 dark:text-ink-500 italic">Город не указан</span>}</span>
                        </div>
                        <div className="flex items-start gap-2">
                            <span className="text-lg leading-none">🌐</span>
                            <span className="min-w-0 break-words">
                                {profile.website ? (
                                    <a href={profile.website} target="_blank" rel="noopener noreferrer" className="text-primary-600 dark:text-primary-400 hover:underline break-all">
                                        {profile.website}
                                    </a>
                                ) : (
                                    <span className="text-ink-400 dark:text-ink-500 italic">Сайт не указан</span>
                                )}
                            </span>
                        </div>
                    </div>
                )}

                {/* Редактирование профиля (с аватаркой) */}
                {editing && (
                    <div className="mt-5 pt-4 border-t border-ink-100 dark:border-ink-800">
                        <h3 className="heading-3 mb-4">Редактирование профиля</h3>

                        {/* Текущая аватарка */}
                        <div className="flex flex-col items-center mb-6">
                            <h4 className="label mb-2">Текущая аватарка</h4>
                            {getCurrentAvatarDisplay()}
                        </div>

                        {/* Выбор аватарки */}
                        <div className="mb-6">
                            <h4 className="label">Выбрать иконку</h4>
                            <div className="grid grid-cols-4 xs:grid-cols-6 gap-2 sm:gap-3">
                                {PRESET_AVATARS.map((preset, index) => (
                                    <button
                                        key={index}
                                        type="button"
                                        onClick={() => handleSelectPreset(preset)}
                                        disabled={uploading}
                                        aria-label={`Аватарка ${preset.emoji}`}
                                        className={`w-12 h-12 avatar text-xl press hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed ${preset.bg} ${preset.textColor}`}
                                    >
                                        {preset.emoji}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Загрузка фото */}
                        <div className="mb-6">
                            <h4 className="label">Загрузить своё фото</h4>
                            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                                <label className={`btn-primary btn-block sm:w-auto cursor-pointer ${uploading ? 'opacity-50 cursor-not-allowed' : ''}`}>
                                    {uploading ? 'Загрузка...' : '📷 Выбрать фото'}
                                    <input
                                        type="file"
                                        accept="image/*"
                                        onChange={handleFileUpload}
                                        disabled={uploading}
                                        className="hidden"
                                    />
                                </label>
                                <p className="text-sm text-ink-500 dark:text-ink-400 text-center sm:text-left">JPG, PNG до 2MB</p>
                            </div>
                        </div>

                        {/* Форма редактирования */}
                        <form onSubmit={handleSubmit} className="space-y-4">
                            {error && <div className="bg-hot-50 dark:bg-hot-600/15 border border-hot-100 dark:border-hot-600/30 text-hot-600 dark:text-hot-400 px-4 py-3 rounded-2xl text-sm">{error}</div>}
                            {success && <div className="bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-900/40 text-primary-700 dark:text-primary-300 px-4 py-3 rounded-2xl text-sm">{success}</div>}

                            <div>
                                <label className="label">Имя пользователя</label>
                                <input
                                    type="text"
                                    name="username"
                                    value={formData.username}
                                    onChange={handleChange}
                                    className="input"
                                />
                            </div>
                            <div>
                                <label className="label">О себе</label>
                                <textarea
                                    name="bio"
                                    value={formData.bio}
                                    onChange={handleChange}
                                    rows="3"
                                    className="input"
                                    placeholder="Расскажите о себе..."
                                />
                            </div>
                            <div>
                                <label className="label">Город</label>
                                <input
                                    type="text"
                                    name="city"
                                    value={formData.city}
                                    onChange={handleChange}
                                    className="input"
                                    placeholder="Ваш город"
                                />
                            </div>
                            <div>
                                <label className="label">Сайт</label>
                                <input
                                    type="url"
                                    name="website"
                                    value={formData.website}
                                    onChange={handleChange}
                                    className="input"
                                    placeholder="https://..."
                                />
                            </div>
                            <div className="flex flex-col sm:flex-row gap-3">
                                <button type="submit" className="btn-primary btn-block sm:w-auto">
                                    Сохранить изменения
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setEditing(false);
                                        setError('');
                                        setSuccess('');
                                        setFormData({
                                            username: profile.username || '',
                                            bio: profile.bio || '',
                                            city: profile.city || '',
                                            website: profile.website || ''
                                        });
                                    }}
                                    className="btn-secondary btn-block sm:w-auto"
                                >
                                    Отмена
                                </button>
                            </div>
                        </form>
                    </div>
                )}
            </section>

            {/* Вкладки — горизонтальная лента на мобильных */}
            <div className="hscroll mt-5 -mx-3 px-3 sm:mx-0 sm:px-0">
                <button
                    type="button"
                    onClick={() => setActiveTab('recipes')}
                    className={`tab-pill min-h-[44px] ${activeTab === 'recipes' ? 'tab-pill-active' : ''}`}
                >
                    📝 Мои рецепты
                </button>
                <button
                    type="button"
                    onClick={() => setActiveTab('carts')}
                    className={`tab-pill min-h-[44px] ${activeTab === 'carts' ? 'tab-pill-active' : ''}`}
                >
                    🧺 Мои наборы
                </button>
                <button
                    type="button"
                    onClick={() => setActiveTab('favorites')}
                    className={`tab-pill min-h-[44px] ${activeTab === 'favorites' ? 'tab-pill-active' : ''}`}
                >
                    ⭐ Избранное
                </button>
                <button
                    type="button"
                    onClick={() => {
                        setActiveTab('settings');
                        setEditing(false);
                        setError('');
                        setSuccess('');
                        setFormData({
                            username: profile.username || '',
                            bio: profile.bio || '',
                            city: profile.city || '',
                            website: profile.website || ''
                        });
                    }}
                    className={`tab-pill min-h-[44px] ${activeTab === 'settings' ? 'tab-pill-active' : ''}`}
                >
                    ⚙️ Настройки
                </button>
            </div>

            {/* Контент вкладок */}
            <div className="mt-5">
                {renderTabContent()}
            </div>
        </div>
    );
}

export default ProfilePage;
