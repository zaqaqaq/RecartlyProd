import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getRecipe, addFavorite, removeFavorite, getFavorites, getComments, createComment, deleteComment } from '../services/api';
import { mediaUrl } from '../utils/media';
import RiBadge from '../components/RiBadge';
import RatingWidget from '../components/RatingWidget';
import RecipeCostBlock from '../components/RecipeCostBlock';
import ReportButton from '../components/ReportButton';
import { RecipeTrustBadge } from '../components/TrustBadge';

function AvatarDisplay({ avatarUrl, username, size = "w-10 h-10 text-base" }) {
    const getInitials = () => {
        return username ? username[0].toUpperCase() : '?';
    };

    if (avatarUrl && avatarUrl.startsWith('emoji:')) {
        const parts = avatarUrl.split(':');
        const emoji = parts[1];
        const bg = parts[2] || 'bg-primary-100 dark:bg-primary-900/30';
        const textColor = parts[3] || 'text-primary-600 dark:text-primary-300';
        return (
            <div className={`avatar ${bg} ${textColor} flex items-center justify-center ${size}`}>
                {emoji}
            </div>
        );
    } else if (avatarUrl) {
        return (
            <img
                src={mediaUrl(avatarUrl)}
                alt={username}
                className={`rounded-full object-cover ${size}`}
            />
        );
    }
    return (
        <div className={`avatar flex items-center justify-center font-bold ${size}`}>
            {getInitials()}
        </div>
    );
}

/* «Температура» публикации больше не используется: у рецепта есть Индекс Recartly. */

