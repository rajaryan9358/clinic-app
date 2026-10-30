import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';
import { formatDate } from '../lib/format';
import { EmptyState, ErrorText, Loading, PageHeader } from '../components/ui';
import { ChevronRightIcon, PillIcon } from '../components/icons';

/**
 * `GET prescriptions`: the acting profile's finalized prescriptions
 * (latest final per appointment only — a draft is never listed here, see
 * PrescriptionController).
 */
export default function Prescriptions() {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        let active = true;
        api.get('/prescriptions')
            .then(({ data }) => {
                if (active) setItems(data.data || []);
            })
            .catch((err) => {
                if (active) setError(err?.response?.data?.message || 'Could not load your prescriptions.');
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, []);

    return (
        <div className="space-y-5">
            <PageHeader title="Prescriptions" subtitle="Prescriptions from your finished visits." />

            {loading && <Loading />}

            {!loading && error && <ErrorText>{error}</ErrorText>}

            {!loading && !error && items.length === 0 && <EmptyState icon={PillIcon} title="No prescriptions yet." />}

            {!loading && !error && items.length > 0 && (
                <ul className="space-y-3">
                    {items.map((rx) => (
                        <li key={rx.id}>
                            <Link
                                to={`/prescriptions/${rx.id}`}
                                className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:bg-slate-50"
                            >
                                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
                                    <PillIcon className="h-5 w-5" />
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="block text-sm font-semibold text-slate-900">{formatDate(rx.date)}</span>
                                    <span className="block truncate text-sm text-slate-600">{rx.doctor_name || 'Doctor'}</span>
                                    {rx.medicines?.length > 0 && (
                                        <span className="mt-1 block truncate text-xs text-slate-500">{rx.medicines.join(', ')}</span>
                                    )}
                                </span>
                                <ChevronRightIcon className="h-4 w-4 shrink-0 text-slate-400" />
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
