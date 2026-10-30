import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';
import { useSession } from '../session';
import AppointmentCard from '../components/AppointmentCard';
import { Badge, Card, ErrorText, Loading, PageHeader } from '../components/ui';
import { CalendarIcon, ChevronRightIcon, PillIcon, PlusIcon, UsersIcon } from '../components/icons';

function QuickAction({ to, label, hint, icon: Icon, badge }) {
    return (
        <Link
            to={to}
            className="flex min-h-[104px] flex-col justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:bg-slate-50 active:scale-[0.99]"
        >
            <span className="flex items-start justify-between gap-2">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
                    <Icon className="h-5 w-5" />
                </span>
                {typeof badge === 'number' && badge > 0 ? <Badge tone="accent">{badge}</Badge> : null}
            </span>
            <span>
                <span className="block text-sm font-semibold text-slate-900">{label}</span>
                {hint ? <span className="block text-xs text-slate-600">{hint}</span> : null}
            </span>
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
        <div className="space-y-5">
            <PageHeader eyebrow="Hello," title={firstName} />

            {loading && <Loading />}

            {!loading && error && <ErrorText>{error}</ErrorText>}

            {!loading && !error && (
                <>
                    <section aria-labelledby="next-h">
                        <h2 id="next-h" className="mb-2 text-sm font-semibold text-slate-900">
                            Next appointment
                        </h2>
                        {next ? (
                            <Link
                                to={`/visits/${next.id}`}
                                className="block rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:bg-slate-50"
                            >
                                <AppointmentCard appointment={next} />
                                <span className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-sm font-semibold text-[var(--accent)]">
                                    View details
                                    <ChevronRightIcon className="h-4 w-4" />
                                </span>
                            </Link>
                        ) : (
                            <Card className="p-5">
                                <p className="text-sm text-slate-600">No upcoming appointments. Book a visit to get started.</p>
                            </Card>
                        )}
                    </section>

                    <section aria-labelledby="quick-h">
                        <h2 id="quick-h" className="mb-2 text-sm font-semibold text-slate-900">
                            Quick actions
                        </h2>
                        <div className="grid grid-cols-2 gap-3">
                            <QuickAction to="/book" label="Book a visit" hint="Pick a doctor and time" icon={PlusIcon} />
                            <QuickAction to="/visits" label="Visits" hint="Upcoming and past" icon={CalendarIcon} badge={dashboard?.upcoming_count} />
                            <QuickAction
                                to="/prescriptions"
                                label="Prescriptions"
                                hint="View and download"
                                icon={PillIcon}
                                badge={dashboard?.finalized_prescriptions_count}
                            />
                            <QuickAction to="/family" label="Family" hint="Switch or add profiles" icon={UsersIcon} />
                        </div>
                    </section>
                </>
            )}
        </div>
    );
}
