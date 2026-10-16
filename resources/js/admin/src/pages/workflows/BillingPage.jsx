import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useScope } from '../../context/ScopeContext';
import AppIcon from '../../components/AppIcon';
import StatusBadge from '../../components/StatusBadge';
import { formatDate } from '../../utils/dateFormat';
import { formatRupees } from '../../utils/money';

const STATUS_OPTIONS = [
    { value: '', label: 'All statuses' },
    { value: 'draft', label: 'Draft' },
    { value: 'issued', label: 'Issued' },
    { value: 'paid', label: 'Paid' },
    { value: 'cancelled', label: 'Cancelled' },
];

const PER_PAGE = 20;
const EMPTY_FILTERS = { q: '', status: '', from: '', to: '' };

const apiError = (e, fallback) => e?.response?.data?.message || e?.message || fallback;

const inputClass = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200';

/**
 * Balance cell. Drafts and cancelled invoices owe nothing yet, so they show a dash. An overpaid
 * invoice has a NEGATIVE balance (an online capture can overshoot); that is the clinic owing the
 * patient money and is shown as such, never clamped to zero.
 */
export function BalanceCell({ invoice }) {
    if (invoice.status === 'draft' || invoice.status === 'cancelled') {
        return <span className="text-slate-400">—</span>;
    }
    const balance = Number(invoice.balance);
    if (balance < 0) {
        return (
            <div>
                <div className="font-semibold text-rose-700">{formatRupees(balance)}</div>
                <div className="text-xs text-rose-600">Overpaid — refund due</div>
            </div>
        );
    }
    return <span className={balance > 0 ? 'font-medium text-amber-700' : 'text-slate-700'}>{formatRupees(balance)}</span>;
}

