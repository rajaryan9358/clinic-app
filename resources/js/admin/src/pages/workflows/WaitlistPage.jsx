import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useScope } from '../../context/ScopeContext';
import AppIcon from '../../components/AppIcon';
import StatusBadge from '../../components/StatusBadge';
import { formatDate, formatDateTime, formatTime } from '../../utils/dateFormat';

const STATUS_OPTIONS = [
    { value: 'active', label: 'Active (waiting + offered)' },
    { value: 'all', label: 'All' },
    { value: 'waiting', label: 'Waiting' },
    { value: 'offered', label: 'Offered' },
    { value: 'booked', label: 'Booked' },
    { value: 'declined', label: 'Declined' },
    { value: 'expired', label: 'Expired' },
    { value: 'removed', label: 'Removed' },
];

const PER_PAGE = 20;

const doctorLabel = (d) => [d?.title, d?.full_name || d?.name].filter(Boolean).join(' ').trim() || `Doctor #${d?.id}`;

const apiError = (e, fallback) => e?.response?.data?.message || e?.message || fallback;

const inputClass = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200';

export default function WaitlistPage() {
    const { user } = useAuth();
    const scope = useScope();
    const location = useLocation();
    const base = useMemo(() => (user?.role === 'super_admin' ? '/super-admin' : '/clinic'), [user]);
    const canManage = Boolean(scope?.can?.('appointments.create'));

    const [doctors, setDoctors] = useState([]);
    const activeDoctors = useMemo(() => doctors.filter((d) => (d.status ?? 'active') === 'active'), [doctors]);

    const [filters, setFilters] = useState({ doctorId: '', date: '', status: 'active' });
    const [page, setPage] = useState(1);
    const [reloadKey, setReloadKey] = useState(0);

    const [rows, setRows] = useState([]);
    const [meta, setMeta] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    // The add page returns here with its confirmation in the navigation state.
    const [notice, setNotice] = useState(() => location.state?.notice || '');

    const [removeConfirm, setRemoveConfirm] = useState({ id: null, busy: false });


    // Reset page state whenever the filters or the route change.
    useEffect(() => {
        setPage(1);
        setRemoveConfirm({ id: null, busy: false });
        setNotice(location.state?.notice || '');
    }, [filters.doctorId, filters.date, filters.status, location.key]);

    useEffect(() => {
        let cancelled = false;
        client.get(`${base}/doctors`, { params: { per_page: 200 } })
            .then((res) => {
                if (cancelled) return;
                setDoctors(Array.isArray(res?.data?.data) ? res.data.data : []);
            })
            .catch(() => {
                if (cancelled) return;
                setDoctors([]);
            });
        return () => { cancelled = true; };
    }, [base]);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError('');
        const params = { per_page: PER_PAGE, page, status: filters.status || 'active' };
        if (filters.doctorId) params.doctor_id = filters.doctorId;
        if (filters.date) params.date = filters.date;

        client.get(`${base}/waitlist`, { params })
            .then((res) => {
                if (cancelled) return;
                setRows(Array.isArray(res?.data?.data) ? res.data.data : []);
                setMeta(res?.data?.meta || null);
            })
            .catch((e) => {
                if (cancelled) return;
                setRows([]);
                setMeta(null);
                setError(apiError(e, 'Failed to load waitlist'));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [base, filters.doctorId, filters.date, filters.status, page, reloadKey]);

    const setFilter = (key, value) => {
        setFilters((p) => ({ ...p, [key]: value }));
        setPage(1);
    };

    // A removal can empty the last page; step back to the new last page.
    useEffect(() => {
        // Only once a page has loaded; a failed fetch (meta null) keeps the page and its error.
        if (!meta || loading) return;
        const last = Number(meta.last_page || 1);
        if (page > last) setPage(last);
    }, [meta, loading, page]);

    // The add page opens with the current doctor/date filter prefilled. It drops past dates and
    // inactive doctors itself, so they are passed through as-is.
    const addHref = (() => {
        const q = new URLSearchParams();
        if (filters.doctorId) q.set('doctor_id', filters.doctorId);
        if (filters.date) q.set('date', filters.date);
        const qs = q.toString();
        return qs ? `/workflows/waitlist/new?${qs}` : '/workflows/waitlist/new';
    })();

    const confirmRemove = async (id) => {
        setRemoveConfirm({ id, busy: true });
        setError('');
        try {
            const res = await client.delete(`${base}/waitlist/${id}`);
            setRemoveConfirm({ id: null, busy: false });
            setNotice(res?.data?.message || 'Removed from the waitlist.');
            setReloadKey((k) => k + 1);
        } catch (e) {
            setRemoveConfirm({ id: null, busy: false });
            setError(apiError(e, 'Failed to remove from the waitlist'));
        }
    };

    const lastPage = Number(meta?.last_page || 1);
    const total = Number(meta?.total ?? rows.length);

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
                <div className="flex items-center gap-2">
                    <AppIcon name="calendar" className="h-5 w-5 text-slate-700" />
                    <div>
                        <h2 className="text-xl font-semibold text-slate-900">Waitlist</h2>
                        <p className="mt-0.5 text-sm text-slate-600">Patients waiting for a taken slot. A freed slot is held for the first in line.</p>
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
                    {canManage ? (
                        <Link
                            to={addHref}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
                        >
                            <AppIcon name="plus" className="h-4 w-4" />
                            Add to waitlist
                        </Link>
                    ) : null}
                </div>
            </div>

            <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-4">
                <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Doctor</label>
                    <select value={filters.doctorId} onChange={(e) => setFilter('doctorId', e.target.value)} className={inputClass}>
                        <option value="">All doctors</option>
                        {doctors.map((d) => (
                            <option key={d.id} value={String(d.id)}>{doctorLabel(d)}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Date</label>
                    <input type="date" value={filters.date} onChange={(e) => setFilter('date', e.target.value)} className={inputClass} />
                </div>
                <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Status</label>
                    <select value={filters.status} onChange={(e) => setFilter('status', e.target.value)} className={inputClass}>
                        {STATUS_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                    </select>
                </div>
                <div className="flex items-end">
                    <button
                        type="button"
                        onClick={() => {
                            setFilters({ doctorId: '', date: '', status: 'active' });
                            setPage(1);
                        }}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                        Clear filters
                    </button>
                </div>
            </div>

            {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
            {notice ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</div> : null}

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50">
                            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                                <th className="px-4 py-3">Patient</th>
                                <th className="px-4 py-3">Doctor</th>
                                <th className="px-4 py-3">Date / time</th>
                                <th className="px-4 py-3">Status</th>
                                <th className="px-4 py-3">Position</th>
                                <th className="px-4 py-3">Hold until</th>
                                <th className="px-4 py-3">Source</th>
                                {canManage ? <th className="px-4 py-3 text-right">Actions</th> : null}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {loading && !rows.length ? (
                                <tr><td colSpan={canManage ? 8 : 7} className="px-4 py-6 text-center text-slate-500">Loading…</td></tr>
                            ) : null}
                            {!loading && !rows.length ? (
                                <tr><td colSpan={canManage ? 8 : 7} className="px-4 py-6 text-center text-slate-500">No waitlist entries.</td></tr>
                            ) : null}
                            {rows.map((r) => {
                                const active = ['waiting', 'offered'].includes(String(r.status));
                                const confirming = removeConfirm.id === r.id;
                                return (
                                    <tr key={r.id} className="align-top">
                                        <td className="px-4 py-3">
                                            <div className="font-medium text-slate-900">{r.patient?.full_name || `Patient #${r.patient?.id ?? ''}`}</div>
                                            <div className="text-xs text-slate-500">{r.patient?.phone || '—'}</div>
                                        </td>
                                        <td className="px-4 py-3 text-slate-700">{r.doctor?.name || '—'}</td>
                                        <td className="px-4 py-3 text-slate-700">
                                            <div>{formatDate(r.date)}</div>
                                            <div className="text-xs text-slate-500">
                                                {formatTime(r.start_time)}{r.end_time ? `–${formatTime(r.end_time)}` : ''}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                                        <td className="px-4 py-3 text-slate-700">{r.position ?? '—'}</td>
                                        <td className="px-4 py-3 text-slate-700">{r.hold_expires_at ? formatDateTime(r.hold_expires_at) : '—'}</td>
                                        <td className="px-4 py-3 capitalize text-slate-700">{r.source || '—'}</td>
                                        {canManage ? (
                                            <td className="px-4 py-3 text-right">
                                                {active ? (
                                                    confirming ? (
                                                        <div className="inline-flex items-center gap-2">
                                                            <span className="text-xs text-slate-600">Remove?</span>
                                                            <button
                                                                type="button"
                                                                disabled={removeConfirm.busy}
                                                                onClick={() => confirmRemove(r.id)}
                                                                className="rounded-lg bg-rose-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-50"
                                                            >
                                                                {removeConfirm.busy ? 'Removing…' : 'Yes, remove'}
                                                            </button>
                                                            <button
                                                                type="button"
                                                                disabled={removeConfirm.busy}
                                                                onClick={() => setRemoveConfirm({ id: null, busy: false })}
                                                                className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                                            >
                                                                Keep
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            disabled={removeConfirm.busy}
                                                            onClick={() => setRemoveConfirm({ id: r.id, busy: false })}
                                                            className="rounded-lg border border-red-100 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
                                                        >
                                                            Remove
                                                        </button>
                                                    )
                                                ) : null}
                                            </td>
                                        ) : null}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {lastPage > 1 || total > 0 ? (
                    <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
                        <span>{total} {total === 1 ? 'entry' : 'entries'} · Page {page} of {lastPage}</span>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                disabled={loading || page <= 1}
                                onClick={() => setPage((p) => Math.max(1, p - 1))}
                                className="rounded-xl border border-slate-300 px-3 py-1.5 disabled:opacity-50"
                            >
                                Previous
                            </button>
                            <button
                                type="button"
                                disabled={loading || page >= lastPage}
                                onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
                                className="rounded-xl border border-slate-300 px-3 py-1.5 disabled:opacity-50"
                            >
                                Next
                            </button>
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
