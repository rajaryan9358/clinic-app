import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';
import { formatDate, formatInstantTime, formatTime } from '../lib/format';
import { Alert, Badge, Button, ErrorText } from './ui';

/**
 * The Visits page "Waitlist" card: the acting profile's active entries
 * (`GET waitlist`, soonest first) with their place in line, an offered
 * entry highlighted with a "Book it" link to its offer page, and Leave
 * (inline confirm → `DELETE waitlist/{id}`). Renders nothing while there
 * are no active entries, so patients who never used the waitlist don't
 * see an empty section.
 */
export default function WaitlistCard() {
    const [entries, setEntries] = useState([]);
    const [error, setError] = useState('');
    const [confirmId, setConfirmId] = useState(null);
    const [leavingId, setLeavingId] = useState(null);
    const [leaveError, setLeaveError] = useState('');
    const [banner, setBanner] = useState('');
    const mounted = useRef(true);

    useEffect(() => {
        mounted.current = true;
        api.get('/waitlist')
            .then(({ data }) => {
                if (mounted.current) setEntries(data.data || []);
            })
            .catch((err) => {
                if (mounted.current) setError(err?.response?.data?.message || 'Could not load your waitlist.');
            });
        return () => {
            mounted.current = false;
        };
    }, []);

    async function leave(entry) {
        if (leavingId) return;
        setLeavingId(entry.id);
        setLeaveError('');
        try {
            await api.delete(`/waitlist/${entry.id}`);
            if (!mounted.current) return;
            setEntries((prev) => prev.filter((e) => e.id !== entry.id));
            setConfirmId(null);
            setBanner('You left the waitlist.');
        } catch (err) {
            if (mounted.current) setLeaveError(err?.response?.data?.message || 'Could not leave the waitlist.');
        } finally {
            if (mounted.current) setLeavingId(null);
        }
    }

    if (error) return <ErrorText>{error}</ErrorText>;
    if (entries.length === 0 && !banner) return null;

    return (
        <section aria-labelledby="waitlist-h" className="rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-4 py-3">
                <h2 id="waitlist-h" className="text-base font-semibold text-slate-900">
                    Waitlist
                </h2>
                <p className="text-sm text-slate-600">Times you're waiting for.</p>
            </div>
            {banner && (
                <div className={`px-4 pt-3 ${entries.length === 0 ? 'pb-4' : ''}`}>
                    <Alert tone="success">{banner}</Alert>
                </div>
            )}
            <ul className="divide-y divide-slate-100">
                {entries.map((entry) => {
                    const offered = entry.status === 'offered';
                    return (
                        <li key={entry.id} className="px-4 py-3">
                            <div className="flex items-start justify-between gap-3">
                                <Link to={`/waitlist/${entry.id}`} className="min-w-0 py-0.5">
                                    <p className="text-sm font-semibold text-slate-900">
                                        {formatDate(entry.date)} &middot; {formatTime(entry.start_time)}
                                    </p>
                                    <p className="truncate text-sm text-slate-600">
                                        {entry.doctor?.name || 'Doctor'}
                                        {entry.doctor?.specialization ? ` · ${entry.doctor.specialization}` : ''}
                                    </p>
                                </Link>
                                {offered ? (
                                    <Badge tone="amber">Held for you</Badge>
                                ) : (
                                    <Badge>{entry.position ? `#${entry.position} in line` : 'Waiting'}</Badge>
                                )}
                            </div>

                            {offered && (
                                <Link
                                    to={`/waitlist/${entry.id}`}
                                    className="mt-3 flex min-h-[48px] items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100"
                                >
                                    <span>Held for you until {formatInstantTime(entry.hold_expires_at)} — Book it</span>
                                    <span aria-hidden="true">&rarr;</span>
                                </Link>
                            )}

                            {confirmId === entry.id ? (
                                <div className="mt-3 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                                    <p className="text-sm text-slate-700">
                                        {offered ? 'Give up this held time and leave the waitlist?' : 'Leave the waitlist for this time?'}
                                    </p>
                                    <ErrorText>{leaveError}</ErrorText>
                                    <Button variant="danger" onClick={() => leave(entry)} loading={leavingId === entry.id}>
                                        Leave waitlist
                                    </Button>
                                    <Button
                                        variant="secondary"
                                        disabled={leavingId === entry.id}
                                        onClick={() => {
                                            setConfirmId(null);
                                            setLeaveError('');
                                        }}
                                    >
                                        Stay on it
                                    </Button>
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setConfirmId(entry.id);
                                        setLeaveError('');
                                        setBanner('');
                                    }}
                                    className="-ml-2 mt-1 min-h-[44px] rounded-lg px-2 text-sm font-semibold text-rose-700 hover:bg-rose-50"
                                >
                                    Leave
                                </button>
                            )}
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
