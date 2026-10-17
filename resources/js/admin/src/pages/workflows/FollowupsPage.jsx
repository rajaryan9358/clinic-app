import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useScope } from '../../context/ScopeContext';
import AppIcon from '../../components/AppIcon';
import Skeleton from '../../components/Skeleton';
import { formatDate } from '../../utils/dateFormat';

// The follow-up worklist: pending tasks grouped by urgency, with the action on
// the row. Grouping is computed here from `due_date`; the server only filters.

export const TASK_TYPE_LABELS = {
    call: 'Call',
    whatsapp: 'WhatsApp',
    review_request: 'Review request',
    followup_visit: 'Follow-up visit',
    lab_reminder: 'Lab reminder',
    custom: 'Custom',
};

const STATUS_OPTIONS = [
    { value: 'all', label: 'Open and recently closed' },
    { value: 'pending', label: 'Open only' },
    { value: 'done', label: 'Done' },
    { value: 'closed', label: 'Skipped or cancelled' },
];

// Roles that work their own queue by default; everyone else sees the clinic.
const OWN_QUEUE_ROLES = ['doctor'];

// Pending tasks are fetched in one request so no group is ever truncated.
const PENDING_LIMIT = 500;
const DONE_LIMIT = 20;
const CLOSED_LIMIT = 10; // per status (skipped, cancelled)

// How long a Done click can be taken back before it is sent to the server.
const UNDO_MS = 6000;

const EMPTY_DATA = { pending: [], pendingTotal: 0, done: [], doneTotal: 0, closed: [], closedTotal: 0 };

const STATUS_LABELS = { done: 'Done', skipped: 'Skipped', cancelled: 'Cancelled' };

const apiError = (e, fallback) => e?.response?.data?.message || e?.message || fallback;
const doctorLabel = (d) => [d?.title, d?.full_name || d?.name].filter(Boolean).join(' ').trim() || `Doctor #${d?.id}`;
const inputClass = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200';

const toYMD = (d) => {
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${month}-${day}`;
};

// Whole days from `today` to the task's due date (negative = overdue). Both are
// plain calendar dates, so compare them in UTC to be immune to DST shifts.
export function daysUntil(dueDate, todayYMD) {
    const [y1, m1, d1] = String(dueDate).slice(0, 10).split('-').map(Number);
    const [y2, m2, d2] = todayYMD.split('-').map(Number);
    return Math.round((Date.UTC(y1, m1 - 1, d1) - Date.UTC(y2, m2 - 1, d2)) / 86400000);
}

export function dueInWords(days) {
    if (days < 0) return `${-days} ${days === -1 ? 'day' : 'days'} overdue`;
    if (days === 0) return 'due today';
    if (days === 1) return 'due tomorrow';
    return `due in ${days} days`;
}

const byDue = (a, b) => (
    String(a.due_date).slice(0, 10).localeCompare(String(b.due_date).slice(0, 10))
    || String(a.due_time || '').localeCompare(String(b.due_time || ''))
);

// "This week" is the next seven days, not the calendar week.
const GROUPS = [
    { key: 'overdue', title: 'Overdue', tone: 'text-rose-700', match: (d) => d < 0 },
    { key: 'today', title: 'Today', tone: 'text-amber-700', match: (d) => d === 0 },
    { key: 'week', title: 'This week', hint: 'next 7 days', tone: 'text-slate-900', match: (d) => d >= 1 && d <= 7 },
    { key: 'later', title: 'Later', tone: 'text-slate-900', match: (d) => d > 7 },
];

function FollowupRow({ task, kind, days, canEdit, onDone, busy }) {
    const patientName = task.patient?.full_name || `Patient #${task.patient_id}`;
    const phone = String(task.patient?.phone || '').replace(/[^\d+]/g, '');
    const isPending = kind === 'pending';

    let dueText;
    let dueTone = 'text-slate-600';
    if (isPending) {
        dueText = dueInWords(days);
        if (days < 0) dueTone = 'font-medium text-rose-700';
        else if (days === 0) dueTone = 'font-medium text-amber-700';
    } else if (task.status === 'done') {
        dueText = `done ${formatDate(task.completed_at)}`;
    } else {
        dueText = STATUS_LABELS[task.status] || task.status;
    }

    return (
        <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0 flex-1 basis-64">
                <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-slate-900">{patientName}</span>
                    {isPending && task.priority === 'high' ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700" title="High priority">
                            <AppIcon name="alert-triangle" className="h-3 w-3" />
                            High
                        </span>
                    ) : null}
                </div>
                <div className="mt-0.5 text-sm text-slate-700">{TASK_TYPE_LABELS[task.task_type] || task.task_type}</div>
                {task.note ? <div className="mt-0.5 text-sm text-slate-500">{task.note}</div> : null}
            </div>

            <div className="basis-44 text-sm">
                <div className={dueTone}>{dueText}</div>
                <div className="text-xs text-slate-500">
                    {isPending ? `${formatDate(task.due_date)} · ` : ''}
                    {task.doctor?.full_name || 'No doctor'}
                    {task.assignee?.full_name ? ` · ${task.assignee.full_name}` : ''}
                </div>
            </div>

            {isPending ? (
                <div className="flex items-center gap-2">
                    {phone ? (
                        <a
                            href={`tel:${phone}`}
                            className="inline-flex items-center rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                        >
                            Call
                        </a>
                    ) : (
                        <span
                            aria-disabled="true"
                            title="This patient has no phone number on file"
                            className="inline-flex cursor-not-allowed items-center rounded-xl border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-400"
                        >
                            Call · no phone
                        </span>
                    )}
                    {canEdit ? (
                        <button
                            type="button"
                            onClick={() => onDone(task)}
                            disabled={busy}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                        >
                            <AppIcon name="check" className="h-4 w-4" />
                            Done
                        </button>
                    ) : null}
                </div>
            ) : null}
        </li>
    );
}

