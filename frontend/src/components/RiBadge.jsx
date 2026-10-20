import React from 'react';

/* Компактный бейдж Индекса Recartly (0–100).
   Цвет по значению: ≥70 — высокий, ≥45 — средний, иначе — низкий.
   Без значения бейдж не показывается (если не передан showEmpty). */

const SIZE_CLASSES = {
    sm: 'text-[11px] px-1.5 py-0.5',
    md: '',
    lg: 'text-sm px-2.5 py-1.5',
};

export function riTone(value) {
    if (value >= 70) return 'ri-high';
    if (value >= 45) return 'ri-mid';
    return 'ri-low';
}

function RiBadge({ value, size = 'md', showEmpty = false, className = '', title }) {
    const numeric = value === null || value === undefined ? NaN : Number(value);
    const hasValue = Number.isFinite(numeric);

    if (!hasValue && !showEmpty) return null;

    const tone = hasValue ? riTone(numeric) : 'ri-low';
    const sizeClass = SIZE_CLASSES[size] || '';
    const label = hasValue
        ? (title || `Индекс Recartly: ${Math.round(numeric)} из 100`)
        : 'Индекс Recartly пока не рассчитан';

    return (
        <span
            className={`ri-badge ${tone} ${sizeClass} ${className}`.trim()}
            title={label}
        >
            <span className="text-[10px] font-black uppercase tracking-wide opacity-75" aria-hidden="true">RI</span>
            <span className="sr-only">Индекс Recartly</span>
            <span>{hasValue ? Math.round(numeric) : '—'}</span>
        </span>
    );
}

export default RiBadge;