function RecipePage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [recipe, setRecipe] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [comments, setComments] = useState([]);
    const [newComment, setNewComment] = useState('');
    const [commentLoading, setCommentLoading] = useState(false);
    const [isFavorited, setIsFavorited] = useState(false);
    const [favoritesCount, setFavoritesCount] = useState(0);
    const [imgError, setImgError] = useState(false);
    /* Битые ссылки на фото шагов и ингредиентов: вместо «сломанной» картинки
       показываем аккуратную заглушку. */
    const [failedPhotos, setFailedPhotos] = useState({});
    const markPhotoFailed = (key) => setFailedPhotos((prev) => (prev[key] ? prev : { ...prev, [key]: true }));
    // Ссылку на рецепт удобно скопировать и отправить — состояние «скопировано»
    const [linkCopied, setLinkCopied] = useState(false);

    const isAuthenticated = !!localStorage.getItem('access_token');
    const currentUserId = parseInt(localStorage.getItem('user_id'), 10) || null;

    useEffect(() => {
        loadRecipe();
        loadComments();
        loadFavoriteStatus();
    }, [id]);

    const loadRecipe = async () => {
        try {
            const data = await getRecipe(id);
            setRecipe(data);
            setFavoritesCount(data.favorites_count || 0);
        } catch (err) {
            setError('Рецепт не найден');
        } finally {
            setLoading(false);
        }
    };

    const loadComments = async () => {
        try {
            const data = await getComments(id);
            setComments(data || []);
        } catch (err) {
            console.error('Ошибка загрузки комментариев', err);
        }
    };

    const loadFavoriteStatus = async () => {
        if (!isAuthenticated) return;
        try {
            const favorites = await getFavorites();
            const isFav = favorites.some(fav => fav.id === parseInt(id));
            setIsFavorited(isFav);
        } catch (err) {
            console.error('Error loading favorite status:', err);
        }
    };

    /** Скопировать прямую ссылку на рецепт: её удобно отправить в мессенджер. */
    const handleCopyLink = async () => {
        const url = `${window.location.origin}/recipe/${id}`;
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(url);
            } else {
                // Резервный путь для http://localhost и старых браузеров
                const input = document.createElement('input');
                input.value = url;
                document.body.appendChild(input);
                input.select();
                document.execCommand('copy');
                document.body.removeChild(input);
            }
            setLinkCopied(true);
            window.setTimeout(() => setLinkCopied(false), 2000);
        } catch (err) {
            console.error('Не удалось скопировать ссылку:', err);
        }
    };

    const handleFavorite = async () => {
        if (!isAuthenticated) {
            navigate('/login');
            return;
        }
        try {
            if (isFavorited) {
                await removeFavorite(id);
                setIsFavorited(false);
                setFavoritesCount(prev => prev - 1);
            } else {
                await addFavorite(id);
                setIsFavorited(true);
                setFavoritesCount(prev => prev + 1);
            }
        } catch (err) {
            console.error('Ошибка', err);
        }
    };

    /* Удаления рецепта на странице нет: рецепты публикуются после модерации,
       поэтому автор своей кнопкой «Удалить» их не снимает. */

    const handleCommentSubmit = async (e) => {
        e.preventDefault();
        if (!newComment.trim()) return;

        setCommentLoading(true);
        try {
            await createComment(id, newComment);
            setNewComment('');
            loadComments();
        } catch (err) {
            alert('Ошибка отправки комментария');
        } finally {
            setCommentLoading(false);
        }
    };

    const handleDeleteComment = async (commentId) => {
        if (window.confirm('Удалить комментарий?')) {
            try {
                await deleteComment(commentId);
                loadComments();
            } catch (err) {
                alert('Ошибка удаления');
            }
        }
    };

    if (loading) return (
        <div className="min-h-[60vh] flex items-center justify-center animate-fade-in">
            <div className="text-center">
                <div className="w-14 h-14 mx-auto rounded-3xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-2xl mb-3 animate-pulse">
                    🍲
                </div>
                <p className="text-primary-600 dark:text-primary-400 text-lg font-bold">🍲 Загрузка...</p>
            </div>
        </div>
    );

    if (error) return (
        <div className="min-h-[60vh] flex items-center justify-center animate-fade-in">
            <div className="card p-8 text-center w-full sm:w-auto">
                <div className="text-5xl sm:text-6xl mb-4">😕</div>
                <p className="text-ink-600 dark:text-ink-400">{error}</p>
                <button onClick={() => navigate('/')} className="btn-primary btn-block sm:w-auto mt-4">
                    На главную
                </button>
            </div>
        </div>
    );

    if (!recipe) return null;

    const photoUrl = recipe.photo_url && !imgError
        ? mediaUrl(recipe.photo_url)
        : null;

    /* Шаги приходят с сервера упорядоченными по position; на всякий случай сортируем.
       Если шагов нет (старый рецепт) — разбираем текст instructions по строкам. */
    const steps = [...(recipe.steps || [])]
        .sort((a, b) => (a.position || 0) - (b.position || 0));

    const instructionLines = !steps.length && recipe.instructions
        ? recipe.instructions.split('\n').filter((line) => line.trim())
        : [];

    // Автор видит баннер статуса своей публикации (рецепт на модерации и т. п.)
    const isAuthor = Boolean(recipe && currentUserId && recipe.user_id === currentUserId);

    return (
        <div className="max-w-4xl mx-auto animate-fade-in">
            {/* Хлебные крошки */}
            <nav className="mb-3 text-sm text-ink-500 dark:text-ink-400 flex items-center gap-1 min-w-0" aria-label="Навигация">
                <button
                    onClick={() => navigate('/')}
                    className="hover:text-primary-600 dark:hover:text-primary-400 transition-colors font-medium"
                >
                    Главная
                </button>
                <span className="mx-1 text-ink-300 dark:text-ink-600">/</span>
                <span className="text-ink-700 dark:text-ink-300 truncate flex-1 min-w-0">{recipe.title}</span>
            </nav>

            {/* Статус для автора: рецепт новичка уходит на проверку и в ленте не виден,
                поэтому без такого баннера кажется, что публикация не сработала */}
            {isAuthor && recipe.status && recipe.status !== 'published' && (
                <div
                    className={`card p-3.5 mb-3 border ${
                        recipe.status === 'rejected'
                            ? 'border-hot-500/40 bg-hot-50/60 dark:bg-hot-600/10'
                            : 'border-secondary-400/50 bg-secondary-50/60 dark:bg-secondary-500/10'
                    }`}
                    role="status"
                >
                    <p className="font-bold text-ink-900 dark:text-ink-100">
                        {recipe.status === 'pending' && '⏳ Рецепт на проверке'}
                        {recipe.status === 'rejected' && '🚫 Рецепт отклонён модератором'}
                        {recipe.status === 'needs_changes' && '✏️ Рецепт нужно доработать'}
                        {recipe.status === 'draft' && '📝 Черновик'}
                    </p>
                    <p className="text-sm text-ink-600 dark:text-ink-300 mt-1">
                        {recipe.status === 'pending' &&
                            'Он появится в общей ленте и в поиске после одобрения — а вам уже доступен по этой ссылке.'}
                        {recipe.status === 'rejected' &&
                            (recipe.reject_reason || 'Причина не указана. Свяжитесь с модератором или исправьте замечания.')}
                        {recipe.status === 'needs_changes' &&
                            (recipe.reject_reason || 'Модератор просит доработать рецепт.')}
                    </p>
                </div>
            )}

            <article className="card overflow-hidden">
                {/* Фото блюда */}
                <div className="relative w-full h-56 xs:h-64 sm:h-80 md:h-96 bg-ink-100 dark:bg-ink-800">
                    {photoUrl ? (
                        <img
                            src={photoUrl}
                            alt={recipe.title}
                            className="w-full h-full object-cover"
                            onError={() => setImgError(true)}
                        />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-ink-300 dark:text-ink-600 text-5xl sm:text-6xl">
                            🍲
                        </div>
                    )}
                    <div className="absolute top-3 left-3 flex items-center gap-2">
                        <RiBadge value={recipe.ri_score} size="lg" className="shadow-sm" />
                    </div>
                </div>

                <div className="p-3.5 sm:p-6 md:p-8">
                    {/* Заголовок и действия автора */}
                    <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                        <h1 className="heading-2 flex-1 min-w-0 break-words">
                            {recipe.title}
                        </h1>
                        <RecipeTrustBadge recipe={recipe} size="md" />
                        {(!isAuthenticated || recipe.user_id !== parseInt(localStorage.getItem('user_id'))) && (
                            <ReportButton targetType="recipe" targetId={recipe.id} />
                        )}
                    </div>

                    {/* Автор и голос */}
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-5 pb-4 border-b border-ink-100 dark:border-ink-800">
                        <div className="flex items-center gap-3 min-w-0">
                            <AvatarDisplay
                                avatarUrl={recipe.avatar_url}
                                username={recipe.username}
                                size="w-10 h-10 text-base"
                            />
                            <div className="min-w-0">
                                <p className="font-semibold text-ink-900 dark:text-ink-100 truncate">{recipe.username || 'Пользователь'}</p>
                                <p className="text-xs text-ink-400 dark:text-ink-500">{recipe.time_ago || 'недавно'}</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <button
                                onClick={handleCopyLink}
                                aria-label="Скопировать ссылку на рецепт"
                                className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 rounded-2xl text-sm font-semibold transition-colors
                                text-ink-500 dark:text-ink-400 bg-ink-100 dark:bg-ink-800 hover:bg-ink-200 dark:hover:bg-ink-700"
                            >
                                <span className="text-base leading-none" aria-hidden="true">
                                    {linkCopied ? '✅' : '🔗'}
                                </span>
                                <span className="hidden xs:inline">{linkCopied ? 'Скопировано' : 'Ссылка'}</span>
                            </button>
                            <button
                                onClick={handleFavorite}
                                aria-label={isFavorited ? 'Убрать из избранного' : 'Добавить в избранное'}
                                aria-pressed={isFavorited}
                                className={`inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 rounded-2xl text-base font-bold transition-colors
                                ${isFavorited
                                        ? 'text-hot-600 bg-hot-50 ring-1 ring-hot-500/40 dark:bg-hot-500/20 dark:text-hot-400 dark:ring-hot-500/50'
                                        : 'text-ink-500 dark:text-ink-400 bg-ink-100 dark:bg-ink-800 hover:bg-ink-200 dark:hover:bg-ink-700'}`}
                            >
                                <span className="text-xl leading-none">{isFavorited ? '❤️' : '🤍'}</span>
                                <span className="tabular-nums">{favoritesCount}</span>
                            </button>
                        </div>
                    </div>

                    {/* Быстрые метрики */}
                    <div className="hscroll -mx-3.5 px-3.5 sm:mx-0 sm:px-0 mb-5">
                        <span className="tag">❤️ {favoritesCount} в избранном</span>
                        <span className="tag">💬 {comments.length} комментариев</span>
                        <RiBadge value={recipe.ri_score} />
                    </div>

                    {recipe.description && (
                        <div className="mb-6 rounded-2xl bg-primary-50 dark:bg-primary-900/15 border border-primary-100 dark:border-primary-900/40 p-3.5 sm:p-4">
                            <p className="text-ink-700 dark:text-ink-200 italic">📝 {recipe.description}</p>
                        </div>
                    )}

                    {/* Балльные оценки и Индекс Recartly */}
                    <RatingWidget recipeId={recipe.id} />

                    {/* Блюдо цены не имеет: показываем набор, из которого оно готовится */}
                    <div className="mb-6 sm:mb-8">
                        <RecipeCostBlock recipeId={recipe.id} basketId={recipe.basket_id || null} />
                    </div>

                    {/* Ингредиенты — на мобильных карточками, без горизонтального скролла.
                        Цен здесь нет: цена — свойство набора продуктов, а не блюда. */}
                    <section className="mb-6 sm:mb-8">
                        <h2 className="section-title mb-3">🛒 Ингредиенты</h2>
                        <div className="rounded-2xl bg-ink-50 dark:bg-ink-850 border border-ink-100 dark:border-ink-800 p-3 sm:p-4">
                            {recipe.ingredients?.map((ing, idx) => {
                                const photoKey = `ingredient-${ing.id ?? idx}`;
                                const ingPhoto = ing.photo_url && !failedPhotos[photoKey]
                                    ? mediaUrl(ing.photo_url)
                                    : null;

                                return (
                                    <div
                                        key={ing.id ?? idx}
                                        className="flex items-center justify-between gap-3 py-2.5 border-b last:border-0 border-ink-200 dark:border-ink-800"
                                    >
                                        <div className="flex items-center gap-2.5 min-w-0">
                                            {/* Миниатюра продукта — как он выглядит в магазине */}
                                            {ingPhoto ? (
                                                <img
                                                    src={ingPhoto}
                                                    alt={`Фото: ${ing.name}`}
                                                    loading="lazy"
                                                    onError={() => markPhotoFailed(photoKey)}
                                                    className="w-11 h-11 rounded-xl object-cover flex-shrink-0 border border-ink-200 dark:border-ink-700"
                                                />
                                            ) : (
                                                <span
                                                    aria-hidden="true"
                                                    className="w-11 h-11 rounded-xl flex-shrink-0 bg-ink-100 dark:bg-ink-800 text-ink-300 dark:text-ink-600 flex items-center justify-center text-base"
                                                >
                                                    🧺
                                                </span>
                                            )}
                                            <span className="text-ink-700 dark:text-ink-200 text-sm sm:text-base min-w-0 break-words">
                                                {ing.name}
                                            </span>
                                        </div>
                                        <span className="text-ink-500 dark:text-ink-400 text-sm sm:text-base whitespace-nowrap tabular-nums">
                                            {ing.quantity}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </section>

                    {/* Приготовление — шаги с фото; для старых рецептов текст instructions */}
                    <section className="mb-6 sm:mb-8">
                        <h2 className="section-title mb-3">👨‍🍳 Инструкция</h2>
                        <div className="rounded-2xl bg-ink-50 dark:bg-ink-850 border border-ink-100 dark:border-ink-800 p-3 sm:p-4 space-y-3">
                            {steps.length > 0 ? (
                                steps.map((step, idx) => {
                                    const photoKey = `step-${step.id ?? idx}`;
                                    const stepPhoto = step.photo_url && !failedPhotos[photoKey]
                                        ? mediaUrl(step.photo_url)
                                        : null;
                                    const stepText = step.text || '';

                                    return (
                                        <div
                                            key={step.id ?? idx}
                                            className="rounded-2xl bg-white dark:bg-ink-900 border border-ink-100 dark:border-ink-800 p-3 sm:p-3.5"
                                        >
                                            <div className="flex items-start gap-2.5">
                                                <span className="w-7 h-7 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 text-xs font-extrabold flex items-center justify-center flex-shrink-0 tabular-nums">
                                                    {idx + 1}
                                                </span>
                                                <p className="text-ink-700 dark:text-ink-200 text-sm sm:text-base min-w-0 break-words">
                                                    {stepText}
                                                </p>
                                            </div>

                                            {/* Фото шага: наглядно показывает, что должно получиться */}
                                            {stepPhoto && (
                                                <a
                                                    href={stepPhoto}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    title="Открыть фото в новой вкладке"
                                                    className="mt-3 ml-0 sm:ml-[38px] block overflow-hidden rounded-2xl border border-ink-100 dark:border-ink-800 bg-ink-100 dark:bg-ink-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                                                >
                                                    <img
                                                        src={stepPhoto}
                                                        alt={`Шаг ${idx + 1}`}
                                                        loading="lazy"
                                                        onError={() => markPhotoFailed(photoKey)}
                                                        className="w-full max-h-72 object-cover"
                                                    />
                                                </a>
                                            )}
                                        </div>
                                    );
                                })
                            ) : instructionLines.length > 0 ? (
                                /* Старые рецепты: шагов в базе ещё нет, показываем текст как раньше */
                                instructionLines.map((line, idx) => (
                                    <div key={idx} className="flex items-start gap-2.5">
                                        <span className="w-6 h-6 mt-0.5 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 text-xs font-extrabold flex items-center justify-center flex-shrink-0 tabular-nums">
                                            {idx + 1}
                                        </span>
                                        <p className="text-ink-700 dark:text-ink-200 text-sm sm:text-base min-w-0 break-words">
                                            {line.startsWith('1.') || line.startsWith('2.') ? line : `• ${line}`}
                                        </p>
                                    </div>
                                ))
                            ) : (
                                <p className="text-ink-500 dark:text-ink-400 text-sm">Автор пока не добавил шаги приготовления.</p>
                            )}
                        </div>
                    </section>

                    {/* Комментарии */}
                    <section>
                        <h2 className="section-title mb-3">💬 Комментарии ({comments.length})</h2>

                        {isAuthenticated ? (
                            <form onSubmit={handleCommentSubmit} className="mb-6">
                                <textarea
                                    value={newComment}
                                    onChange={(e) => setNewComment(e.target.value)}
                                    className="input resize-y"
                                    rows="3"
                                    placeholder="Напишите комментарий..."
                                    required
                                />
                                <button
                                    type="submit"
                                    disabled={commentLoading}
                                    className="btn-primary btn-block sm:w-auto mt-2.5"
                                >
                                    {commentLoading ? 'Отправка...' : 'Отправить'}
                                </button>
                            </form>
                        ) : (
                            <p className="text-ink-600 dark:text-ink-400 mb-6 bg-ink-50 dark:bg-ink-850 border border-ink-100 dark:border-ink-800 p-3.5 rounded-2xl text-center">
                                <a href="/login" className="text-primary-600 dark:text-primary-400 font-semibold hover:underline">Войдите</a>, чтобы оставить комментарий
                            </p>
                        )}

                        <div className="space-y-3">
                            {comments.length === 0 ? (
                                <p className="text-ink-500 dark:text-ink-400 text-center py-6">Пока нет комментариев. Будьте первым!</p>
                            ) : (
                                comments.map((comment) => (
                                    <div key={comment.id} className="card p-3.5 sm:p-4">
                                        <div className="flex flex-wrap justify-between items-start gap-2">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-2 min-w-0">
                                                    <AvatarDisplay
                                                        avatarUrl={comment.avatar_url}
                                                        username={comment.username}
                                                        size="w-6 h-6 text-xs"
                                                    />
                                                    <p className="font-semibold text-ink-900 dark:text-ink-100 text-sm truncate">
                                                        {comment.username || `Пользователь ${comment.user_id}`}
                                                    </p>
                                                    <p className="text-xs text-ink-400 dark:text-ink-500 whitespace-nowrap">
                                                        {new Date(comment.created_at).toLocaleString()}
                                                    </p>
                                                </div>
                                                <p className="text-ink-700 dark:text-ink-200 break-words">{comment.text}</p>
                                                <div className="flex items-center gap-4 mt-2">
                                                    <button className="inline-flex items-center min-h-[44px] text-xs font-semibold text-ink-400 dark:text-ink-500 hover:text-primary-600 dark:hover:text-primary-400 transition-colors">
                                                        👍 Ответить
                                                    </button>
                                                </div>
                                            </div>
                                            {isAuthenticated && comment.user_id === parseInt(localStorage.getItem('user_id')) && (
                                                <button
                                                    onClick={() => handleDeleteComment(comment.id)}
                                                    aria-label="Удалить комментарий"
                                                    className="inline-flex items-center justify-center min-h-[44px] px-2.5 rounded-xl text-hot-600 dark:text-hot-400 hover:bg-hot-50 dark:hover:bg-hot-600/10 text-sm font-semibold transition-colors"
                                                >
                                                    🗑 Удалить
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </section>
                </div>
            </article>
        </div>
    );
}

export default RecipePage;