function Group({ title, hint, tone, count, children, footer }) {
    return (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <header className="flex items-baseline gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
                <h3 className={`text-sm font-semibold ${tone || 'text-slate-900'}`}>{title}</h3>
                <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200">{count}</span>
                {hint ? <span className="text-xs text-slate-500">{hint}</span> : null}
            </header>
            {children}
            {footer}
        </section>
    );
}

export default function FollowupsPage() {
    const { user } = useAuth();
    const scope = useScope();
    const location = useLocation();
    const navigate = useNavigate();
    const base = useMemo(() => (user?.role === 'super_admin' ? '/super-admin' : '/clinic'), [user]);
    const canEdit = Boolean(scope?.can?.('followups.edit'));
    const canCreate = Boolean(scope?.can?.('followups.create'));

    // Doctors and assistants land on their own queue; a filter widens it.
    const ownQueue = OWN_QUEUE_ROLES.includes(user?.role) || scope?.roleKind === 'doctor';
    const [filters, setFilters] = useState(() => ({
        doctorId: '',
        assigneeId: ownQueue && user?.id ? String(user.id) : '',
        status: 'all',
    }));
    // The preset is applied once; it also applies later if the scope (role kind) arrives after mount.
    // Any manual filter change counts as "done" so it is never re-imposed.
    const presetDone = useRef(ownQueue && Boolean(user?.id));
    useEffect(() => {
        if (presetDone.current || !ownQueue || !user?.id) return;
        presetDone.current = true;
        setFilters((p) => ({ ...p, assigneeId: p.assigneeId || String(user.id) }));
    }, [ownQueue, user?.id]);

    const [doctors, setDoctors] = useState([]);
    const [staff, setStaff] = useState([]);
    const [reloadKey, setReloadKey] = useState(0);

    const [data, setData] = useState(EMPTY_DATA);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    // The add page returns here with its confirmation in the navigation state; consume it once.
    const [notice, setNotice] = useState(() => location.state?.notice || '');
    useEffect(() => {
        if (location.state?.notice) navigate(location.pathname, { replace: true, state: null });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Done is sent immediately. `busy` holds ids with a request in flight;
    // `recent` holds just-completed tasks whose Undo is still on offer.
    const [busy, setBusy] = useState([]);
    const [recent, setRecent] = useState([]);
    const timersRef = useRef(new Map()); // task id -> toast dismissal timer
    const mountedRef = useRef(true);
    const genRef = useRef(0); // bumped on every list load; a Done/Undo that finishes in a later generation reloads instead of patching
    const reloadMessageRef = useRef(''); // message to keep visible across the next reload
    const statusRef = useRef(filters.status);
    statusRef.current = filters.status;

    // Reset the error banner when the filters or the route change.
    useEffect(() => {
        setError('');
    }, [filters.doctorId, filters.assigneeId, filters.status, location.key]);

    useEffect(() => {
        let cancelled = false;
        client.get(`${base}/doctors`, { params: { per_page: 200 } })
            .then((res) => { if (!cancelled) setDoctors(Array.isArray(res?.data?.data) ? res.data.data : []); })
            .catch(() => { if (!cancelled) setDoctors([]); });
        // Listing staff needs staff.view; without it the assignee list falls back to people seen in the data.
        client.get(`${base}/users`, { params: { per_page: 200 } })
            .then((res) => { if (!cancelled) setStaff(Array.isArray(res?.data?.data) ? res.data.data : []); })
            .catch(() => { if (!cancelled) setStaff([]); });
        return () => { cancelled = true; };
    }, [base]);

    useEffect(() => {
        let cancelled = false;
        genRef.current += 1;
        setLoading(true);
        // A reload triggered by a failed Done keeps the server's explanation on screen.
        setError(reloadMessageRef.current);
        reloadMessageRef.current = '';

        const scoped = {};
        if (filters.doctorId) scoped.doctor_id = filters.doctorId;
        if (filters.assigneeId) scoped.assigned_to_user_id = filters.assigneeId;
        const list = (status, per_page, sort_by, sort_dir) => client.get(`${base}/followups`, {
            params: { ...scoped, status, per_page, sort_by, sort_dir },
        });
        const none = { data: { data: [], meta: { total: 0 } } };

        const wantPending = ['all', 'pending'].includes(filters.status);
        const wantDone = ['all', 'done'].includes(filters.status);
        const wantClosed = ['all', 'closed'].includes(filters.status);

        Promise.all([
            wantPending ? list('pending', PENDING_LIMIT, 'due_date', 'asc') : none,
            wantDone ? list('done', DONE_LIMIT, 'completed_at', 'desc') : none,
            wantClosed ? list('skipped', CLOSED_LIMIT, 'updated_at', 'desc') : none,
            wantClosed ? list('cancelled', CLOSED_LIMIT, 'updated_at', 'desc') : none,
        ])
            .then(([pending, done, skipped, cancelledRes]) => {
                if (cancelled) return;
                const rowsOf = (res) => (Array.isArray(res?.data?.data) ? res.data.data : []);
                const closed = [...rowsOf(skipped), ...rowsOf(cancelledRes)]
                    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
                    .slice(0, CLOSED_LIMIT);
                setData({
                    pending: rowsOf(pending),
                    pendingTotal: Number(pending?.data?.meta?.total ?? rowsOf(pending).length),
                    done: rowsOf(done),
                    doneTotal: Number(done?.data?.meta?.total ?? rowsOf(done).length),
                    closed,
                    closedTotal: Number(skipped?.data?.meta?.total ?? 0) + Number(cancelledRes?.data?.meta?.total ?? 0),
                });
            })
            .catch((e) => {
                if (cancelled) return;
                setData(EMPTY_DATA);
                setError(apiError(e, 'Failed to load follow-ups'));
            })
            .finally(() => { if (!cancelled) setLoading(false); });

        return () => { cancelled = true; };
    }, [base, filters.doctorId, filters.assigneeId, filters.status, reloadKey]);

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);
    useEffect(() => () => {
        timersRef.current.forEach((timer) => clearTimeout(timer));
        timersRef.current.clear();
    }, []);

    const dropToast = (id) => {
        clearTimeout(timersRef.current.get(id));
        timersRef.current.delete(id);
        setRecent((list) => list.filter((t) => t.id !== id));
    };

    // Completes straight away; Undo (below) is a real revert, so a click is never silently lost.
    const markDone = async (task) => {
        if (busy.includes(task.id)) return; // prevent double-submit
        setError('');
        setBusy((b) => [...b, task.id]);
        const gen = genRef.current;
        try {
            await client.post(`${base}/followups/${task.id}/complete`);
            if (!mountedRef.current) return;
            if (gen !== genRef.current) {
                // Filters changed or a reload landed mid-request; the server has it, so re-read rather than patch stale lists.
                setReloadKey((k) => k + 1);
                return;
            }
            setData((d) => {
                const finished = { ...task, status: 'done', completed_at: new Date().toISOString() };
                const showsDone = ['all', 'done'].includes(statusRef.current);
                return {
                    ...d,
                    pending: d.pending.filter((t) => t.id !== task.id),
                    pendingTotal: Math.max(0, d.pendingTotal - 1),
                    done: showsDone ? [finished, ...d.done].slice(0, DONE_LIMIT) : d.done,
                    doneTotal: d.doneTotal + 1,
                };
            });
            setRecent((list) => [...list.filter((t) => t.id !== task.id), task]);
            timersRef.current.set(task.id, setTimeout(() => dropToast(task.id), UNDO_MS));
        } catch (e) {
            if (!mountedRef.current) return;
            // The row stays where it was and the server's own words explain why.
            const message = apiError(e, 'Could not mark the follow-up as done');
            setError(message);
            if (e?.response?.status === 422) {
                // Already closed elsewhere: refresh so the list agrees, keeping the message visible.
                reloadMessageRef.current = message;
                setReloadKey((k) => k + 1);
            }
        } finally {
            setBusy((b) => b.filter((id) => id !== task.id));
        }
    };

    // Put the task back to pending through the generic update (same followups.edit gate).
    const undoDone = async (task) => {
        dropToast(task.id);
        setError('');
        setBusy((b) => [...b, task.id]);
        const gen = genRef.current;
        try {
            await client.put(`${base}/followups/${task.id}`, { status: 'pending', completed_at: null });
            if (!mountedRef.current) return;
            if (gen !== genRef.current) {
                setReloadKey((k) => k + 1);
                return;
            }
            setData((d) => ({
                ...d,
                pending: [...d.pending.filter((t) => t.id !== task.id), task],
                pendingTotal: d.pendingTotal + 1,
                done: d.done.filter((t) => t.id !== task.id),
                doneTotal: Math.max(0, d.doneTotal - 1),
            }));
        } catch (e) {
            // Leave it shown as done: that is what the server still says.
            setError(apiError(e, 'Could not undo; the follow-up is still marked done'));
        } finally {
            setBusy((b) => b.filter((id) => id !== task.id));
        }
    };

    const setFilter = (key, value) => { presetDone.current = true; setFilters((p) => ({ ...p, [key]: value })); };

    const assigneeOptions = useMemo(() => {
        const seen = new Map();
        staff.forEach((u) => seen.set(String(u.id), u.full_name || u.name || `User #${u.id}`));
        [...data.pending, ...data.done, ...data.closed].forEach((t) => {
            if (t.assignee && !seen.has(String(t.assignee.id))) seen.set(String(t.assignee.id), t.assignee.full_name);
        });
        if (user?.id && !seen.has(String(user.id))) seen.set(String(user.id), user.full_name || user.name || 'Me');
        return [...seen.entries()].map(([id, label]) => ({ id, label }));
    }, [staff, data, user]);

    const today = toYMD(new Date());
    const pending = [...data.pending].sort(byDue);
    const grouped = GROUPS.map((g) => ({ ...g, rows: pending.filter((t) => g.match(daysUntil(t.due_date, today))) }));
    const showPending = ['all', 'pending'].includes(filters.status);
    const showDone = ['all', 'done'].includes(filters.status);
    const showClosed = ['all', 'closed'].includes(filters.status);
    const nothing = !loading && !error
        && !(showPending && pending.length)
        && !(showDone && data.done.length)
        && !(showClosed && data.closed.length);
    const narrowed = Boolean(filters.doctorId || filters.assigneeId);
    const viewingOwn = ownQueue && filters.assigneeId === String(user?.id);

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
                <div className="flex items-center gap-2">
                    <AppIcon name="clipboard-check" className="h-5 w-5 text-slate-700" />
                    <div>
                        <h2 className="text-xl font-semibold text-slate-900">Follow-ups</h2>
                        <p className="mt-0.5 text-sm text-slate-600">
                            {viewingOwn ? 'Your follow-ups, most urgent first.' : 'Calls and nudges that are due, most urgent first.'}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setReloadKey((k) => k + 1)}
                        disabled={loading}
                        className="rounded-xl border border-slate-300 px-3 py-2 text-sm disabled:opacity-50"
                    >
                        {loading ? 'Refreshing…' : 'Refresh'}
                    </button>
                    {canCreate ? (
                        <Link
                            to="/workflows/followups/new"
                            className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
                        >
                            <AppIcon name="plus" className="h-4 w-4" />
                            Add follow-up
                        </Link>
                    ) : null}
                </div>
            </div>

            {notice ? (
                <div role="status" className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                    <span>{notice}</span>
                    <button type="button" onClick={() => setNotice('')} className="text-xs font-medium underline">Dismiss</button>
                </div>
            ) : null}

            <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-4">
                <div>
                    <label htmlFor="fu-doctor" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Doctor</label>
                    <select id="fu-doctor" value={filters.doctorId} onChange={(e) => setFilter('doctorId', e.target.value)} className={inputClass}>
                        <option value="">All doctors</option>
                        {doctors.map((d) => <option key={d.id} value={String(d.id)}>{doctorLabel(d)}</option>)}
                    </select>
                </div>
                <div>
                    <label htmlFor="fu-assignee" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Assigned to</label>
                    <select id="fu-assignee" value={filters.assigneeId} onChange={(e) => setFilter('assigneeId', e.target.value)} className={inputClass}>
                        <option value="">Everyone</option>
                        {assigneeOptions.map((o) => (
                            <option key={o.id} value={o.id}>{String(user?.id) === o.id ? `${o.label} (me)` : o.label}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label htmlFor="fu-status" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Show</label>
                    <select id="fu-status" value={filters.status} onChange={(e) => setFilter('status', e.target.value)} className={inputClass}>
                        {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                </div>
                <div className="flex items-end">
                    <button
                        type="button"
                        onClick={() => { presetDone.current = true; setFilters({ doctorId: '', assigneeId: '', status: 'all' }); }}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                        Show whole clinic
                    </button>
                </div>
            </div>

            {error ? <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
            {showPending && data.pendingTotal > data.pending.length ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    Showing the {data.pending.length} most overdue of {data.pendingTotal} open follow-ups. Narrow by doctor or assignee to see the rest.
                </div>
            ) : null}

            {loading ? (
                <Skeleton variant="table" rows={5} cols={4} />
            ) : (
                <div className="space-y-4">
                    {showPending ? grouped.map((g) => (
                        (g.rows.length || g.key === 'overdue' || g.key === 'today') ? (
                            <Group key={g.key} title={g.title} hint={g.hint} tone={g.tone} count={g.rows.length}>
                                {g.rows.length ? (
                                    <ul className="divide-y divide-slate-100">
                                        {g.rows.map((t) => (
                                            <FollowupRow key={t.id} task={t} kind="pending" days={daysUntil(t.due_date, today)} canEdit={canEdit} onDone={markDone} busy={busy.includes(t.id)} />
                                        ))}
                                    </ul>
                                ) : (
                                    <p className="px-4 py-3 text-sm text-slate-500">{g.key === 'overdue' ? 'Nothing overdue.' : 'Nothing due today.'}</p>
                                )}
                            </Group>
                        ) : null
                    )) : null}

                    {showDone && data.done.length ? (
                        <Group
                            title="Done"
                            hint={`latest ${data.done.length}`}
                            count={data.doneTotal}
                            footer={data.doneTotal > data.done.length ? (
                                <div className="border-t border-slate-100 px-4 py-2.5 text-sm">
                                    <Link to="/modules/followups" className="font-medium text-slate-700 underline">
                                        Open the full follow-up list ({data.doneTotal} done)
                                    </Link>
                                </div>
                            ) : null}
                        >
                            <ul className="divide-y divide-slate-100">
                                {data.done.map((t) => <FollowupRow key={t.id} task={t} kind="done" />)}
                            </ul>
                        </Group>
                    ) : null}

                    {showClosed && data.closed.length ? (
                        <Group title="Closed" hint={`skipped or cancelled, latest ${data.closed.length}`} count={data.closedTotal}>
                            <ul className="divide-y divide-slate-100">
                                {data.closed.map((t) => <FollowupRow key={t.id} task={t} kind="closed" />)}
                            </ul>
                        </Group>
                    ) : null}

                    {nothing ? (
                        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-sm">
                            {narrowed ? 'No follow-ups match these filters.' : 'No follow-ups yet.'}
                        </div>
                    ) : null}
                </div>
            )}

            {recent.length ? (
                <div className="fixed bottom-4 left-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 space-y-2" role="status" aria-live="polite">
                    {recent.map((t) => (
                        <div key={t.id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-900 px-4 py-2.5 text-sm text-white shadow-lg">
                            <span className="truncate">Marked done: {t.patient?.full_name || `Patient #${t.patient_id}`}</span>
                            <button type="button" onClick={() => undoDone(t)} className="shrink-0 font-semibold underline underline-offset-2">
                                Undo
                            </button>
                        </div>
                    ))}
                </div>
            ) : null}
        </div>
    );
}
