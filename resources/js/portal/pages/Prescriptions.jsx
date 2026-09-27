import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';
import { formatDate } from '../lib/format';
import { Card, ErrorText, Spinner } from '../components/ui';

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
        <div className="space-y-4">
            <h1 className="text-xl font-semibold text-slate-900">Prescriptions</h1>

            {loading && (
                <div className="flex justify-center py-12">
                    <Spinner className="h-6 w-6 text-[var(--accent)]" />
                </div>
            )}

            {!loading && error && <ErrorText>{error}</ErrorText>}

            {!loading && !error && items.length === 0 && (
                <Card className="py-10 text-center text-slate-500">
                    <p className="text-sm">No prescriptions yet.</p>
                </Card>
            )}

            {!loading && !error && items.length > 0 && (
                <ul className="space-y-3">
                    {items.map((rx) => (
                        <li key={rx.id}>
                            <Link to={`/prescriptions/${rx.id}`} className="block">
                                <Card>
                                    <p className="text-sm font-semibold text-slate-900">{formatDate(rx.date)}</p>
                                    <p className="text-sm text-slate-600">{rx.doctor_name || 'Doctor'}</p>
                                    {rx.medicines?.length > 0 && (
                                        <p className="mt-1 truncate text-xs text-slate-500">{rx.medicines.join(', ')}</p>
                                    )}
                                </Card>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
