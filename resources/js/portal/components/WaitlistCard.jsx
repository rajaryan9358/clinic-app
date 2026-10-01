import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';
import { formatDate, formatInstantTime, formatTime } from '../lib/format';
import { Button, Card, ErrorText } from './ui';

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
        <Card>
            <h2 className="mb-2 text-sm font-medium text-slate-500">Waitlist</h2>
            {banner && <div className="mb-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{banner}</div>}
            <ul className="divide-y divide-slate-100">
                {entries.map((entry) => {
                    const offered = entry.status === 'offered';
                    return (
                        <li key={entry.id} className="py-3 first:pt-0 last:pb-0">
                            <div className="flex items-start justify-between gap-2">
                                <Link to={`/waitlist/${entry.id}`} className="min-w-0">
                                    <p className="text-sm font-semibold text-slate-900">
                                        {formatDate(entry.date)} &middot; {formatTime(entry.start_time)}
                                    </p>
                                    <p className="truncate text-sm text-slate-600">
                                        {entry.doctor?.name || 'Doctor'}
                                        {entry.doctor?.specialization ? ` · ${entry.doctor.specialization}` : ''}
                                    </p>
                                </Link>
                                {offered ? (
                                    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                                        Held for you
                                    </span>
                                ) : (
                                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                                        {entry.position ? `#${entry.position} in line` : 'Waiting'}
                                    </span>
                                )}
                            </div>

                            {offered && (
                                <Link
                                    to={`/waitlist/${entry.id}`}
                                    className="mt-2 block rounded-xl bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 ring-1 ring-amber-200"
                                >
                                    Held for you until {formatInstantTime(entry.hold_expires_at)} — Book it &rarr;
                                </Link>
                            )}

                            {confirmId === entry.id ? (
                                <div className="mt-2 space-y-2">
                                    <p className="text-sm text-slate-600">
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
                                    className="mt-1 text-sm font-medium text-red-600"
                                >
                                    Leave
                                </button>
                            )}
                        </li>
                    );
                })}
            </ul>
        </Card>
    );
}
