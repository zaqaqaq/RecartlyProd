/**
 * Взаимодействие с горизонтальными лентами (`.hscroll`).
 *
 * Проблема, которую это решает: на устройствах с мышью лента выглядела «мёртвой» —
 * скроллбар скрыт, колесо мыши прокручивает страницу, а не ленту, и потянуть её
 * курсором нельзя. На тач-устройствах браузер сам скроллит `overflow-x: auto`,
 * поэтому мышь и колесо — единственное, что нужно добавить.
 *
 * Обработчики делегированы на `document`, поэтому работают и для лент,
 * которые появляются позже (шторки, списки, ленты на витрине).
 */

const DRAG_THRESHOLD = 6;

const findRow = (target) =>
    target instanceof Element ? target.closest('.hscroll') : null;

const canScroll = (row) => row.scrollWidth > row.clientWidth + 1;

export function enableHScrollInteractions() {
    if (typeof document === 'undefined') return () => {};

    let drag = null;

    const onPointerDown = (event) => {
        // Тачскрин скроллит сам — не мешаем
        if (event.pointerType !== 'mouse' || event.button !== 0) return;

        const row = findRow(event.target);
        if (!row || !canScroll(row)) return;

        drag = {
            row,
            startX: event.clientX,
            startLeft: row.scrollLeft,
            moved: false,
        };
    };

    const onPointerMove = (event) => {
        if (!drag) return;

        const delta = event.clientX - drag.startX;
        if (!drag.moved && Math.abs(delta) < DRAG_THRESHOLD) return;

        if (!drag.moved) {
            drag.moved = true;
            drag.row.classList.add('hscroll-dragging');
        }

        drag.row.scrollLeft = drag.startLeft - delta;
        event.preventDefault();
    };

    const finishDrag = () => {
        if (!drag) return;

        const { row, moved } = drag;
        row.classList.remove('hscroll-dragging');
        drag = null;

        if (!moved) return;

        // После перетаскивания гасим случайный клик по чипу, который «уехал» под курсором
        const suppressClick = (event) => {
            event.preventDefault();
            event.stopPropagation();
        };
        document.addEventListener('click', suppressClick, true);
        window.setTimeout(
            () => document.removeEventListener('click', suppressClick, true),
            250
        );
    };

    const onWheel = (event) => {
        // Горизонтальный трекпад уже скроллит ленту сам
        if (event.deltaX !== 0 || event.deltaY === 0) return;

        const row = findRow(event.target);
        if (!row || !canScroll(row)) return;

        const atStart = row.scrollLeft <= 0;
        const atEnd = row.scrollLeft + row.clientWidth >= row.scrollWidth - 1;

        // На краях отдаём событие странице, чтобы вертикальный скролл не «залипал»
        if ((event.deltaY < 0 && atStart) || (event.deltaY > 0 && atEnd)) return;

        row.scrollLeft += event.deltaY;
        event.preventDefault();
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointermove', onPointerMove, { passive: false });
    document.addEventListener('pointerup', finishDrag);
    document.addEventListener('pointercancel', finishDrag);
    document.addEventListener('wheel', onWheel, { passive: false });

    return () => {
        document.removeEventListener('pointerdown', onPointerDown, true);
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', finishDrag);
        document.removeEventListener('pointercancel', finishDrag);
        document.removeEventListener('wheel', onWheel);
    };
}

export default enableHScrollInteractions;
