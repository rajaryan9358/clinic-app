import { useEffect, useState } from 'react';
import client from '../../api/client';
import StatusBadge from '../../components/StatusBadge';
import { Btn, Card, EmptyState, ErrorText, Field, LoadingState, SelectInput, TextInput } from '../../components/billing/ui.jsx';
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
        <div className="space-y-5">
            <div>
                <h1 className="text-xl font-bold text-gray-900">Subscription Transactions</h1>
                <p className="mt-0.5 text-sm text-gray-500">Razorpay and offline payments recorded across all clinics.</p>
            </div>

            <Card className="p-5">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                    <Field label="Clinic">
                        <SelectInput
                            value={filters.clinic_id}
                            onChange={setF('clinic_id')}
                            options={[{ value: '', label: 'All clinics' }, ...clinics.map((c) => ({ value: String(c.id), label: c.name }))]}
                        />
                    </Field>
                    <Field label="Status">
                        <SelectInput value={filters.status} onChange={setF('status')} options={STATUS_OPTIONS} />
                    </Field>
                    <Field label="Source">
                        <SelectInput value={filters.source} onChange={setF('source')} options={SOURCE_OPTIONS} />
                    </Field>
                    <Field label="From">
                        <TextInput type="date" value={filters.from} onChange={setF('from')} />
                    </Field>
                    <Field label="To">
                        <TextInput type="date" value={filters.to} onChange={setF('to')} />
                    </Field>
                </div>
                <div className="mt-4 flex items-center justify-between gap-3">
                    <Btn variant="primary" onClick={applyFilters} disabled={loading}>Apply Filters</Btn>
                    {totalCaptured != null && (
                        <div className="text-right">
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Total collected</p>
                            <p className="text-lg font-bold text-emerald-600 tabular-nums">{formatINR(totalCaptured)}</p>
                        </div>
                    )}
                </div>
            </Card>

            {error && <ErrorText>{error}</ErrorText>}

            {loading ? (
                <LoadingState />
            ) : !rows.length ? (
                <Card><EmptyState icon="credit-card" text="No transactions found for these filters." /></Card>
            ) : (
                <Card className="overflow-x-auto">
                    <table className="w-full min-w-[1100px] text-sm">
                        <thead>
                            <tr className="border-b border-gray-100 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">
                                <th className="px-4 py-3">Date</th>
                                <th className="px-4 py-3">Clinic</th>
                                <th className="px-4 py-3">Plan</th>
                                <th className="px-4 py-3">Cycle</th>
                                <th className="px-4 py-3">Amount</th>
                                <th className="px-4 py-3">Status</th>
                                <th className="px-4 py-3">Source</th>
                                <th className="px-4 py-3">Method</th>
                                <th className="px-4 py-3">Razorpay Payment ID</th>
                                <th className="px-4 py-3">Invoice</th>
                                <th className="px-4 py-3">Notes</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {rows.map((row) => (
                                <tr key={row.id}>
                                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">{formatDateTime(row.paid_at || row.created_at)}</td>
                                    <td className="px-4 py-3 text-gray-900">{row.clinic?.name || '—'}</td>
                                    <td className="px-4 py-3 text-gray-800">{row.plan?.name || '—'}</td>
                                    <td className="px-4 py-3 capitalize text-gray-600">{row.billing_cycle || '—'}</td>
                                    <td className="px-4 py-3 tabular-nums font-semibold text-gray-900">{formatINR(row.amount)}</td>
                                    <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                                    <td className="px-4 py-3 capitalize text-gray-600">{row.source || '—'}</td>
                                    <td className="px-4 py-3 text-gray-600">{row.method || '—'}</td>
                                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{row.razorpay_payment_id || '—'}</td>
                                    <td className="px-4 py-3">
                                        {row.invoice_url ? (
                                            <a href={row.invoice_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">View</a>
                                        ) : '—'}
                                    </td>
                                    <td className="px-4 py-3 max-w-[200px] truncate text-gray-500" title={row.notes || ''}>{row.notes || '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3">
                        <p className="text-xs text-gray-500">
                            Page {pagination.current_page} of {pagination.last_page} · {pagination.total} total
                        </p>
                        <div className="flex gap-2">
                            <Btn onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={pagination.current_page <= 1}>← Prev</Btn>
                            <Btn onClick={() => setPage((p) => Math.min(pagination.last_page, p + 1))} disabled={pagination.current_page >= pagination.last_page}>Next →</Btn>
                        </div>
                    </div>
                </Card>
            )}
        </div>
    );
}
