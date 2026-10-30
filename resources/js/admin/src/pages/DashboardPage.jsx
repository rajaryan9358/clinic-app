import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useScope } from '../context/ScopeContext';
import LineChart from '../components/charts/LineChart';
import DonutChart from '../components/charts/DonutChart';
import BarListChart from '../components/charts/BarListChart';
import AppIcon from '../components/AppIcon';
import StatusBadge from '../components/StatusBadge';
import { Alert, Badge, btn, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import DoctorToday from './dashboards/DoctorToday';
import FrontDeskToday from './dashboards/FrontDeskToday';

// ── KPI card ──────────────────────────────────────────────────────────────────
function KpiCard({ label, value, icon, color = 'blue', suffix = '' }) {
    const tone = {
        blue: 'text-blue-600', emerald: 'text-emerald-600', amber: 'text-amber-600',
        red: 'text-rose-600', violet: 'text-violet-600', sky: 'text-sky-600',
    }[color] || 'text-blue-600';

    return (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3.5">
            <p className="flex items-center gap-2 text-xs font-medium text-slate-600">
                <AppIcon name={icon} className={`h-4 w-4 ${tone}`} />
                <span className="truncate">{label}</span>
            </p>
            <p className="mt-1.5 text-2xl font-bold text-slate-900 tabular-nums">
                {value ?? <span className="text-slate-300">—</span>}
                {suffix && value !== null && value !== undefined ? (
                    <span className="ml-0.5 text-sm font-medium text-slate-500">{suffix}</span>
                ) : null}
            </p>
        </div>
    );
}

// ── Alert card ─────────────────────────────────────────────────────────────────
function AlertCard({ alert }) {
    const severity = String(alert?.severity || 'low');
    const cfg = {
        high:   { icon: 'bg-rose-50 text-rose-700',   tone: 'red',   label: 'High' },
        medium: { icon: 'bg-amber-50 text-amber-700', tone: 'amber', label: 'Medium' },
        low:    { icon: 'bg-slate-100 text-slate-600', tone: 'slate', label: 'Low' },
    }[severity] || { icon: 'bg-slate-100 text-slate-600', tone: 'slate', label: severity };

    return (
        <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${cfg.icon}`}>
                <AppIcon name="alert-triangle" className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">{alert?.title}</h3>
                    <Badge tone={cfg.tone}>{cfg.label}</Badge>
                </div>
                {alert?.description ? <p className="mt-1 text-sm text-slate-600">{alert.description}</p> : null}
                {alert?.cta?.to ? (
                    <Link to={alert.cta.to} className={`${btn.link} mt-2 inline-flex items-center gap-1`}>
                        {alert.cta.label || 'Open'} <AppIcon name="arrow-right" className="h-3.5 w-3.5" />
                    </Link>
                ) : null}
            </div>
        </div>
    );
}

// ── Action card ────────────────────────────────────────────────────────────────
function ActionCard({ title, description, icon, actions }) {
    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-start gap-3">
                {icon && (
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                        <AppIcon name={icon} className="h-4 w-4" />
                    </span>
                )}
                <div className="min-w-0">
                    <h2 className="text-base font-semibold text-slate-900">{title}</h2>
                    {description ? <p className="mt-0.5 text-sm text-slate-600">{description}</p> : null}
                </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
                {(actions || []).map((a, i) => (
                    <Link key={a.to} to={a.to} className={i === 0 ? btn.primary : btn.secondary}>
                        {a.label}
                    </Link>
                ))}
            </div>
        </div>
    );
}

// ── Stat (raw key/value) ───────────────────────────────────────────────────────
function StatCard({ label, value }) {
    return (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-xs font-medium text-slate-600 first-letter:uppercase">{label}</p>
            <p className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">{value ?? <span className="text-slate-300">—</span>}</p>
        </div>
    );
}

// ── Activity list ─────────────────────────────────────────────────────────────
function ActivityList({ items }) {
    if (!items?.length) {
        return (
            <Card title="Recent activity" bodyClassName="">
                <EmptyState icon="activity" title="No recent activity" />
            </Card>
        );
    }
    return (
        <Card title="Recent activity" bodyClassName="">
            <ul className="divide-y divide-slate-100">
                {items.map((row) => (
                    <li key={row.id} className="flex items-center justify-between gap-4 px-5 py-3">
                        <div className="min-w-0">
                            <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">
                                <span className="capitalize">{String(row.module || '').replace(/_/g, ' ')}</span>
                                <StatusBadge status={row.action} />
                            </p>
                            <p className="mt-0.5 text-xs text-slate-600">{row.entity_type} #{row.entity_id}</p>
                        </div>
                        <p className="shrink-0 text-xs text-slate-500 tabular-nums">
                            {row.created_at ? String(row.created_at).replace('T', ' ').slice(0, 16) : ''}
                        </p>
                    </li>
                ))}
            </ul>
        </Card>
    );
}

// ── Section wrapper ────────────────────────────────────────────────────────────
function Section({ title, subtitle, children }) {
    return <Card title={title} description={subtitle} className="h-full">{children}</Card>;
}

// ── Followup mini-stats ────────────────────────────────────────────────────────
function FollowupStats({ insights }) {
    const fu = insights?.followup_insights || {};
    const tiles = [
        { label: 'Overdue', value: fu.overdue ?? '—', dot: 'bg-rose-500' },
        { label: 'Due today', value: fu.due_today ?? '—', dot: 'bg-amber-500' },
        { label: 'Done (7d)', value: fu.completion_rate_7d != null ? `${fu.completion_rate_7d}%` : '—', dot: 'bg-emerald-500' },
    ];
    return (
        <div className="grid grid-cols-3 gap-3">
            {tiles.map((t) => (
                <div key={t.label} className="rounded-xl border border-slate-200 px-3 py-3">
                    <p className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${t.dot}`} aria-hidden="true" />
                        <span className="truncate">{t.label}</span>
                    </p>
                    <p className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">{t.value}</p>
                </div>
            ))}
        </div>
    );
}

