import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';
import { useSession } from '../session';
import { Card, ErrorText, Spinner } from '../components/ui';
import { formatDate } from '../lib/format';
import { formatMoney, statusChip } from '../lib/money';

/**
 * `GET invoices` — the acting profile's issued and paid invoices, newest
 * first. A "Pay" pill shows only when something is owed (balance > 0) and the flag `can_pay_online` is set; a
 * negative balance is an overpayment and is labelled as such, never as due.
 * Re-fetches when the acting profile changes; `active` drops stale responses.
 */
export default function Invoices() {
    const { activeProfileId } = useSession();
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        let active = true;
        setLoading(true);
        setError('');

        api.get('/invoices')
            .then(({ data }) => {
                if (active) setItems(data.data || []);
            })
            .catch((err) => {
                if (active) {
                    setItems([]);
                    setError(err?.response?.data?.message || 'Could not load your invoices.');
                }
            })
            .finally(() => {
                if (active) setLoading(false);
            });

        return () => {
            active = false;
        };
    }, [activeProfileId]);

    return (
        <div className="space-y-4">
            <h1 className="text-xl font-semibold text-slate-900">Invoices</h1>

            {loading && (
                <div className="flex justify-center py-12">
                    <Spinner className="h-6 w-6 text-[var(--accent)]" />
                </div>
            )}

            {!loading && error && <ErrorText>{error}</ErrorText>}

            {!loading && !error && items.length === 0 && (
                <Card className="py-10 text-center text-slate-500">
                    <p className="text-sm">No invoices yet.</p>
                </Card>
            )}

            {!loading && !error && items.length > 0 && (
                <ul className="space-y-3">
                    {items.map((invoice) => {
                        const chip = statusChip(invoice);
                        const balance = Number(invoice.balance) || 0;
                        const canPay = invoice.can_pay_online === true;
                        return (
                            <li key={invoice.id}>
                                <Link to={`/invoices/${invoice.id}`} className="block">
                                    <Card>
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="truncate text-sm font-semibold text-slate-900">
                                                    {invoice.invoice_number || `Invoice #${invoice.id}`}
                                                </p>
                                                <p className="text-xs text-slate-500">
                                                    {formatDate(invoice.invoice_date)}
                                                    {invoice.doctor_name ? ` · ${invoice.doctor_name}` : ''}
                                                </p>
                                            </div>
                                            <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${chip.className}`}>
                                                {chip.label}
                                            </span>
                                        </div>
                                        <div className="mt-3 flex items-center justify-between">
                                            <div>
                                                <p className="text-base font-semibold tabular-nums text-slate-900">
                                                    {formatMoney(invoice.total_amount)}
                                                </p>
                                                {balance > 0 && (
                                                    <p className="text-xs text-amber-700">{formatMoney(balance)} due</p>
                                                )}
                                                {balance < 0 && (
                                                    <p className="text-xs text-slate-500">Overpaid by {formatMoney(Math.abs(balance))}</p>
                                                )}
                                            </div>
                                            {balance > 0 && canPay && (
                                                <span className="rounded-full bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-white">
                                                    Pay
                                                </span>
                                            )}
                                        </div>
                                    </Card>
                                </Link>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
