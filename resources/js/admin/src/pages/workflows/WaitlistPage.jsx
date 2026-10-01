import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
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

const toYMD = (d) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const doctorLabel = (d) => [d?.title, d?.full_name || d?.name].filter(Boolean).join(' ').trim() || `Doctor #${d?.id}`;

const apiError = (e, fallback) => e?.response?.data?.message || e?.message || fallback;

const inputClass = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200';

const EMPTY_ADD = {
    open: false,
    busy: false,
    error: '',
    patientQuery: '',
    patientResults: [],
    patientSearching: false,
    patient: null,
    doctorId: '',
    date: '',
    startTime: '',
};

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
    const [notice, setNotice] = useState('');

    const [removeConfirm, setRemoveConfirm] = useState({ id: null, busy: false });

    const [add, setAdd] = useState(EMPTY_ADD);
    const [slots, setSlots] = useState({ loading: false, error: '', items: [] });
    const patientQueryRef = useRef('');

    // Reset page state whenever the filters or the route change.
    useEffect(() => {
        setPage(1);
        setRemoveConfirm({ id: null, busy: false });
        setNotice('');
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

    // Booked times for the add dialog's doctor + date.
    useEffect(() => {
        if (!add.open || !add.doctorId || !add.date) {
            setSlots({ loading: false, error: '', items: [] });
            return undefined;
        }
        let cancelled = false;
        setSlots({ loading: true, error: '', items: [] });
        client.get(`${base}/appointments/availability`, {
            params: { doctor_id: add.doctorId, from_date: add.date, to_date: add.date },
        })
            .then((res) => {
                if (cancelled) return;
                const days = Array.isArray(res?.data?.data?.days) ? res.data.data.days : [];
                const day = days.find((d) => d.date === add.date);
                const now = Date.now();
                const taken = (day?.slots || []).filter((s) => {
                    if (s.available) return false;
                    const start = new Date(`${add.date}T${String(s.start_time || '').slice(0, 5)}:00`);
                    return !Number.isNaN(start.getTime()) && start.getTime() > now;
                });
                setSlots({ loading: false, error: '', items: taken });
            })
            .catch((e) => {
                if (cancelled) return;
                setSlots({ loading: false, error: apiError(e, 'Failed to load slots'), items: [] });
            });
        return () => { cancelled = true; };
    }, [base, add.open, add.doctorId, add.date]);

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

    const searchPatients = async (q) => {
        patientQueryRef.current = q;
        if (!q.trim()) {
            setAdd((p) => ({ ...p, patientResults: [], patientSearching: false }));
            return;
        }
        setAdd((p) => ({ ...p, patientSearching: true }));
        try {
            const { data } = await client.get(`${base}/patients`, { params: { search: q.trim(), per_page: 10 } });
            if (patientQueryRef.current !== q) return; // a newer search superseded this response
            setAdd((p) => ({ ...p, patientResults: Array.isArray(data?.data) ? data.data : [], patientSearching: false }));
        } catch {
            if (patientQueryRef.current !== q) return;
            setAdd((p) => ({ ...p, patientResults: [], patientSearching: false }));
        }
    };

    const openAdd = () => {
        patientQueryRef.current = '';
        // Past dates have no joinable slots; don't prefill one from the filter.
        const today = new Date().toLocaleDateString('en-CA');
        const date = filters.date && filters.date >= today ? filters.date : '';
        // Inactive doctors are listed for filtering old entries but can't be joined.
        const doctorId = activeDoctors.some((d) => String(d.id) === String(filters.doctorId)) ? filters.doctorId : '';
        setAdd({ ...EMPTY_ADD, open: true, doctorId, date });
    };

    const closeAdd = () => {
        patientQueryRef.current = '';
        setAdd(EMPTY_ADD);
    };

    const submitAdd = async () => {
        if (!add.patient || !add.doctorId || !add.date || !add.startTime) return;
        setAdd((p) => ({ ...p, busy: true, error: '' }));
        try {
            const res = await client.post(`${base}/waitlist`, {
                patient_id: add.patient.id,
                doctor_id: Number(add.doctorId),
                appointment_date: add.date,
                start_time: add.startTime,
            });
            closeAdd();
            setNotice(res?.data?.message || 'Added to the waitlist.');
            setReloadKey((k) => k + 1);
        } catch (e) {
            setAdd((p) => ({ ...p, busy: false, error: apiError(e, 'Failed to add to the waitlist') }));
        }
    };

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
    const todayYMD = toYMD(new Date());
    const canSubmitAdd = Boolean(add.patient && add.doctorId && add.date && add.startTime) && !add.busy;

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
                        <button
                            type="button"
                            onClick={openAdd}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
                        >
                            <AppIcon name="plus" className="h-4 w-4" />
                            Add to waitlist
                        </button>
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

            {add.open ? (
                <div className="fixed inset-0 z-50 flex" aria-modal="true" role="dialog">
                    <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm" onClick={() => !add.busy && closeAdd()} />

                    <div className="relative m-auto max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl">
                        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
                            <div>
                                <div className="flex items-center gap-2">
                                    <AppIcon name="calendar-plus" className="h-5 w-5 text-slate-700" />
                                    <h3 className="text-base font-semibold text-slate-900">Add to waitlist</h3>
                                </div>
                                <p className="mt-1 text-sm text-slate-600">Pick a patient and a booked slot. If the slot frees up, it is held for them.</p>
                            </div>
                            <button
                                type="button"
                                disabled={add.busy}
                                onClick={closeAdd}
                                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            >
                                Close
                            </button>
                        </div>

                        <div className="space-y-4 px-5 py-4">
                            {add.error ? (
                                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{add.error}</div>
                            ) : null}

                            <div>
                                <label className="text-sm font-semibold text-slate-900">Patient</label>
                                {add.patient ? (
                                    <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-slate-900 bg-white px-3 py-2">
                                        <div>
                                            <div className="text-sm font-semibold text-slate-900">{add.patient.full_name || `Patient #${add.patient.id}`}</div>
                                            <div className="text-xs text-slate-500">{add.patient.phone || '—'}</div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setAdd((p) => ({ ...p, patient: null }))}
                                            className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                        >
                                            Change
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        <input
                                            className={`mt-2 ${inputClass}`}
                                            value={add.patientQuery}
                                            onChange={(e) => {
                                                const q = e.target.value;
                                                setAdd((p) => ({ ...p, patientQuery: q }));
                                                searchPatients(q);
                                            }}
                                            placeholder="Search by name or mobile"
                                        />
                                        {add.patientSearching ? <div className="mt-2 text-xs text-slate-500">Searching…</div> : null}
                                        {!add.patientSearching && add.patientQuery.trim() && !add.patientResults.length ? (
                                            <div className="mt-2 text-xs text-slate-500">No patients found.</div>
                                        ) : null}
                                        {add.patientResults.length ? (
                                            <div className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                                                {add.patientResults.map((p) => (
                                                    <button
                                                        key={p.id}
                                                        type="button"
                                                        onClick={() => setAdd((s) => ({ ...s, patient: p }))}
                                                        className="block w-full rounded-xl border border-slate-200 px-3 py-2 text-left hover:border-slate-300 hover:bg-slate-50"
                                                    >
                                                        <div className="text-sm font-medium text-slate-900">{p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || `Patient #${p.id}`}</div>
                                                        <div className="text-xs text-slate-500">{p.phone || '—'}</div>
                                                    </button>
                                                ))}
                                            </div>
                                        ) : null}
                                    </>
                                )}
                            </div>

                            <div className="grid gap-3 md:grid-cols-2">
                                <div>
                                    <label className="text-sm font-semibold text-slate-900">Doctor</label>
                                    <select
                                        value={add.doctorId}
                                        onChange={(e) => setAdd((p) => ({ ...p, doctorId: e.target.value, startTime: '' }))}
                                        className={`mt-2 ${inputClass}`}
                                    >
                                        <option value="">Select doctor</option>
                                        {activeDoctors.map((d) => (
                                            <option key={d.id} value={String(d.id)}>{doctorLabel(d)}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-sm font-semibold text-slate-900">Date</label>
                                    <input
                                        type="date"
                                        min={todayYMD}
                                        value={add.date}
                                        onChange={(e) => setAdd((p) => ({ ...p, date: e.target.value, startTime: '' }))}
                                        className={`mt-2 ${inputClass}`}
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="text-sm font-semibold text-slate-900">Booked time</label>
                                {!add.doctorId || !add.date ? (
                                    <div className="mt-2 text-sm text-slate-500">Select a doctor and date to see booked times.</div>
                                ) : slots.loading ? (
                                    <div className="mt-2 text-sm text-slate-500">Loading booked times…</div>
                                ) : slots.error ? (
                                    <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{slots.error}</div>
                                ) : !slots.items.length ? (
                                    <div className="mt-2 text-sm text-slate-500">No booked times on this day — book the appointment directly.</div>
                                ) : (
                                    <div className="mt-2 flex flex-wrap gap-2">
                                        {slots.items.map((s) => {
                                            const isSelected = add.startTime === s.start_time;
                                            return (
                                                <button
                                                    key={s.start_time}
                                                    type="button"
                                                    onClick={() => setAdd((p) => ({ ...p, startTime: s.start_time }))}
                                                    className={isSelected
                                                        ? 'rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white'
                                                        : 'rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50'}
                                                >
                                                    {formatTime(s.start_time)}–{formatTime(s.end_time)}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-white px-5 py-4">
                            <button
                                type="button"
                                disabled={add.busy}
                                onClick={closeAdd}
                                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={!canSubmitAdd}
                                onClick={submitAdd}
                                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                            >
                                {add.busy ? 'Adding…' : 'Add to waitlist'}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