export default function BillingPage() {
    const { user } = useAuth();
    const scope = useScope();
    const location = useLocation();
    const navigate = useNavigate();
    const base = useMemo(() => (user?.role === 'super_admin' ? '/super-admin' : '/clinic'), [user]);
    const canCreate = Boolean(scope?.can?.('billing.create'));

    const [filters, setFilters] = useState(EMPTY_FILTERS);
    // The search box is debounced into `appliedQ` so typing does not fire a request per keystroke.
    const [appliedQ, setAppliedQ] = useState('');
    const [page, setPage] = useState(1);
    const [reloadKey, setReloadKey] = useState(0);

    const [rows, setRows] = useState([]);
    const [meta, setMeta] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // Reset page state whenever the route changes.
    useEffect(() => {
        setFilters(EMPTY_FILTERS);
        setAppliedQ('');
        setPage(1);
        setError('');
    }, [location.key]);

    useEffect(() => {
        const next = filters.q.trim();
        const t = setTimeout(() => {
            setAppliedQ(next);
            setPage(1);
        }, 300);
        return () => clearTimeout(t);
    }, [filters.q]);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError('');
        const params = { per_page: PER_PAGE, page };
        if (appliedQ) params.q = appliedQ;
        if (filters.status) params.status = filters.status;
        if (filters.from) params.from = filters.from;
        if (filters.to) params.to = filters.to;

        client.get(`${base}/invoices`, { params })
            .then((res) => {
                if (cancelled) return;
                setRows(Array.isArray(res?.data?.data) ? res.data.data : []);
                setMeta(res?.data?.meta || null);
            })
            .catch((e) => {
                if (cancelled) return;
                setRows([]);
                setMeta(null);
                setError(apiError(e, 'Failed to load invoices'));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [base, appliedQ, filters.status, filters.from, filters.to, page, reloadKey]);

    // A filter change can leave us past the last page; step back to it.
    useEffect(() => {
        if (!meta || loading) return;
        const last = Number(meta.last_page || 1);
        if (page > last) setPage(last);
    }, [meta, loading, page]);

    const setFilter = (key, value) => {
        setFilters((p) => ({ ...p, [key]: value }));
        if (key !== 'q') setPage(1);
    };

    // Totals cover the rows on screen: the list API has no aggregate. Drafts and cancelled
    // invoices owe nothing; an overpaid invoice is reported as money owed back, never netted off.
    const totals = useMemo(() => {
        let outstanding = 0;
        let refundDue = 0;
        rows.forEach((r) => {
            if (r.status === 'draft' || r.status === 'cancelled') return;
            const b = Number(r.balance) || 0;
            if (b > 0) outstanding += b;
            else if (b < 0) refundDue += -b;
        });
        return { outstanding: Math.round(outstanding * 100) / 100, refundDue: Math.round(refundDue * 100) / 100 };
    }, [rows]);

    const lastPage = Number(meta?.last_page || 1);
    const total = Number(meta?.total ?? rows.length);

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
                <div className="flex items-center gap-2">
                    <AppIcon name="file-text" className="h-5 w-5 text-slate-700" />
                    <div>
                        <h2 className="text-xl font-semibold text-slate-900">Billing</h2>
                        <p className="mt-0.5 text-sm text-slate-600">Invoices and the payments taken against them.</p>
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
                        <button
                            type="button"
                            onClick={() => navigate('/workflows/billing/new')}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
                        >
                            <AppIcon name="plus" className="h-4 w-4" />
                            New invoice
                        </button>
                    ) : null}
                </div>
            </div>

            <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-5">
                <div className="md:col-span-2">
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Patient or invoice number</label>
                    <input
                        type="search"
                        value={filters.q}
                        onChange={(e) => setFilter('q', e.target.value)}
                        placeholder="Name, phone or invoice number"
                        className={inputClass}
                    />
                </div>
                <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Status</label>
                    <select value={filters.status} onChange={(e) => setFilter('status', e.target.value)} className={inputClass}>
                        {STATUS_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">From</label>
                    <input type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilter('from', e.target.value)} className={inputClass} />
                </div>
                <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">To</label>
                    <input type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilter('to', e.target.value)} className={inputClass} />
                </div>
                <div className="md:col-span-5">
                    <button
                        type="button"
                        onClick={() => {
                            setFilters(EMPTY_FILTERS);
                            setAppliedQ('');
                            setPage(1);
                        }}
                        className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                        Clear filters
                    </button>
                </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-white px-5 py-3 shadow-sm">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Outstanding (invoices on this page)</div>
                    <div className="mt-1 text-xl font-semibold text-slate-900">{formatRupees(totals.outstanding)}</div>
                </div>
                <div className={`rounded-2xl border px-5 py-3 shadow-sm ${totals.refundDue > 0 ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-white'}`}>
                    <div className={`text-xs font-semibold uppercase tracking-wide ${totals.refundDue > 0 ? 'text-rose-700' : 'text-slate-500'}`}>Owed back to patients (overpaid, on this page)</div>
                    <div className={`mt-1 text-xl font-semibold ${totals.refundDue > 0 ? 'text-rose-700' : 'text-slate-900'}`}>{formatRupees(totals.refundDue)}</div>
                </div>
            </div>

            {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50">
                            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                                <th className="px-4 py-3">Invoice</th>
                                <th className="px-4 py-3">Patient</th>
                                <th className="px-4 py-3">Date</th>
                                <th className="px-4 py-3 text-right">Total</th>
                                <th className="px-4 py-3 text-right">Paid</th>
                                <th className="px-4 py-3 text-right">Balance</th>
                                <th className="px-4 py-3">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {loading && !rows.length ? (
                                <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-500">Loading…</td></tr>
                            ) : null}
                            {!loading && !rows.length ? (
                                <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-500">No invoices.</td></tr>
                            ) : null}
                            {rows.map((r) => (
                                <tr key={r.id} className="align-top hover:bg-slate-50">
                                    <td className="px-4 py-3">
                                        <Link to={`/workflows/billing/${r.id}`} className="font-medium text-blue-700 hover:underline">
                                            {r.invoice_number || 'Draft'}
                                        </Link>
                                        {r.doctor_name ? <div className="text-xs text-slate-500">{r.doctor_name}</div> : null}
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="font-medium text-slate-900">{r.patient?.full_name || '—'}</div>
                                        <div className="text-xs text-slate-500">{r.patient?.phone || '—'}</div>
                                    </td>
                                    <td className="px-4 py-3 text-slate-700">{formatDate(r.invoice_date)}</td>
                                    <td className="px-4 py-3 text-right text-slate-900">{formatRupees(r.total_amount)}</td>
                                    <td className="px-4 py-3 text-right text-slate-700">{formatRupees(r.amount_paid)}</td>
                                    <td className="px-4 py-3 text-right"><BalanceCell invoice={r} /></td>
                                    <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {lastPage > 1 || total > 0 ? (
                    <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
                        <span>{total} {total === 1 ? 'invoice' : 'invoices'} · Page {page} of {lastPage}</span>
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
                                onClick={() => setPage((p) => p + 1)}
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
