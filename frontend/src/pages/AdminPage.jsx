import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    getAdminWhoami,
    getAdminStats,
    getModerationQueue,
    approveModerationTask,
    rejectModerationTask,
    needsChangesModerationTask,
    getAdminReports,
    resolveAdminReport,
    getAdminAudit,
} from '../services/api';
import { mediaUrl } from '../utils/media';

/* ============================================================
   Модерация — мобильная админка в стиле «Сметы».
   Очередь задач, жалобы и журнал действий. Роли: moderator/admin.
   ============================================================ */

const TABS = [
    { key: 'queue', label: 'Очередь', emoji: '🧾' },
    { key: 'reports', label: 'Жалобы', emoji: '🚩' },
    { key: 'audit', label: 'Журнал', emoji: '📜' },
];

/* Причины отклонения — те же коды, что понимает backend. */
const REJECT_REASONS = [
    { code: 'spam', label: 'Спам или реклама' },
    { code: 'forbidden', label: 'Запрещённый контент' },
    { code: 'fake_price', label: 'Недостоверная цена' },
    { code: 'duplicate', label: 'Дубликат' },
    { code: 'copyright', label: 'Авторские права' },
    { code: 'abuse', label: 'Оскорбления' },
    { code: 'other', label: 'Другое' },
];

/* Автофлаги: какие считаем «опасными» и красим в коралл. */
const DANGEROUS_FLAGS = ['link', 'phone', 'messenger', 'spam', 'profanity'];

const FLAG_LABELS = {
    link: '🔗 ссылка',
    phone: '📞 телефон',
    messenger: '💬 мессенджер',
    spam: '📣 спам',
    profanity: '🤬 мат',
    short_text: '✏️ короткий текст',
    no_photo: '🖼 без фото',
};

const STATUS_LABELS = {
    pending: 'В очереди',
    approved: 'Одобрено',
    rejected: 'Отклонено',
    needs_changes: 'На доработке',
    open: 'Открыта',
    resolved: 'Решена',
};

const ACTION_LABELS = {
    approve: 'Одобрение',
    reject: 'Отклонение',
    needs_changes: 'На доработку',
    report_resolve: 'Обработка жалобы',
    sanction_warning: 'Предупреждение',
    sanction_mute: 'Мут',
    sanction_ban: 'Бан',
    sanction_shadowban: 'Теневой бан',
};

const statusClass = (status) => {
    if (status === 'approved' || status === 'resolved') {
        return 'bg-primary-50 text-primary-700 dark:bg-primary-500/15 dark:text-primary-300';
    }
    if (status === 'rejected') {
        return 'bg-hot-50 text-hot-600 dark:bg-hot-600/15 dark:text-hot-400';
    }
    if (status === 'needs_changes') {
        return 'bg-secondary-50 text-secondary-600 dark:bg-secondary-500/15 dark:text-secondary-300';
    }
    return 'bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-400';
};

const formatDate = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
};

const previewTitle = (task) => {
    const preview = task.preview || {};
    if (preview.title) return preview.title;
    if (preview.product) return preview.product;
    return `${task.target_type_label || task.target_type} #${task.target_id}`;
};

const previewSubtitle = (task) => {
    const preview = task.preview || {};
    if (task.target_type === 'price') {
        const parts = [];
        if (preview.product) parts.push(preview.product);
        if (preview.shop) parts.push(preview.shop);
        if (preview.price !== null && preview.price !== undefined) {
            parts.push(`${preview.price} ₽`);
        }
        return parts.join(' · ');
    }
    if (task.target_type === 'cart') {
        const parts = [];
        if (preview.shop) parts.push(preview.shop);
        if (preview.price !== null && preview.price !== undefined) parts.push(`${preview.price} ₽`);
        return parts.join(' · ');
    }
    return preview.description || '';
};

