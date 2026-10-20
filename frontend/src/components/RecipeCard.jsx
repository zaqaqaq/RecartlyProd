import React, { useState } from 'react';
import { Link } from 'react-router-dom';

function RecipeCard({ recipe }) {
    const [avatarError, setAvatarError] = useState(false);
    const initial = recipe.username ? recipe.username[0].toUpperCase() : '?';

    /* h-full — карточка заполняет высоту ряда сетки, поэтому все карточки
       в ряду одной высоты. */
    return (
        <article className="card card-hover overflow-hidden flex flex-col h-full">
            <div className="p-4 sm:p-5 flex flex-col flex-1 min-w-0">
                {/* 1. Служебная строка: автор, «недавно» и цена. Высота строки
                    зафиксирована по аватару (40px), чтобы заголовки у всех
                    карточек ряда начинались на одной линии. */}
                <div className="min-h-[40px] flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                        {avatarError || !recipe.user_id ? (
                            <span className="avatar w-10 h-10 text-sm">{initial}</span>
                        ) : (
                            <img
                                src={`https://i.pravatar.cc/150?img=${recipe.user_id}`}
                                alt={recipe.username}
                                loading="lazy"
                                className="avatar w-10 h-10 object-cover"
                                onError={() => setAvatarError(true)}
                            />
                        )}
                        <div className="min-w-0">
                            <p className="font-semibold text-sm text-ink-900 dark:text-white truncate">
                                {recipe.username || 'Пользователь'}
                            </p>
                            <p className="text-xs text-ink-400 dark:text-ink-500 truncate">недавно</p>
                        </div>
                    </div>

                    {recipe.total_price && (
                        <span className="price text-base sm:text-lg whitespace-nowrap flex-shrink-0">
                            {recipe.total_price}
                            <span className="text-xs sm:text-sm"> ₽</span>
                        </span>
                    )}
                </div>

                {/* 2. Заголовок: ровно 2 строки по высоте. leading-[1.3] × 2 = 2.6em,
                    поэтому min-h-[2.6em] равен двум строкам точно (размер шрифта
                    адаптивный, а em-высота едет за ним). */}
                <Link to={`/recipe/${recipe.id}`} className="block mt-3 min-w-0">
                    <h2 className="font-display font-extrabold text-base sm:text-xl leading-[1.3] text-ink-900 dark:text-white hover:text-primary-600 dark:hover:text-primary-400 transition-colors line-clamp-2 min-h-[2.6em]">
                        {recipe.title}
                    </h2>
                </Link>

                {/* 3. Описание: тоже ровно 2 строки (min-h-[2.4em] = 2 × leading-[1.2]).
                    Блок рендерится всегда, чтобы рецепт без описания не «прыгал» вверх. */}
                <p className="mt-1 text-xs leading-[1.2] text-ink-500 dark:text-ink-400 line-clamp-2 min-h-[2.4em]">
                    {recipe.description || ''}
                </p>

                {/* 4. Футер прижат к низу (mt-auto): метрики и переход всегда
                    на одной высоте, тач-таргет перехода — 44px. */}
                <div className="mt-auto pt-3 min-h-[44px] flex items-center justify-between gap-2 border-t border-ink-100 dark:border-ink-800">
                    <div className="flex items-center gap-3 text-sm font-semibold text-ink-500 dark:text-ink-400">
                        <span className="inline-flex items-center gap-1">
                            <span aria-hidden="true">❤️</span>
                            <span className="tabular-nums">{recipe.likes_count || 0}</span>
                        </span>
                        <span className="inline-flex items-center gap-1">
                            <span aria-hidden="true">💬</span>
                            <span className="tabular-nums">{recipe.comments_count || 0}</span>
                        </span>
                    </div>
                    <Link
                        to={`/recipe/${recipe.id}`}
                        className="inline-flex items-center min-h-[44px] px-2.5 rounded-xl text-sm font-bold text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
                    >
                        Подробнее →
                    </Link>
                </div>
            </div>
        </article>
    );
}

export default RecipeCard;
