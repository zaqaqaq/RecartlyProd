import React from 'react';

/* Скелетон в форме карточки ленты: картинка слева, текст справа */
function SkeletonCard({ type = 'recipe' }) {
    return (
        <div className="card p-3 sm:p-4 animate-pulse">
            <div className="flex gap-3 sm:gap-4">
                <div className="w-24 h-24 xs:w-28 xs:h-28 sm:w-36 sm:h-36 rounded-2xl bg-ink-200/80 dark:bg-ink-800 flex-shrink-0" />

                <div className="flex-1 min-w-0 space-y-3">
                    <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-ink-200/80 dark:bg-ink-800" />
                        <div className="h-3 rounded-full bg-ink-200/80 dark:bg-ink-800 w-24" />
                    </div>

                    <div className="space-y-2">
                        <div className="h-4 rounded-full bg-ink-200/80 dark:bg-ink-800 w-full" />
                        <div className="h-4 rounded-full bg-ink-200/80 dark:bg-ink-800 w-3/4" />
                    </div>

                    <div className="hidden xs:block space-y-2">
                        <div className="h-3 rounded-full bg-ink-200/80 dark:bg-ink-800 w-full" />
                        <div className="h-3 rounded-full bg-ink-200/80 dark:bg-ink-800 w-2/3" />
                    </div>

                    <div className="flex items-center justify-between pt-1">
                        <div className="h-6 rounded-full bg-ink-200/80 dark:bg-ink-800 w-20" />
                        <div className="h-6 rounded-full bg-ink-200/80 dark:bg-ink-800 w-14" />
                    </div>
                </div>
            </div>

            <div className="flex items-center justify-between mt-3 pt-3 border-t border-ink-100 dark:border-ink-800">
                <div className="h-5 rounded-full bg-ink-200/80 dark:bg-ink-800 w-16" />
                <div className="h-5 rounded-full bg-ink-200/80 dark:bg-ink-800 w-24" />
            </div>

            {type === 'cart' && <span className="sr-only">Загрузка корзины</span>}
        </div>
    );
}

export default SkeletonCard;
