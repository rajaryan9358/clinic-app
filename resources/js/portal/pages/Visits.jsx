import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';
import AppointmentCard from '../components/AppointmentCard';
import WaitlistCard from '../components/WaitlistCard';
import { Card, ErrorText, Spinner } from '../components/ui';

const FILTERS = [
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'past', label: 'Past' },
    { key: 'all', label: 'All' },
];

const EMPTY_MESSAGES = {
    upcoming: 'No upcoming visits.',
    past: 'No past visits.',
    all: 'No visits yet. Book one to get started.',
};

/**
 * `GET appointments?filter=` list, scoped to the acting profile. The
 * filter is plain client state (not a URL param) — there's nothing else on
 * this page worth deep-linking to, and the default ("upcoming") is what a
 * patient almost always wants first. Active waitlist entries sit above
 * the list (WaitlistCard), independent of the filter.
 */
export default function Visits() {
    const [filter, setFilter] = useState('upcoming');
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        let active = true;
        setLoading(true);
        setError('');

        api.get('/appointments', { params: { filter } })
            .then(({ data }) => {
                if (active) setItems(data.data || []);
            })
            .catch((err) => {
                if (active) setError(err?.response?.data?.message || 'Could not load your visits.');
            })
            .finally(() => {
                if (active) setLoading(false);
            });

        return () => {
            active = false;
        };
    }, [filter]);

    return (
        <div className="space-y-4">
            <h1 className="text-xl font-semibold text-slate-900">Visits</h1>

            <WaitlistCard />

            <div className="flex gap-2">
                {FILTERS.map((f) => (
                    <button
                        key={f.key}
                        type="button"
                        onClick={() => setFilter(f.key)}
                        className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                            filter === f.key ? 'bg-[var(--accent)] text-white' : 'bg-slate-100 text-slate-600'
                        }`}
                    >
                        {f.label}
                    </button>
                ))}
            </div>

            {loading && (
                <div className="flex justify-center py-12">
                    <Spinner className="h-6 w-6 text-[var(--accent)]" />
                </div>
            )}

            {!loading && error && <ErrorText>{error}</ErrorText>}

            {!loading && !error && items.length === 0 && (
                <Card className="py-10 text-center text-slate-500">
                    <p className="text-sm">{EMPTY_MESSAGES[filter]}</p>
                </Card>
            )}

            {!loading && !error && items.length > 0 && (
                <ul className="space-y-3">
                    {items.map((appointment) => (
                        <li key={appointment.id}>
                            <Link to={`/visits/${appointment.id}`} className="block">
                                <Card>
                                    <AppointmentCard appointment={appointment} />
                                </Card>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