// ── Assistant dashboard ───────────────────────────────────────────────────────
function AssistantDashboard({ data }) {
    const kpis = data?.kpis || {};
    const upcoming = data?.upcoming || [];
    const statusBreakdown = data?.status_breakdown || [];

    const statusCfg = {
        pending:         { label: 'Not confirmed', tone: 'amber' },
        confirmed:       { label: 'Confirmed',     tone: 'blue' },
        checked_in:      { label: 'Checked in',    tone: 'violet' },
        in_consultation: { label: 'With doctor',   tone: 'teal' },
        completed:       { label: 'Completed',     tone: 'green' },
        no_show:         { label: 'No-show',       tone: 'slate' },
        cancelled:       { label: 'Cancelled',     tone: 'red' },
    };

    const fmtTime = (t) => {
        if (!t) return '—';
        try {
            const [h, m] = String(t).split(':');
            const d = new Date();
            d.setHours(+h, +m, 0);
            return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        } catch { return t; }
    };

    const dateLabel = (() => {
        try {
            return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
        } catch { return new Date().toLocaleDateString(); }
    })();

    return (
        <div className="mx-auto max-w-[1400px] space-y-5">
            <PageHeader
                title="Today"
                subtitle={dateLabel}
                actions={(
                    <>
                        <Link to="/modules/patients/new" className={btn.secondary}>
                            <AppIcon name="user-plus" className="h-4 w-4" /> New patient
                        </Link>
                        <Link to="/workflows/appointments/new" className={btn.primary}>
                            <AppIcon name="calendar-plus" className="h-4 w-4" /> New appointment
                        </Link>
                    </>
                )}
            />

            {/* KPIs */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <KpiCard label="Total today"     value={kpis.total_today}      icon="calendar"   color="blue" />
                <KpiCard label="Waiting"         value={kpis.waiting}          icon="bell"       color="amber" />
                <KpiCard label="Checked in"      value={kpis.checked_in}       icon="user-check" color="violet" />
                <KpiCard label="With doctor"     value={kpis.in_consultation}  icon="stethoscope" color="sky" />
                <KpiCard label="Completed"       value={kpis.completed}        icon="check"      color="emerald" />
                <KpiCard label="No-show"         value={kpis.no_show}          icon="alert-triangle" color="red" />
                <KpiCard label="Cancelled"       value={kpis.cancelled}        icon="close"      color="red" />
                <KpiCard label="New patients"    value={kpis.new_patients_today} icon="user-plus" color="sky" />
            </div>

            <div className="grid gap-5 lg:grid-cols-5">
                {/* Upcoming list */}
                <div className="lg:col-span-3">
                    <Card
                        title="Up next today"
                        description="Pending, confirmed, or checked-in appointments"
                        actions={<Link to="/workflows/appointments" className={btn.link}>View all</Link>}
                        bodyClassName=""
                        className="h-full"
                    >
                        {upcoming.length === 0 ? (
                            <EmptyState icon="calendar" title="No upcoming appointments for today" />
                        ) : (
                            <ul className="divide-y divide-slate-100">
                                {upcoming.map((appt) => {
                                    const cfg = statusCfg[appt.status] || statusCfg.pending;
                                    return (
                                        <li key={appt.id}>
                                            <Link
                                                to={`/workflows/appointments?open=${appt.id}`}
                                                className="flex items-center gap-4 px-5 py-3 transition hover:bg-slate-50"
                                            >
                                                <span className="w-16 shrink-0 text-sm font-bold text-slate-900 tabular-nums">{fmtTime(appt.start_time)}</span>
                                                <span className="min-w-0 flex-1">
                                                    <span className="block truncate text-sm font-semibold text-slate-900">{appt.patient_name || '—'}</span>
                                                    <span className="block truncate text-xs text-slate-600">{appt.doctor_name}</span>
                                                </span>
                                                <Badge tone={cfg.tone}>{cfg.label}</Badge>
                                            </Link>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </Card>
                </div>

                {/* Status donut */}
                <div className="lg:col-span-2">
                    <DonutChart
                        title="Today’s status"
                        subtitle="Appointment breakdown by status."
                        items={statusBreakdown}
                        valueKey="count"
                    />
                </div>
            </div>
        </div>
    );
}

// ── Main ──────────────────────────────────────────────────────────────────────
const DASHBOARD_VIEWS = [
    { key: 'admin', perm: 'dashboard.admin', label: 'Clinic overview' },
    { key: 'front', perm: 'dashboard.receptionist', label: 'Front desk' },
    { key: 'assistant', perm: 'dashboard.assistant', label: 'Assistant' },
];
const VIEW_STORAGE_KEY = 'today_view';

function ViewTabs({ views, value, onChange }) {
    if (views.length < 2) return null;
    return (
        <div role="tablist" aria-label="Dashboard" className="mb-5 inline-flex rounded-xl border border-slate-200 bg-white p-1">
            {views.map((v) => (
                <button
                    key={v.key}
                    type="button"
                    role="tab"
                    aria-selected={value === v.key}
                    onClick={() => onChange(v.key)}
                    className={`h-8 rounded-lg px-3 text-sm ${value === v.key ? 'bg-slate-900 font-semibold text-white' : 'text-slate-700 hover:bg-slate-100'}`}
                >
                    {v.label}
                </button>
            ))}
        </div>
    );
}

export default function DashboardPage() {
    const { user } = useAuth();
    const { context, ready, can, roleKind } = useScope() || {};
    const [data, setData] = useState(null);
    const [error, setError] = useState('');

    const base = useMemo(() => (user?.role === 'super_admin' ? '/super-admin' : '/clinic'), [user]);
    const isSuperAdmin = user?.role === 'super_admin';
    const allowed = (permission) => (typeof can === 'function' ? can(permission) : false);
    // Each role-specific dashboard is gated by its own permission on the API
    // (dashboard.admin / .receptionist / .assistant). Anyone holding none of
    // them falls back to the summary view, which every clinic user may read.
    // A role may hold several of them (the super admin decides); each one it
    // holds becomes a tab, and the choice is remembered per browser.
    // Doctor-kind roles (set on the role by the super admin) also get their
    // own day, listed first.
    const views = isSuperAdmin ? [] : [
        ...(roleKind === 'doctor' ? [{ key: 'doctor', label: 'My day' }] : []),
        ...DASHBOARD_VIEWS.filter((v) => allowed(v.perm)),
    ];
    const [picked, setPicked] = useState(() => {
        try { return localStorage.getItem(VIEW_STORAGE_KEY) || ''; } catch { return ''; }
    });
    const view = views.find((v) => v.key === picked)?.key || views[0]?.key || null;
    const pickView = (key) => {
        setPicked(key);
        try { localStorage.setItem(VIEW_STORAGE_KEY, key); } catch { /* storage unavailable */ }
    };
    const isClinicAdmin = view === 'admin';
    const isReceptionist = view === 'front';
    const isAssistant = view === 'assistant';
    const isDoctorDay = view === 'doctor';
    const activeDoctorId = context?.active_doctor_id ?? null;

    useEffect(() => {
        // Don't fetch until permissions are known (or the caller is super_admin,
        // whose branch never depends on it): otherwise this fires once for
        // the generic/summary endpoint while roleKind is still unresolved,
        // then again for the real per-role endpoint once it resolves — two
        // in-flight requests whose responses can land out of order and leave
        // `data` shaped for the wrong dashboard.
        if (!isSuperAdmin && !ready) return;
        // The front desk and doctor Today screens load their own live data.
        if (isReceptionist || isDoctorDay) return;

        let cancelled = false;
        const load = async () => {
            setError('');
            setData(null);
            try {
                let url;
                if (isReceptionist) {
                    url = `${base}/dashboard/receptionist`;
                } else if (isAssistant) {
                    url = `${base}/dashboard/assistant`;
                } else if (isClinicAdmin) {
                    url = `${base}/dashboard/clinic-admin`;
                } else {
                    url = `${base}/dashboard/summary`;
                }
                const res = await client.get(url);
                if (cancelled) return;
                setData(res.data.data);
            } catch (err) {
                if (cancelled) return;
                setError(err?.response?.data?.message || 'Failed to load dashboard');
            }
        };
        load();
        return () => {
            cancelled = true;
        };
    }, [base, isSuperAdmin, isClinicAdmin, isReceptionist, isAssistant, isDoctorDay, activeDoctorId, ready]);

    const withTabs = (node) => (
        <>
            <ViewTabs views={views} value={view} onChange={pickView} />
            {node}
        </>
    );

    if (ready && isDoctorDay) {
        return withTabs(<DoctorToday />);
    }

    if (ready && isReceptionist) {
        return withTabs(<FrontDeskToday />);
    }

    if (error) {
        return withTabs(<Alert tone="error">{error}</Alert>);
    }

    if (!data) {
        return withTabs(
            <div className="flex flex-col items-center gap-3 py-20">
                <Spinner className="" />
                <p className="text-sm text-slate-600">Loading dashboard…</p>
            </div>
        );
    }

    // ── Assistant dashboard ───────────────────────────────────────────────────
    if (isAssistant) {
        return withTabs(<AssistantDashboard data={data} />);
    }

    // ── Clinic Admin dashboard ─────────────────────────────────────────────────
    if (isClinicAdmin) {
        const kpis = data?.kpis || {};
        const today = data?.today || {};
        const trends = data?.trends || {};
        const insights = data?.insights || {};
        const alerts = data?.alerts || [];

        const bookingSources = (insights.booking_sources_30d || []).map((x) => ({ label: x.source, count: x.count }));
        const doctors = (insights.doctor_performance_30d || []).map((x) => ({ label: x.doctor_name, count: x.total }));

        return withTabs(
            <div className="mx-auto max-w-[1400px] space-y-5">
                {/* Page header */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight text-slate-900">How the clinic is doing</h1>
                        <p className="mt-0.5 text-sm text-slate-500">Today’s numbers, trends and anything that needs your attention.</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <Link to="/modules/patients/new" className={btn.secondary}>
                            <AppIcon name="user-plus" className="h-4 w-4" /> New patient
                        </Link>
                        <Link to="/workflows/appointments/new" className={btn.primary}>
                            <AppIcon name="calendar-plus" className="h-4 w-4" /> New appointment
                        </Link>
                    </div>
                </div>

                {/* KPIs */}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
                    <KpiCard label="Today's Appointments" value={kpis.today_appointments} icon="calendar" color="blue" />
                    <KpiCard label="Completed Today" value={kpis.today_completed} icon="check" color="emerald" />
                    <KpiCard label="In Progress" value={kpis.today_pending} icon="activity" color="violet" />
                    <KpiCard label="New Patients (30d)" value={kpis.new_patients_30d} icon="user-plus" color="sky" />
                    <KpiCard label="Upcoming (7d)" value={kpis.upcoming_7d_appointments} icon="calendar" color="blue" />
                    <KpiCard label="Appointments (30d)" value={kpis.appointments_30d} icon="chart-bar" color="blue" />
                    <KpiCard label="No-show Rate (30d)" value={kpis.no_show_rate_30d} icon="alert-triangle" color="amber" suffix="%" />
                    <KpiCard label="Cancel Rate (30d)" value={kpis.cancel_rate_30d} icon="close" color="red" suffix="%" />
                    <KpiCard label="Follow-ups Overdue" value={kpis.followups_overdue} icon="clipboard-check" color="red" />
                    <KpiCard label="Follow-ups Due Today" value={kpis.followups_due_today} icon="clipboard-check" color="amber" />
                </div>

                {/* Today's status + followup health */}
                <div className="grid gap-5 lg:grid-cols-2">
                    <DonutChart
                        title="Appointment status (today)"
                        subtitle="Distribution of today's appointments by status."
                        items={(today.appointment_status || []).map((x) => ({ label: x.status, count: x.count }))}
                    />
                    <Section title="Follow-up health" subtitle="Operational follow-up metrics.">
                        <FollowupStats insights={insights} />
                        <div className="mt-4 flex flex-wrap gap-2">
                            <Link to="/modules/followups" className={btn.primary}>
                                Open follow-ups
                            </Link>
                            <Link to="/workflows/appointments" className={btn.secondary}>
                                Appointments
                            </Link>
                        </div>
                    </Section>
                </div>

                {/* Trends */}
                <LineChart
                    title="Trends"
                    subtitle="30-day daily appointment volume."
                    data={trends.appointments_30d || []}
                    xKey="date"
                    yKey="count"
                />

                {/* Insights */}
                <div className="grid gap-5 lg:grid-cols-3">
                    <BarListChart
                        title="Doctor performance (30d)"
                        subtitle="Top by appointment volume."
                        items={doctors}
                        labelKey="label"
                        valueKey="count"
                        maxItems={8}
                    />
                    <DonutChart
                        title="New vs repeat (30d)"
                        subtitle="Patient visit type breakdown."
                        items={insights.new_vs_repeat_30d || []}
                        valueKey="count"
                    />
                    {bookingSources.length > 0 && (
                        <BarListChart
                            title="Booking sources (30d)"
                            subtitle="Channels driving appointment bookings."
                            items={bookingSources}
                            labelKey="label"
                            valueKey="count"
                            maxItems={10}
                        />
                    )}
                </div>

                {/* Alerts */}
                {alerts.length > 0 && (
                    <Section title="Needs attention" subtitle="Items requiring attention.">
                        <div className="grid gap-3 sm:grid-cols-2">
                            {alerts.map((a, idx) => (
                                <AlertCard key={`${a.title}:${idx}`} alert={a} />
                            ))}
                        </div>
                    </Section>
                )}
            </div>
        );
    }

    // ── Super Admin / summary (doctors, custom roles) ─────────────────────────
    // Only offer shortcuts to pages this user can open.
    const startOfDayActions = [
        allowed('appointments.create') && { to: '/workflows/appointments/new', label: 'New appointment' },
        allowed('appointments.view') && { to: '/workflows/appointments', label: 'Appointments' },
        allowed('followups.view') && { to: '/modules/followups', label: 'Follow-ups' },
    ].filter(Boolean);
    const teamActions = [
        allowed('staff.create') && { to: '/workflows/create-staff', label: 'Add staff' },
        allowed('doctors.create') && { to: '/workflows/setup-doctor', label: 'Add doctor' },
    ].filter(Boolean);

    return (
        <div className="mx-auto max-w-[1400px] space-y-5">
            <PageHeader
                title={isSuperAdmin ? 'Super admin overview' : 'Dashboard'}
                subtitle={isSuperAdmin
                    ? 'Onboard clinics, manage access, and monitor the network.'
                    : 'Run daily workflows: appointments, patients, billing, and communication.'}
                actions={!isSuperAdmin && (allowed('patients.create') || allowed('appointments.create')) ? (
                    <>
                        {allowed('patients.create') && (
                            <Link to="/modules/patients/new" className={btn.secondary}>
                                <AppIcon name="user-plus" className="h-4 w-4" /> New patient
                            </Link>
                        )}
                        {allowed('appointments.create') && (
                            <Link to="/workflows/appointments/new" className={btn.primary}>
                                <AppIcon name="calendar-plus" className="h-4 w-4" /> New appointment
                            </Link>
                        )}
                    </>
                ) : null}
            />

            {/* Quick action cards */}
            <div className={isSuperAdmin ? 'grid gap-4' : 'grid gap-4 sm:grid-cols-2'}>
                {isSuperAdmin ? (
                    <ActionCard
                        title="Clinic onboarding"
                        description="Guided flow to create a clinic and admin access."
                        icon="hospital"
                        actions={[
                            { to: '/workflows/onboard-clinic', label: 'Onboard new clinic' },
                            { to: '/workflows/clinics', label: 'View clinics' },
                        ]}
                    />
                ) : (
                    startOfDayActions.length > 0 && (
                        <ActionCard
                            title="Start of day"
                            description="Jump into today's appointments and tasks."
                            icon="calendar"
                            actions={startOfDayActions}
                        />
                    )
                )}

                {!isSuperAdmin && teamActions.length > 0 && (
                    <ActionCard
                        title="Team management"
                        description="Add staff and doctors to your clinic."
                        icon="users"
                        actions={teamActions}
                    />
                )}
            </div>

            {/* Summary stats */}
            {isSuperAdmin ? (
                <div className="space-y-5">
                    <Section title="Network" subtitle="High-level platform counts.">
                        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                            <StatCard label="Total clinics" value={data.total_clinics} />
                            <StatCard label="Onboarded today" value={data.today_clinic_onboarding} />
                            <StatCard label="Total staff" value={data.total_staff} />
                            <StatCard label="Total doctors" value={data.total_doctors} />
                        </div>
                    </Section>

                    <Section title="Patients and appointments" subtitle="Totals and today's activity.">
                        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                            <StatCard label="Total patients" value={data.total_patients} />
                            <StatCard label="Patients today" value={data.today_patients} />
                            <StatCard label="Total appointments" value={data.total_appointments} />
                            <StatCard label="Appointments today" value={data.today_appointments} />
                        </div>
                    </Section>

                    <Section title="WhatsApp" subtitle="Conversation and booking activity.">
                        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                            <StatCard label="Total conversations" value={data.total_whatsapp_conversations} />
                            <StatCard label="Conversations today" value={data.today_whatsapp_conversations} />
                            <StatCard label="Total WhatsApp appointments" value={data.total_whatsapp_appointments} />
                            <StatCard label="WhatsApp appointments today" value={data.today_whatsapp_appointments} />
                        </div>
                    </Section>
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
                    {Object.entries(data)
                        .filter(([k, v]) => k !== 'recent_activity' && (typeof v === 'number' || typeof v === 'string'))
                        .map(([key, value]) => (
                            <StatCard key={key} label={key.replaceAll('_', ' ')} value={value} />
                        ))}
                </div>
            )}

            {/* Recent activity */}
            {!isSuperAdmin && data.recent_activity ? (
                <ActivityList items={data.recent_activity} />
            ) : null}
        </div>
    );
}
