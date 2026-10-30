import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';
import AppointmentCard from '../components/AppointmentCard';
import WaitlistCard from '../components/WaitlistCard';
import { EmptyState, ErrorText, Loading, PageHeader } from '../components/ui';
import { CalendarIcon, ChevronRightIcon } from '../components/icons';

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
        <div className="space-y-5">
            <PageHeader title="Visits" subtitle="Your appointments with the clinic." />

            <WaitlistCard />

            <div role="tablist" aria-label="Show visits" className="grid grid-cols-3 rounded-xl border border-slate-200 bg-white p-1">
                {FILTERS.map((f) => (
                    <button
                        key={f.key}
                        type="button"
                        role="tab"
                        aria-selected={filter === f.key}
                        onClick={() => setFilter(f.key)}
                        className={`min-h-[44px] rounded-lg px-3 text-sm transition ${
                            filter === f.key ? 'bg-slate-900 font-semibold text-white' : 'font-medium text-slate-700 hover:bg-slate-100'
                        }`}
                    >
                        {f.label}
                    </button>
                ))}
            </div>

            {loading && <Loading />}

            {!loading && error && <ErrorText>{error}</ErrorText>}

            {!loading && !error && items.length === 0 && <EmptyState icon={CalendarIcon} title={EMPTY_MESSAGES[filter]} />}

            {!loading && !error && items.length > 0 && (
                <ul className="space-y-3">
                    {items.map((appointment) => (
                        <li key={appointment.id}>
                            <Link
                                to={`/visits/${appointment.id}`}
                                className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:bg-slate-50"
                            >
                                <div className="min-w-0 flex-1">
                                    <AppointmentCard appointment={appointment} />
                                </div>
                                <ChevronRightIcon className="h-4 w-4 shrink-0 text-slate-400" />
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
