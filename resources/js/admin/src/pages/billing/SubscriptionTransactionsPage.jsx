import { useEffect, useState } from 'react';
import client from '../../api/client';
import StatusBadge from '../../components/StatusBadge';
import { Alert, btn, Card, EmptyState, input, PageHeader, Spinner } from '../../components/ui';
import { formatDateTime } from '../../utils/dateFormat';
import { formatINR } from '../../utils/money';

const STATUS_OPTIONS = [
    { value: '', label: 'All statuses' },
    { value: 'captured', label: 'Captured' },
    { value: 'failed', label: 'Failed' },
    { value: 'refunded', label: 'Refunded' },
];

const SOURCE_OPTIONS = [
    { value: '', label: 'All sources' },
    { value: 'razorpay', label: 'Razorpay' },
    { value: 'offline', label: 'Offline' },
];

function Field({ id, label, children }) {
    return (
        <div>
            <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-600">{label}</label>
            {children}
        </div>
    );
}

export default function SubscriptionTransactionsPage() {
    const [clinics, setClinics] = useState([]);
    const [filters, setFilters] = useState({ clinic_id: '', status: '', source: '', from: '', to: '' });
    const [page, setPage] = useState(1);
    const [filtersVersion, setFiltersVersion] = useState(0);

    const [rows, setRows] = useState([]);
    const [pagination, setPagination] = useState({ current_page: 1, last_page: 1, total: 0 });
    const [totalCaptured, setTotalCaptured] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        client.get('/super-admin/clinics', { params: { per_page: 200 } })
            .then((res) => setClinics(Array.isArray(res.data?.data) ? res.data.data : []))
            .catch(() => { /* clinic filter is optional; ignore load failure */ });
    }, []);

    const load = async () => {
        setLoading(true);
        setError('');
        try {
            const params = { page };
            if (filters.clinic_id) params.clinic_id = filters.clinic_id;
            if (filters.status) params.status = filters.status;
            if (filters.source) params.source = filters.source;
            if (filters.from) params.from = filters.from;
            if (filters.to) params.to = filters.to;

            const res = await client.get('/super-admin/subscription-transactions', { params });
            const paginator = res.data?.data || {};
            setRows(Array.isArray(paginator.data) ? paginator.data : []);
            setPagination({
                current_page: paginator.current_page || 1,
                last_page: paginator.last_page || 1,
                total: paginator.total || 0,
            });
            setTotalCaptured(res.data?.meta?.total_captured ?? null);
        } catch (e) {
            setError(e?.response?.data?.message || 'Failed to load transactions');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, [page, filtersVersion]);

    const applyFilters = () => {
        setPage(1);
        setFiltersVersion((v) => v + 1);
    };

    const setF = (key) => (v) => setFilters((p) => ({ ...p, [key]: v }));

    return (
        <div className="mx-auto max-w-[1400px] space-y-5">
            <PageHeader
                title="Subscription transactions"
                subtitle="Razorpay and offline payments recorded across all clinics."
                actions={totalCaptured != null ? (
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-right">
                        <p className="text-xs font-medium text-slate-600">Total collected</p>
                        <p className="text-lg font-bold text-emerald-700 tabular-nums">{formatINR(totalCaptured)}</p>
                    </div>
                ) : null}
            />

            <Card>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                    <Field id="tx-clinic" label="Clinic">
                        <select id="tx-clinic" className={input} value={filters.clinic_id || ''} onChange={(e) => setF('clinic_id')(e.target.value)}>
                            {[{ value: '', label: 'All clinics' }, ...clinics.map((c) => ({ value: String(c.id), label: c.name }))].map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                        </select>
                    </Field>
                    <Field id="tx-status" label="Status">
                        <select id="tx-status" className={input} value={filters.status || ''} onChange={(e) => setF('status')(e.target.value)}>
                            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                    </Field>
                    <Field id="tx-source" label="Source">
                        <select id="tx-source" className={input} value={filters.source || ''} onChange={(e) => setF('source')(e.target.value)}>
                            {SOURCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                    </Field>
                    <Field id="tx-from" label="From">
                        <input id="tx-from" type="date" className={input} value={filters.from ?? ''} onChange={(e) => setF('from')(e.target.value)} />
                    </Field>
                    <Field id="tx-to" label="To">
                        <input id="tx-to" type="date" className={input} value={filters.to ?? ''} onChange={(e) => setF('to')(e.target.value)} />
                    </Field>
                </div>
                <div className="mt-4 flex justify-end">
                    <button type="button" className={btn.primary} onClick={applyFilters} disabled={loading}>Apply filters</button>
                </div>
            </Card>

            {error && <Alert tone="error">{error}</Alert>}

            {loading ? (
                <Card><Spinner /></Card>
            ) : !rows.length ? (
                <Card bodyClassName=""><EmptyState icon="credit-card" title="No transactions found">Try different filters.</EmptyState></Card>
            ) : (
                <Card bodyClassName="" className="overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[1100px] text-sm">
                            <thead>
                                <tr className="bg-slate-50 text-left text-xs font-medium text-slate-600">
                                    <th className="px-4 py-3 font-medium">Date</th>
                                    <th className="px-4 py-3 font-medium">Clinic</th>
                                    <th className="px-4 py-3 font-medium">Plan</th>
                                    <th className="px-4 py-3 font-medium">Cycle</th>
                                    <th className="px-4 py-3 font-medium">Amount</th>
                                    <th className="px-4 py-3 font-medium">Status</th>
                                    <th className="px-4 py-3 font-medium">Source</th>
                                    <th className="px-4 py-3 font-medium">Method</th>
                                    <th className="px-4 py-3 font-medium">Razorpay payment ID</th>
                                    <th className="px-4 py-3 font-medium">Invoice</th>
                                    <th className="px-4 py-3 font-medium">Notes</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row) => (
                                    <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50">
                                        <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDateTime(row.paid_at || row.created_at)}</td>
                                        <td className="px-4 py-3 font-medium text-slate-900">{row.clinic?.name || '—'}</td>
                                        <td className="px-4 py-3 text-slate-800">{row.plan?.name || '—'}</td>
                                        <td className="px-4 py-3 capitalize text-slate-600">{row.billing_cycle || '—'}</td>
                                        <td className="px-4 py-3 font-semibold tabular-nums text-slate-900">{formatINR(row.amount)}</td>
                                        <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                                        <td className="px-4 py-3 capitalize text-slate-600">{row.source || '—'}</td>
                                        <td className="px-4 py-3 text-slate-600">{row.method || '—'}</td>
                                        <td className="px-4 py-3 font-mono text-xs text-slate-600">{row.razorpay_payment_id || '—'}</td>
                                        <td className="px-4 py-3">
                                            {row.invoice_url ? (
                                                <a href={row.invoice_url} target="_blank" rel="noreferrer" className={btn.link}>View</a>
                                            ) : '—'}
                                        </td>
                                        <td className="max-w-[200px] truncate px-4 py-3 text-slate-600" title={row.notes || ''}>{row.notes || '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
                        <p className="text-sm text-slate-600">
                            Page {pagination.current_page} of {pagination.last_page} · {pagination.total} total
                        </p>
                        <div className="flex gap-2">
                            <button type="button" className={`${btn.secondary} h-9`} onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={pagination.current_page <= 1}>‹ Prev</button>
                            <button type="button" className={`${btn.secondary} h-9`} onClick={() => setPage((p) => Math.min(pagination.last_page, p + 1))} disabled={pagination.current_page >= pagination.last_page}>Next ›</button>
                        </div>
                    </div>
                </Card>
            )}
        </div>
    );
}
