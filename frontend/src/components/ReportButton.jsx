import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createReport, getReportReasons } from '../services/smeta';

/**
 * Кнопка «Пожаловаться» с bottom-sheet выбором причины.
 * Нужна, чтобы очередь жалоб в админке было чем наполнить.
 */
function ReportButton({ targetType, targetId, className = '', compact = false }) {
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const [reasons, setReasons] = useState([]);
    const [reason, setReason] = useState('');
    const [comment, setComment] = useState('');
    const [sending, setSending] = useState(false);
    const [done, setDone] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!open || reasons.length) return;
        getReportReasons()
            .then((list) => setReasons(list || []))
            .catch(() => setReasons([]));
    }, [open, reasons.length]);

    // Блокируем прокрутку фона, пока открыт лист
    useEffect(() => {
        document.body.style.overflow = open ? 'hidden' : '';
        return () => {
            document.body.style.overflow = '';
        };
    }, [open]);

    const handleOpen = () => {
        if (!localStorage.getItem('access_token')) {
            navigate('/login');
            return;
        }
        setOpen(true);
    };

    const handleSubmit = async () => {
        if (!reason) {
            setError('Выберите причину');
            return;
        }
        setSending(true);
        setError('');
        try {
            await createReport({
                target_type: targetType,
                target_id: Number(targetId),
                reason_code: reason,
                comment: comment.trim() || null,
            });
            setDone(true);
        } catch (err) {
            setError(err.message || 'Не удалось отправить жалобу');
        } finally {
            setSending(false);
        }
    };

    return (
        <>
            <button
                type="button"
                onClick={handleOpen}
                className={
                    className ||
                    `inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-xl text-sm font-semibold
                    text-ink-500 dark:text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors`
                }
                aria-label="Пожаловаться на публикацию"
            >
                🚩{compact ? '' : ' Пожаловаться'}
            </button>

            {open && (
                <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true">
                    <div
                        className="absolute inset-0 bg-ink-950/50 backdrop-blur-sm animate-fade-in"
                        onClick={() => setOpen(false)}
                    />

                    <div className="absolute inset-x-0 bottom-0 bg-white dark:bg-ink-900 rounded-t-3xl shadow-2xl animate-sheet-up safe-bottom max-h-[85vh] overflow-y-auto">
                        <div className="w-10 h-1 rounded-full bg-ink-300 dark:bg-ink-700 mx-auto mt-3" />

                        <div className="px-5 pt-4 pb-6">
                            {done ? (
                                <div className="text-center py-4">
                                    <div className="text-4xl mb-2">✅</div>
                                    <h2 className="text-lg font-extrabold text-ink-900 dark:text-white">
                                        Жалоба отправлена
                                    </h2>
                                    <p className="text-sm text-ink-500 dark:text-ink-400 mt-1.5">
                                        Модераторы проверят публикацию. Статус можно посмотреть в уведомлениях.
                                    </p>
                                    <button
                                        type="button"
                                        onClick={() => setOpen(false)}
                                        className="btn-primary btn-block mt-4"
                                    >
                                        Понятно
                                    </button>
                                </div>
                            ) : (
                                <>
                                    <h2 className="text-lg font-extrabold text-ink-900 dark:text-white">
                                        На что жалуетесь?
                                    </h2>
                                    <p className="text-sm text-ink-500 dark:text-ink-400 mt-1">
                                        Жалоба анонимна для автора публикации.
                                    </p>

                                    <div className="mt-4 space-y-1.5">
                                        {reasons.map((item) => (
                                            <button
                                                key={item.code}
                                                type="button"
                                                onClick={() => setReason(item.code)}
                                                aria-pressed={reason === item.code}
                                                className={`w-full text-left min-h-[46px] px-3.5 rounded-2xl border transition-colors
                                                ${
                                                    reason === item.code
                                                        ? 'border-hot-400 bg-hot-50 dark:bg-hot-500/10'
                                                        : 'border-ink-200 dark:border-ink-800 hover:bg-ink-100 dark:hover:bg-ink-800'
                                                }`}
                                            >
                                                <span className="text-sm font-semibold text-ink-800 dark:text-ink-100">
                                                    {item.label}
                                                </span>
                                            </button>
                                        ))}
                                    </div>

                                    <label className="label mt-4" htmlFor="report-comment">
                                        Комментарий (необязательно)
                                    </label>
                                    <textarea
                                        id="report-comment"
                                        className="input min-h-[88px] resize-y"
                                        value={comment}
                                        onChange={(e) => setComment(e.target.value)}
                                        placeholder="Что не так с публикацией?"
                                        maxLength={1000}
                                    />

                                    {error && (
                                        <p className="text-sm text-hot-600 dark:text-hot-400 mt-2">{error}</p>
                                    )}

                                    <div className="flex flex-col-reverse xs:flex-row gap-2 mt-4">
                                        <button
                                            type="button"
                                            onClick={() => setOpen(false)}
                                            className="btn-secondary xs:w-40"
                                        >
                                            Отмена
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleSubmit}
                                            disabled={sending || !reason}
                                            className="btn-danger flex-1"
                                        >
                                            {sending ? 'Отправляем…' : 'Отправить жалобу'}
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

export default ReportButton;
