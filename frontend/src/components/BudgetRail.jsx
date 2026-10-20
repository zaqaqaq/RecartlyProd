import React from 'react';

/**
 * Бюджет-рейка — главный индикатор «Сметы».
 * За секунду показывает, влезает ли корзина в бюджет и сколько осталось.
 */
function BudgetRail({
    budget,
    total = 0,
    size = 'md',
    showLabels = true,
    className = '',
}) {
    const safeBudget = Number(budget) || 0;
    const safeTotal = Number(total) || 0;
    const hasBudget = safeBudget > 0;

    const ratio = hasBudget ? safeTotal / safeBudget : 0;
    const percent = hasBudget ? Math.min(100, Math.max(0, ratio * 100)) : 0;
    const left = safeBudget - safeTotal;

    let state = 'ok';
    if (hasBudget) {
        if (ratio > 1) state = 'over';
        else if (ratio >= 0.8) state = 'warn';
    }

    const fillClass =
        state === 'over'
            ? 'budget-rail-fill-over'
            : state === 'warn'
              ? 'budget-rail-fill-warn'
              : 'budget-rail-fill-ok';

    const pillClass =
        state === 'over' ? 'budget-pill budget-over' : state === 'warn' ? 'budget-pill budget-warn' : 'budget-pill budget-ok';

    const heightClass = size === 'sm' ? 'h-1.5' : size === 'lg' ? 'h-3.5' : 'h-2.5';

    const money = (value) =>
        new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(value));

    return (
        <div className={className}>
            {showLabels && (
                <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-xs font-semibold text-ink-500 dark:text-ink-400 tabular">
                        {hasBudget ? `Бюджет ${money(safeBudget)} ₽` : 'Бюджет не задан'}
                    </span>
                    {hasBudget && (
                        <span className={pillClass}>
                            {state === 'over'
                                ? `перебор ${money(Math.abs(left))} ₽`
                                : `осталось ${money(left)} ₽`}
                        </span>
                    )}
                </div>
            )}

            <div className={`budget-rail ${heightClass}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}>
                <div className={`budget-rail-fill ${fillClass}`} style={{ width: `${percent}%` }} />
            </div>

            {showLabels && (
                <div className="flex items-center justify-between gap-2 mt-1.5">
                    <span className="text-xs text-ink-500 dark:text-ink-400 tabular">
                        Корзина {money(safeTotal)} ₽
                    </span>
                    {hasBudget && (
                        <span className="text-xs font-bold tabular text-ink-600 dark:text-ink-300">
                            {money(safeTotal)} / {money(safeBudget)} ₽
                        </span>
                    )}
                </div>
            )}
        </div>
    );
}

export default BudgetRail;
