import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';
import { useSession } from '../session';
import AppointmentCard from '../components/AppointmentCard';
import { Card, ErrorText, Spinner } from '../components/ui';

function QuickAction({ to, label, badge }) {
    return (
        <Link to={to} className="block">
            <Card className="flex h-full items-center justify-between">
                <span className="text-sm font-medium text-slate-900">{label}</span>
                {typeof badge === 'number' && badge > 0 ? (
                    <span className="rounded-full bg-[var(--accent)]/10 px-2 py-0.5 text-xs font-semibold text-[var(--accent)]">
                        {badge}
                    </span>
                ) : null}
            </Card>
        </Link>
    );
}

/**
 * The portal home screen: next appointment (if any), quick actions, and
 * headline counts, all from `GET dashboard` (scoped to the acting
 * profile — see DashboardController).
 */
export default function Home() {
    const { activeProfile, me } = useSession();
    const [dashboard, setDashboard] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        let active = true;
        setLoading(true);
        setError('');

        api.get('/dashboard')
            .then(({ data }) => {
                if (active) setDashboard(data.data);
            })
            .catch((err) => {
                if (active) setError(err?.response?.data?.message || 'Could not load your dashboard.');
            })
            .finally(() => {
                if (active) setLoading(false);
            });

        return () => {
            active = false;
        };
    }, []);

    const firstName = (activeProfile?.full_name || me?.account?.full_name || 'there').split(' ')[0];
    const next = dashboard?.next_appointment;

    return (
        <div className="space-y-4">
            <div>
                <p className="text-sm text-slate-500">Hello,</p>
                <h1 className="text-xl font-semibold text-slate-900">{firstName}</h1>
            </div>

            {loading && (
                <div className="flex justify-center py-12">
                    <Spinner className="h-6 w-6 text-[var(--accent)]" />
                </div>
            )}

            {!loading && error && <ErrorText>{error}</ErrorText>}

            {!loading && !error && (
                <>
                    <Card>
                        <h2 className="mb-2 text-sm font-medium text-slate-500">Next appointment</h2>
                        {next ? (
                            <Link to={`/visits/${next.id}`} className="block">
                                <AppointmentCard appointment={next} />
                            </Link>
                        ) : (
                            <p className="text-sm text-slate-500">No upcoming appointments. Book a visit to get started.</p>
                        )}
                    </Card>

                    <div className="grid grid-cols-2 gap-3">
                        <QuickAction to="/book" label="Book a visit" />
                        <QuickAction to="/visits" label="Visits" badge={dashboard?.upcoming_count} />
                        <QuickAction to="/prescriptions" label="Prescriptions" badge={dashboard?.finalized_prescriptions_count} />
                        <QuickAction to="/family" label="Family" />
                    </div>
                </>
            )}
        </div>
    );
}