function AdminPage() {
    const [activeTab, setActiveTab] = useState('queue');
    const [role, setRole] = useState(localStorage.getItem('role') || null);
    const [accessChecked, setAccessChecked] = useState(false);
    const [stats, setStats] = useState(null);
    const [queue, setQueue] = useState([]);
    const [reports, setReports] = useState([]);
    const [audit, setAudit] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [busyId, setBusyId] = useState(null);
    const [expandedId, setExpandedId] = useState(null);
    const [rejectFormId, setRejectFormId] = useState(null);
    const [rejectReason, setRejectReason] = useState('spam');
    const [rejectComment, setRejectComment] = useState('');
    const [reportFormId, setReportFormId] = useState(null);
    const [reportResolution, setReportResolution] = useState('');

    const isModerator = role === 'moderator' || role === 'admin';

    const loadStats = useCallback(async () => {
        try {
            const data = await getAdminStats();
            setStats(data);
        } catch (err) {
            console.error('Ошибка метрик модерации:', err);
        }
    }, []);

    const loadTab = useCallback(async (tab) => {
        if (tab === 'queue') {
            const data = await getModerationQueue('pending', null, 30, 0);
            setQueue(data?.items || []);
            return;
        }
        if (tab === 'reports') {
            const data = await getAdminReports('open', 50, 0);
            setReports(data?.items || []);
            return;
        }
        const data = await getAdminAudit(50, 0);
        setAudit(data?.items || []);
    }, []);

    const refresh = useCallback(async (tab = activeTab) => {
        setLoading(true);
        setError('');
        try {
            await Promise.all([loadStats(), loadTab(tab)]);
        } catch (err) {
            setError(err.message || 'Не удалось загрузить данные модерации');
        } finally {
            setLoading(false);
        }
    }, [activeTab, loadStats, loadTab]);

    /* Проверяем роль на сервере: localStorage можно подделать. */
    useEffect(() => {
        let alive = true;

        const checkAccess = async () => {
            if (!localStorage.getItem('access_token')) {
                if (alive) {
                    setRole(localStorage.getItem('role') || 'guest');
                    setAccessChecked(true);
                    setLoading(false);
                }
                return;
            }
            try {
                const me = await getAdminWhoami();
                if (!alive) return;
                setRole(me.role);
                if (me.role) {
                    localStorage.setItem('role', me.role);
                }
            } catch (err) {
                if (!alive) return;
                setRole(localStorage.getItem('role') || 'guest');
            } finally {
                if (alive) setAccessChecked(true);
            }
        };

        checkAccess();
        return () => { alive = false; };
    }, []);

    useEffect(() => {
        if (!accessChecked || !isModerator) {
            setLoading(false);
            return;
        }
        refresh(activeTab);
    }, [accessChecked, isModerator, activeTab]);

    const dropTask = (taskId) => {
        setQueue(prev => prev.filter(task => task.id !== taskId));
        setExpandedId(null);
        setRejectFormId(null);
        loadStats();
    };

    const handleApprove = async (task) => {
        setBusyId(task.id);
        setError('');
        try {
            await approveModerationTask(task.id);
            dropTask(task.id);
        } catch (err) {
            setError(err.message || 'Не удалось одобрить задачу');
        } finally {
            setBusyId(null);
        }
    };

    const handleReject = async (task) => {
        setBusyId(task.id);
        setError('');
        try {
            await rejectModerationTask(task.id, rejectReason, rejectComment.trim() || null);
            dropTask(task.id);
            setRejectComment('');
            setRejectReason('spam');
        } catch (err) {
            setError(err.message || 'Не удалось отклонить задачу');
        } finally {
            setBusyId(null);
        }
    };

    const handleNeedsChanges = async (task) => {
        const comment = window.prompt('Что нужно доработать автору?', '');
        if (comment === null) return;

        setBusyId(task.id);
        setError('');
        try {
            await needsChangesModerationTask(task.id, comment.trim() || null);
            dropTask(task.id);
        } catch (err) {
            setError(err.message || 'Не удалось отправить на доработку');
        } finally {
            setBusyId(null);
        }
    };

    const handleResolveReport = async (report, status) => {
        setBusyId(`report-${report.id}`);
        setError('');
        try {
            await resolveAdminReport(
                report.id,
                reportResolution.trim() || (status === 'rejected' ? 'Нарушений не найдено' : 'Обработано'),
                status,
            );
            setReports(prev => prev.filter(item => item.id !== report.id));
            setReportFormId(null);
            setReportResolution('');
            loadStats();
        } catch (err) {
            setError(err.message || 'Не удалось обработать жалобу');
        } finally {
            setBusyId(null);
        }
    };

    /* ---------- Экран «нет доступа» ---------- */
    if (accessChecked && !isModerator) {
        return (
            <div className="max-w-3xl mx-auto animate-fade-in">
                <div className="card p-8 text-center">
                    <div className="w-14 h-14 mx-auto rounded-3xl bg-ink-100 dark:bg-ink-800 flex items-center justify-center text-2xl mb-3">
                        🛡️
                    </div>
                    <h1 className="heading-3">Доступ только для модераторов</h1>
                    <p className="text-ink-500 dark:text-ink-400 mt-2 text-sm">
                        Раздел доступен пользователям с ролью «модератор» или «администратор».
                    </p>
                    <Link to="/" className="btn-primary btn-block sm:w-auto sm:inline-flex mt-5">
                        На главную
                    </Link>
                </div>
            </div>
        );
    }

    const metrics = [
        { key: 'queue', label: 'В очереди', value: stats?.queue ?? 0, tone: 'text-secondary-600 dark:text-secondary-300' },
        { key: 'approved', label: 'Одобрено 24ч', value: stats?.approved_24h ?? 0, tone: 'text-primary-600 dark:text-primary-400' },
        { key: 'rejected', label: 'Отклонено 24ч', value: stats?.rejected_24h ?? 0, tone: 'text-hot-600 dark:text-hot-400' },
        { key: 'minutes', label: 'Ср. время, мин', value: stats?.avg_moderation_minutes ?? 0, tone: 'text-ink-700 dark:text-ink-200' },
        { key: 'reports', label: 'Жалоб открыто', value: stats?.open_reports ?? 0, tone: 'text-secondary-600 dark:text-secondary-300' },
    ];

    return (
        <div className="max-w-4xl mx-auto pb-bottom-nav animate-fade-in">
            <header className="flex items-start justify-between gap-3 mb-4">
                <div>
                    <h1 className="heading-2">Модерация</h1>
                    <p className="text-sm text-ink-500 dark:text-ink-400 mt-1">
                        Очередь проверок, жалобы и журнал действий
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => refresh(activeTab)}
                    disabled={loading}
                    className="btn-ghost !min-h-[44px]"
                    aria-label="Обновить данные"
                >
                    🔄
                </button>
            </header>

            {/* Метрики */}
            <section className="card p-4 sm:p-5 mb-4">
                {loading && !stats ? (
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                        {[1, 2, 3, 4, 5].map(i => (
                            <div key={i} className="space-y-2">
                                <div className="skeleton h-5 w-12" />
                                <div className="skeleton h-3 w-16" />
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                        {metrics.map((metric) => (
                            <div className="metric" key={metric.key}>
                                <span className={`metric-value ${metric.tone}`}>{metric.value}</span>
                                <span className="metric-label">{metric.label}</span>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {/* Табы */}
            <div className="hscroll mb-4 -mx-3 px-3 sm:mx-0 sm:px-0">
                {TABS.map((tab) => (
                    <button
                        key={tab.key}
                        type="button"
                        onClick={() => setActiveTab(tab.key)}
                        className={`tab-pill ${activeTab === tab.key ? 'tab-pill-active' : ''}`}
                    >
                        <span>{tab.emoji}</span>
                        {tab.label}
                    </button>
                ))}
            </div>

            {error && (
                <div className="card p-3 mb-4 border-hot-200 dark:border-hot-700/40 bg-hot-50 dark:bg-hot-600/10">
                    <p className="text-sm font-semibold text-hot-600 dark:text-hot-400" role="alert">
                        ⚠️ {error}
                    </p>
                </div>
            )}

            {loading ? (
                <div className="space-y-3">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="card p-4 space-y-3">
                            <div className="skeleton h-4 w-1/3" />
                            <div className="skeleton h-16 w-full" />
                            <div className="skeleton h-11 w-40" />
                        </div>
                    ))}
                </div>
            ) : (
                <>
                    {activeTab === 'queue' && (
                        <QueueTab
                            queue={queue}
                            busyId={busyId}
                            expandedId={expandedId}
                            onToggle={setExpandedId}
                            onApprove={handleApprove}
                            onNeedsChanges={handleNeedsChanges}
                            rejectFormId={rejectFormId}
                            setRejectFormId={setRejectFormId}
                            rejectReason={rejectReason}
                            setRejectReason={setRejectReason}
                            rejectComment={rejectComment}
                            setRejectComment={setRejectComment}
                            onReject={handleReject}
                        />
                    )}

                    {activeTab === 'reports' && (
                        <ReportsTab
                            reports={reports}
                            busyId={busyId}
                            formId={reportFormId}
                            setFormId={setReportFormId}
                            resolution={reportResolution}
                            setResolution={setReportResolution}
                            onResolve={handleResolveReport}
                        />
                    )}

                    {activeTab === 'audit' && <AuditTab entries={audit} />}
                </>
            )}
        </div>
    );
}

/* ===== Очередь модерации ===== */
function QueueTab({
    queue, busyId, expandedId, onToggle,
    onApprove, onNeedsChanges, onReject,
    rejectFormId, setRejectFormId, rejectReason, setRejectReason, rejectComment, setRejectComment,
}) {
    if (queue.length === 0) {
        return (
            <div className="card p-8 text-center">
                <div className="w-14 h-14 mx-auto rounded-3xl bg-primary-100 dark:bg-primary-900/25 flex items-center justify-center text-2xl mb-3">
                    ✅
                </div>
                <p className="font-semibold text-ink-800 dark:text-ink-100">Очередь пуста</p>
                <p className="text-sm text-ink-500 dark:text-ink-400 mt-1">
                    Все публикации проверены. Загляните позже.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {queue.map((task, index) => {
                const isBusy = busyId === task.id;
                const expanded = expandedId === task.id;
                const preview = task.preview || {};
                const flags = task.auto_flags || [];
                const photo = preview.photo_url ? mediaUrl(preview.photo_url) : null;

                return (
                    <article
                        key={task.id}
                        className="card p-3 sm:p-4 animate-fade-in-up"
                        style={{ animationDelay: `${Math.min(index, 6) * 45}ms` }}
                    >
                        <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                                <span className="tag">{task.target_type_label || task.target_type}</span>
                                <span className="text-xs text-ink-400 dark:text-ink-500 whitespace-nowrap">
                                    #{task.target_id} · {formatDate(task.created_at)}
                                </span>
                            </div>
                            <span className={`tag ${statusClass(task.status)}`}>
                                {STATUS_LABELS[task.status] || task.status}
                            </span>
                        </div>

                        <div className="flex gap-3 mt-3">
                            {photo && (
                                <img
                                    src={photo}
                                    alt={previewTitle(task)}
                                    loading="lazy"
                                    className="w-20 h-20 rounded-2xl object-cover flex-shrink-0 bg-ink-100 dark:bg-ink-800"
                                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                />
                            )}
                            <div className="min-w-0 flex-1">
                                <h2 className="font-bold text-[15px] sm:text-lg text-ink-900 dark:text-white line-clamp-2">
                                    {previewTitle(task)}
                                </h2>
                                {previewSubtitle(task) && (
                                    <p className={`text-sm text-ink-500 dark:text-ink-400 mt-1 ${expanded ? '' : 'line-clamp-2'}`}>
                                        {previewSubtitle(task)}
                                    </p>
                                )}
                                <div className="flex flex-wrap items-center gap-2 mt-2">
                                    {preview.username && (
                                        <span className="text-xs font-semibold text-ink-600 dark:text-ink-300">
                                            👤 {preview.username}
                                        </span>
                                    )}
                                    {typeof preview.rating === 'number' && (
                                        <span className="tag">⭐ {preview.rating}</span>
                                    )}
                                    {task.author_id && !preview.username && (
                                        <span className="text-xs text-ink-400">автор #{task.author_id}</span>
                                    )}
                                </div>
                            </div>
                        </div>

                        {flags.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-3">
                                {flags.map((flag) => (
                                    <span
                                        key={flag}
                                        className={`tag ${DANGEROUS_FLAGS.includes(flag)
                                            ? 'bg-hot-50 text-hot-600 dark:bg-hot-600/15 dark:text-hot-400'
                                            : ''}`}
                                    >
                                        {FLAG_LABELS[flag] || flag}
                                    </span>
                                ))}
                            </div>
                        )}

                        {task.moderator_comment && (
                            <p className="text-xs text-ink-500 dark:text-ink-400 mt-2">
                                Комментарий: {task.moderator_comment}
                            </p>
                        )}

                        <button
                            type="button"
                            onClick={() => onToggle(expanded ? null : task.id)}
                            className="btn-ghost !min-h-[44px] mt-1 -ml-1"
                            aria-expanded={expanded}
                        >
                            {expanded ? '▲ Свернуть' : '▼ Подробнее'}
                        </button>

                        {expanded && (
                            <dl className="mt-1 space-y-1 text-sm">
                                <div className="receipt-row">
                                    <dt className="text-ink-500 dark:text-ink-400">Автор</dt>
                                    <span className="receipt-row-lead" />
                                    <dd className="font-semibold text-ink-800 dark:text-ink-100">
                                        {preview.username || `#${task.author_id ?? '—'}`}
                                    </dd>
                                </div>
                                <div className="receipt-row">
                                    <dt className="text-ink-500 dark:text-ink-400">Тип объекта</dt>
                                    <span className="receipt-row-lead" />
                                    <dd className="font-semibold text-ink-800 dark:text-ink-100">
                                        {task.target_type_label || task.target_type}
                                    </dd>
                                </div>
                                <div className="receipt-row">
                                    <dt className="text-ink-500 dark:text-ink-400">Создана</dt>
                                    <span className="receipt-row-lead" />
                                    <dd className="font-semibold text-ink-800 dark:text-ink-100">
                                        {formatDate(task.created_at)}
                                    </dd>
                                </div>
                                {task.reason_label && (
                                    <div className="receipt-row">
                                        <dt className="text-ink-500 dark:text-ink-400">Причина</dt>
                                        <span className="receipt-row-lead" />
                                        <dd className="font-semibold text-ink-800 dark:text-ink-100">{task.reason_label}</dd>
                                    </div>
                                )}
                            </dl>
                        )}

                        {rejectFormId === task.id ? (
                            <div className="mt-3 p-3 rounded-2xl bg-ink-100/70 dark:bg-ink-800/60">
                                <label className="label" htmlFor={`reason-${task.id}`}>Причина отклонения</label>
                                <select
                                    id={`reason-${task.id}`}
                                    className="input"
                                    value={rejectReason}
                                    onChange={(e) => setRejectReason(e.target.value)}
                                >
                                    {REJECT_REASONS.map((reason) => (
                                        <option key={reason.code} value={reason.code}>{reason.label}</option>
                                    ))}
                                </select>
                                <label className="label mt-3" htmlFor={`comment-${task.id}`}>Комментарий (необязательно)</label>
                                <textarea
                                    id={`comment-${task.id}`}
                                    className="input min-h-[88px]"
                                    rows={3}
                                    value={rejectComment}
                                    onChange={(e) => setRejectComment(e.target.value)}
                                    placeholder="Что именно нарушено"
                                />
                                <div className="flex flex-wrap gap-2 mt-3">
                                    <button
                                        type="button"
                                        onClick={() => onReject(task)}
                                        disabled={isBusy}
                                        className="btn-danger"
                                    >
                                        {isBusy ? 'Отклоняем…' : 'Подтвердить отклонение'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setRejectFormId(null)}
                                        className="btn-secondary"
                                    >
                                        Отмена
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-wrap gap-2 mt-3">
                                <button
                                    type="button"
                                    onClick={() => onApprove(task)}
                                    disabled={isBusy}
                                    className="btn-primary flex-1 sm:flex-none"
                                >
                                    {isBusy ? '…' : '✅ Одобрить'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setRejectFormId(task.id);
                                        setRejectComment('');
                                    }}
                                    disabled={isBusy}
                                    className="btn-danger flex-1 sm:flex-none"
                                >
                                    ⛔ Отклонить
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onNeedsChanges(task)}
                                    disabled={isBusy}
                                    className="btn-secondary flex-1 sm:flex-none"
                                >
                                    ✏️ На доработку
                                </button>
                            </div>
                        )}
                    </article>
                );
            })}
        </div>
    );
}

/* ===== Жалобы ===== */
function ReportsTab({ reports, busyId, formId, setFormId, resolution, setResolution, onResolve }) {
    if (reports.length === 0) {
        return (
            <div className="card p-8 text-center">
                <div className="w-14 h-14 mx-auto rounded-3xl bg-primary-100 dark:bg-primary-900/25 flex items-center justify-center text-2xl mb-3">
                    🎉
                </div>
                <p className="font-semibold text-ink-800 dark:text-ink-100">Открытых жалоб нет</p>
                <p className="text-sm text-ink-500 dark:text-ink-400 mt-1">
                    Сообщество ведёт себя прилично.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {reports.map((report) => {
                const isBusy = busyId === `report-${report.id}`;
                const preview = report.preview || {};

                return (
                    <article key={report.id} className="card p-3 sm:p-4">
                        <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                                <span className="tag">{report.reason_label || report.reason_code}</span>
                                <span className="text-xs text-ink-400 dark:text-ink-500 whitespace-nowrap">
                                    {report.target_type_label || report.target_type} #{report.target_id}
                                </span>
                            </div>
                            <span className={`tag ${statusClass(report.status)}`}>
                                {STATUS_LABELS[report.status] || report.status}
                            </span>
                        </div>

                        <p className="font-semibold text-[15px] text-ink-900 dark:text-white mt-2 line-clamp-2">
                            {preview.title || `${report.target_type_label || report.target_type} #${report.target_id}`}
                        </p>

                        {report.comment && (
                            <p className="text-sm text-ink-500 dark:text-ink-400 mt-1 line-clamp-3">
                                «{report.comment}»
                            </p>
                        )}

                        <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-ink-400 dark:text-ink-500">
                            <span>👤 {report.reporter_username || 'аноним'}</span>
                            <span>· {formatDate(report.created_at)}</span>
                        </div>

                        {formId === report.id ? (
                            <div className="mt-3 p-3 rounded-2xl bg-ink-100/70 dark:bg-ink-800/60">
                                <label className="label" htmlFor={`resolution-${report.id}`}>Резолюция</label>
                                <textarea
                                    id={`resolution-${report.id}`}
                                    className="input min-h-[80px]"
                                    rows={3}
                                    value={resolution}
                                    onChange={(e) => setResolution(e.target.value)}
                                    placeholder="Что решили по жалобе"
                                />
                                <div className="flex flex-wrap gap-2 mt-3">
                                    <button
                                        type="button"
                                        onClick={() => onResolve(report, 'resolved')}
                                        disabled={isBusy}
                                        className="btn-primary"
                                    >
                                        {isBusy ? '…' : 'Нарушение подтверждено'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => onResolve(report, 'rejected')}
                                        disabled={isBusy}
                                        className="btn-secondary"
                                    >
                                        Нарушений нет
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setFormId(null)}
                                        className="btn-ghost !min-h-[44px]"
                                    >
                                        Отмена
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <button
                                type="button"
                                onClick={() => {
                                    setFormId(report.id);
                                    setResolution('');
                                }}
                                className="btn-primary mt-3"
                            >
                                🧾 Решить
                            </button>
                        )}
                    </article>
                );
            })}
        </div>
    );
}

/* ===== Журнал ===== */
function AuditTab({ entries }) {
    if (entries.length === 0) {
        return (
            <div className="card p-8 text-center">
                <div className="w-14 h-14 mx-auto rounded-3xl bg-ink-100 dark:bg-ink-800 flex items-center justify-center text-2xl mb-3">
                    📜
                </div>
                <p className="font-semibold text-ink-800 dark:text-ink-100">Журнал пуст</p>
                <p className="text-sm text-ink-500 dark:text-ink-400 mt-1">
                    Действия модераторов появятся здесь.
                </p>
            </div>
        );
    }

    return (
        <div className="card divide-y divide-ink-100 dark:divide-ink-800">
            {entries.map((entry) => (
                <div key={entry.id} className="flex items-start gap-3 p-3">
                    <span className="w-8 h-8 rounded-2xl bg-ink-100 dark:bg-ink-800 flex items-center justify-center text-sm flex-shrink-0">
                        {entry.action === 'approve' ? '✅' : entry.action === 'reject' ? '⛔' : '📝'}
                    </span>
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">
                            {ACTION_LABELS[entry.action] || entry.action}
                        </p>
                        <p className="text-xs text-ink-500 dark:text-ink-400 truncate">
                            {entry.actor_username || 'система'}
                            {entry.target_type ? ` · ${entry.target_type_label || entry.target_type}` : ''}
                            {entry.target_id ? ` #${entry.target_id}` : ''}
                        </p>
                    </div>
                    <span className="text-xs text-ink-400 dark:text-ink-500 whitespace-nowrap tabular-nums">
                        {formatDate(entry.created_at)}
                    </span>
                </div>
            ))}
        </div>
    );
}

export default AdminPage;
