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

// ── KPI card ──────────────────────────────────────────────────────────────────
function KpiCard({ label, value, icon, color = 'blue', suffix = '' }) {
    const colorMap = {
        blue:    { bg: 'bg-blue-50',    icon: 'text-blue-600',    val: 'text-blue-700' },
        emerald: { bg: 'bg-emerald-50', icon: 'text-emerald-600', val: 'text-emerald-700' },
        amber:   { bg: 'bg-amber-50',   icon: 'text-amber-600',   val: 'text-amber-700' },
        red:     { bg: 'bg-red-50',     icon: 'text-red-600',     val: 'text-red-700' },
        violet:  { bg: 'bg-violet-50',  icon: 'text-violet-600',  val: 'text-violet-700' },
        sky:     { bg: 'bg-sky-50',     icon: 'text-sky-600',     val: 'text-sky-700' },
    };
    const c = colorMap[color] || colorMap.blue;

    return (
        <div className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl ${c.bg}`}>
                <AppIcon name={icon} className={`h-5 w-5 ${c.icon}`} />
            </div>
            <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</p>
                <p className={`mt-0.5 text-2xl font-bold ${c.val}`}>
                    {value ?? <span className="text-gray-300">—</span>}
                    {suffix && value !== null && value !== undefined ? (
                        <span className="ml-0.5 text-sm font-medium text-gray-400">{suffix}</span>
                    ) : null}
                </p>
            </div>
        </div>
    );
}

// ── Alert card ─────────────────────────────────────────────────────────────────
function AlertCard({ alert }) {
    const severity = String(alert?.severity || 'low');
    const cfg = {
        high:   { border: 'border-red-200 bg-red-50',    icon: 'text-red-500',    badge: 'bg-red-100 text-red-700' },
        medium: { border: 'border-amber-200 bg-amber-50', icon: 'text-amber-500', badge: 'bg-amber-100 text-amber-700' },
        low:    { border: 'border-gray-200 bg-gray-50',   icon: 'text-gray-400',  badge: 'bg-gray-100 text-gray-600' },
    }[severity] || { border: 'border-gray-200 bg-gray-50', icon: 'text-gray-400', badge: 'bg-gray-100 text-gray-600' };

    return (
        <div className={`rounded-xl border p-4 ${cfg.border}`}>
            <div className="flex items-start gap-3">
                <AppIcon name="alert-triangle" className={`mt-0.5 h-4 w-4 flex-shrink-0 ${cfg.icon}`} />
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-sm font-semibold text-gray-900">{alert?.title}</h4>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${cfg.badge}`}>{severity}</span>
                    </div>
                    {alert?.description ? <p className="mt-1 text-sm text-gray-600">{alert.description}</p> : null}
                </div>
                {alert?.cta?.to ? (
                    <Link
                        to={alert.cta.to}
                        className="flex-shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                    >
                        {alert.cta.label || 'Open'}
                    </Link>
                ) : null}
            </div>
        </div>
    );
}

// ── Action card ────────────────────────────────────────────────────────────────
function ActionCard({ title, description, icon, actions }) {
    return (
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3">
                {icon && (
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-blue-50">
                        <AppIcon name={icon} className="h-5 w-5 text-blue-600" />
                    </div>
                )}
                <div>
                    <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
                    {description ? <p className="mt-0.5 text-sm text-gray-500">{description}</p> : null}
                </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
                {(actions || []).map((a, i) => (
                    <Link
                        key={a.to}
                        to={a.to}
                        className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                            i === 0
                                ? 'bg-blue-600 text-white hover:bg-blue-700'
                                : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                        }`}
                    >
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
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</p>
            <p className="mt-1 text-xl font-bold text-gray-900">{value ?? <span className="text-gray-300">—</span>}</p>
        </div>
    );
}

// ── Activity list ─────────────────────────────────────────────────────────────
function ActivityList({ items }) {
    if (!items?.length) {
        return (
            <div className="rounded-xl border border-gray-200 bg-white p-5 text-center">
                <p className="text-sm text-gray-400">No recent activity.</p>
            </div>
        );
    }
    return (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-5 py-4">
                <h3 className="text-sm font-semibold text-gray-900">Recent Activity</h3>
            </div>
            <div className="divide-y divide-gray-100">
                {items.map((row) => (
                    <div key={row.id} className="flex items-center justify-between gap-4 px-5 py-3">
                        <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-gray-800">
                                <span className="text-gray-500">{row.module}</span>
                                {' · '}
                                <StatusBadge status={row.action} />
                            </p>
                            <p className="mt-0.5 text-xs text-gray-400">{row.entity_type} #{row.entity_id}</p>
                        </div>
                        <p className="flex-shrink-0 text-xs text-gray-400">
                            {row.created_at ? String(row.created_at).replace('T', ' ').slice(0, 16) : ''}
                        </p>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ── Section wrapper ────────────────────────────────────────────────────────────
function Section({ title, subtitle, children }) {
    return (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-5 py-4">
                <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
                {subtitle ? <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p> : null}
            </div>
            <div className="p-5">{children}</div>
        </div>
    );
}

// ── Followup mini-stats ────────────────────────────────────────────────────────
function FollowupStats({ insights }) {
    const fu = insights?.followup_insights || {};
    return (
        <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-red-50 border border-red-100 p-4 text-center">
                <p className="text-xs font-semibold uppercase tracking-wide text-red-500">Overdue</p>
                <p className="mt-1 text-2xl font-bold text-red-700">{fu.overdue ?? '—'}</p>
            </div>
            <div className="rounded-xl bg-amber-50 border border-amber-100 p-4 text-center">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-600">Due Today</p>
                <p className="mt-1 text-2xl font-bold text-amber-700">{fu.due_today ?? '—'}</p>
            </div>
            <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-4 text-center">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">Done (7d)</p>
                <p className="mt-1 text-2xl font-bold text-emerald-700">
                    {fu.completion_rate_7d != null ? `${fu.completion_rate_7d}%` : '—'}
                </p>
            </div>
        </div>
    );
}

// ── Receptionist dashboard ────────────────────────────────────────────────────
function ReceptionistDashboard({ data }) {
    const kpis = data?.kpis || {};
    const upcoming = data?.upcoming || [];
    const statusBreakdown = data?.status_breakdown || [];

    const statusCfg = {
        pending:         { label: 'Pending',         bg: 'bg-amber-50',   text: 'text-amber-700',   dot: 'bg-amber-400' },
        confirmed:       { label: 'Confirmed',        bg: 'bg-blue-50',    text: 'text-blue-700',    dot: 'bg-blue-500' },
        checked_in:      { label: 'Checked In',       bg: 'bg-violet-50',  text: 'text-violet-700',  dot: 'bg-violet-500' },
        in_consultation: { label: 'In Consultation',  bg: 'bg-indigo-50',  text: 'text-indigo-700',  dot: 'bg-indigo-500' },
        completed:       { label: 'Completed',        bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
        no_show:         { label: 'No Show',          bg: 'bg-red-50',     text: 'text-red-700',     dot: 'bg-red-400' },
        cancelled:       { label: 'Cancelled',        bg: 'bg-gray-100',   text: 'text-gray-500',    dot: 'bg-gray-400' },
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
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-xl font-bold text-gray-900">Front Desk</h1>
                    <p className="mt-0.5 text-sm text-gray-500">{dateLabel}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Link to="/modules/patients/new" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                        + New Patient
                    </Link>
                    <Link to="/workflows/appointments/new" className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                        + New Appointment
                    </Link>
                </div>
            </div>

            {/* KPI row */}
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-4 lg:grid-cols-4">
                <KpiCard label="Total Today"      value={kpis.total_today}     icon="calendar"        color="blue" />
                <KpiCard label="Waiting"          value={kpis.waiting}         icon="clock"           color="amber" />
                <KpiCard label="Checked In"       value={kpis.checked_in}      icon="user-check"      color="violet" />
                <KpiCard label="In Consultation"  value={kpis.in_consultation} icon="activity"        color="sky" />
                <KpiCard label="Completed"        value={kpis.completed}       icon="check"           color="emerald" />
                <KpiCard label="No Show"          value={kpis.no_show}         icon="user-x"          color="red" />
                <KpiCard label="Cancelled"        value={kpis.cancelled}       icon="close"           color="red" />
                <KpiCard label="New Patients"     value={kpis.new_patients_today} icon="user-plus"    color="sky" />
            </div>

            <div className="grid gap-5 lg:grid-cols-5">
                {/* Upcoming appointments */}
                <div className="lg:col-span-3 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                    <div className="border-b border-gray-100 px-5 py-4 flex items-center justify-between">
                        <div>
                            <h3 className="text-sm font-semibold text-gray-900">Up Next Today</h3>
                            <p className="mt-0.5 text-xs text-gray-400">Upcoming appointments — pending, confirmed, or checked in</p>
                        </div>
                        <Link to="/workflows/appointments" className="text-xs font-semibold text-blue-600 hover:underline">
                            View all
                        </Link>
                    </div>
                    {upcoming.length === 0 ? (
                        <div className="px-5 py-10 text-center text-sm text-gray-400">No upcoming appointments for today.</div>
                    ) : (
                        <div className="divide-y divide-gray-100">
                            {upcoming.map((appt) => {
                                const cfg = statusCfg[appt.status] || statusCfg.pending;
                                return (
                                    <Link
                                        key={appt.id}
                                        to={`/workflows/appointments?open=${appt.id}`}
                                        className="flex items-center gap-4 px-5 py-3 hover:bg-gray-50 transition"
                                    >
                                        <div className="flex-shrink-0 w-14 text-center">
                                            <span className="text-sm font-bold text-gray-800">{fmtTime(appt.start_time)}</span>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-semibold text-gray-900 truncate">{appt.patient_name || '—'}</p>
                                            <p className="text-xs text-gray-400 truncate">{appt.doctor_name}</p>
                                        </div>
                                        <div className={`flex-shrink-0 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${cfg.bg} ${cfg.text}`}>
                                            <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
                                            {cfg.label}
                                        </div>
                                    </Link>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Status breakdown */}
                <div className="lg:col-span-2">
                    <DonutChart
                        title="Today's Status"
                        subtitle="Appointment breakdown by status."
                        items={statusBreakdown}
                        valueKey="count"
                    />
                </div>
            </div>
        </div>
    );
}

// ── Assistant dashboard ───────────────────────────────────────────────────────
function AssistantDashboard({ data }) {
    const kpis = data?.kpis || {};
    const upcoming = data?.upcoming || [];
    const statusBreakdown = data?.status_breakdown || [];

    const statusCfg = {
        pending:         { label: 'Pending',        bg: 'bg-amber-50',   text: 'text-amber-700',   dot: 'bg-amber-400' },
        confirmed:       { label: 'Confirmed',       bg: 'bg-blue-50',    text: 'text-blue-700',    dot: 'bg-blue-500' },
        checked_in:      { label: 'Checked In',      bg: 'bg-violet-50',  text: 'text-violet-700',  dot: 'bg-violet-500' },
        in_consultation: { label: 'In Consultation', bg: 'bg-indigo-50',  text: 'text-indigo-700',  dot: 'bg-indigo-500' },
        completed:       { label: 'Completed',       bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
        no_show:         { label: 'No Show',         bg: 'bg-red-50',     text: 'text-red-700',     dot: 'bg-red-400' },
        cancelled:       { label: 'Cancelled',       bg: 'bg-gray-100',   text: 'text-gray-500',    dot: 'bg-gray-400' },
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
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-xl font-bold text-gray-900">Today</h1>
                    <p className="mt-0.5 text-sm text-gray-500">{dateLabel}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Link to="/modules/patients/new" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                        + New Patient
                    </Link>
                    <Link to="/workflows/appointments/new" className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                        + New Appointment
                    </Link>
                </div>
            </div>

            {/* KPIs */}
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
                <KpiCard label="Total Today"     value={kpis.total_today}      icon="calendar"   color="blue" />
                <KpiCard label="Waiting"         value={kpis.waiting}          icon="clock"      color="amber" />
                <KpiCard label="Checked In"      value={kpis.checked_in}       icon="user-check" color="violet" />
                <KpiCard label="In Consultation" value={kpis.in_consultation}  icon="activity"   color="sky" />
                <KpiCard label="Completed"       value={kpis.completed}        icon="check"      color="emerald" />
                <KpiCard label="No Show"         value={kpis.no_show}          icon="user-x"     color="red" />
                <KpiCard label="Cancelled"       value={kpis.cancelled}        icon="close"      color="red" />
                <KpiCard label="New Patients"    value={kpis.new_patients_today} icon="user-plus" color="sky" />
            </div>

            <div className="grid gap-5 lg:grid-cols-5">
                {/* Upcoming list */}
                <div className="lg:col-span-3 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                    <div className="border-b border-gray-100 px-5 py-4 flex items-center justify-between">
                        <div>
                            <h3 className="text-sm font-semibold text-gray-900">Up Next Today</h3>
                            <p className="mt-0.5 text-xs text-gray-400">Pending, confirmed, or checked-in appointments</p>
                        </div>
                        <Link to="/workflows/appointments" className="text-xs font-semibold text-blue-600 hover:underline">
                            View all
                        </Link>
                    </div>
                    {upcoming.length === 0 ? (
                        <div className="px-5 py-10 text-center text-sm text-gray-400">No upcoming appointments for today.</div>
                    ) : (
                        <div className="divide-y divide-gray-100">
                            {upcoming.map((appt) => {
                                const cfg = statusCfg[appt.status] || statusCfg.pending;
                                return (
                                    <Link
                                        key={appt.id}
                                        to={`/workflows/appointments?open=${appt.id}`}
                                        className="flex items-center gap-4 px-5 py-3 hover:bg-gray-50 transition"
                                    >
                                        <div className="flex-shrink-0 w-14 text-center">
                                            <span className="text-sm font-bold text-gray-800">{fmtTime(appt.start_time)}</span>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-semibold text-gray-900 truncate">{appt.patient_name || '—'}</p>
                                            <p className="text-xs text-gray-400 truncate">{appt.doctor_name}</p>
                                        </div>
                                        <div className={`flex-shrink-0 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${cfg.bg} ${cfg.text}`}>
                                            <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
                                            {cfg.label}
                                        </div>
                                    </Link>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Status donut */}
                <div className="lg:col-span-2">
                    <DonutChart
                        title="Today's Status"
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
export default function DashboardPage() {
    const { user } = useAuth();
    const { context, ready } = useScope() || {};
    const [data, setData] = useState(null);
    const [error, setError] = useState('');

    const base = useMemo(() => (user?.role === 'super_admin' ? '/super-admin' : '/clinic'), [user]);
    const isSuperAdmin = user?.role === 'super_admin';
    const roleKind = context?.role_kind;
    const isClinicAdmin = roleKind === 'clinic_admin';
    // Staff kind with role_limits_assigned_doctors set sees the assistant
    // dashboard; every other staff kind (default: receptionist-style role or
    // any custom staff role without the limit) sees the receptionist one.
    const isAssistant = roleKind === 'staff' && Boolean(context?.role_limits_assigned_doctors);
    const isReceptionist = roleKind === 'staff' && !isAssistant;

    useEffect(() => {
        // Don't fetch until role_kind is known (or the caller is super_admin,
        // whose branch never depends on it): otherwise this fires once for
        // the generic/summary endpoint while roleKind is still unresolved,
        // then again for the real per-role endpoint once it resolves — two
        // in-flight requests whose responses can land out of order and leave
        // `data` shaped for the wrong dashboard.
        if (!isSuperAdmin && !ready) return;

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
                } else if (!isSuperAdmin && isClinicAdmin) {
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
    }, [base, isSuperAdmin, isClinicAdmin, isReceptionist, isAssistant, ready]);

    if (error) {
        return (
            <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
                <AppIcon name="alert-triangle" className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-500" />
                <p className="text-sm text-red-700">{error}</p>
            </div>
        );
    }

    if (!data) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="flex flex-col items-center gap-3">
                    <span className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                    <p className="text-sm text-gray-500">Loading dashboard…</p>
                </div>
            </div>
        );
    }

    // ── Receptionist dashboard ────────────────────────────────────────────────
    if (isReceptionist) {
        return <ReceptionistDashboard data={data} />;
    }

    // ── Assistant dashboard ───────────────────────────────────────────────────
    if (isAssistant) {
        return <AssistantDashboard data={data} />;
    }

    // ── Clinic Admin dashboard ─────────────────────────────────────────────────
    if (!isSuperAdmin && isClinicAdmin) {
        const kpis = data?.kpis || {};
        const today = data?.today || {};
        const trends = data?.trends || {};
        const insights = data?.insights || {};
        const alerts = data?.alerts || [];

        const bookingSources = (insights.booking_sources_30d || []).map((x) => ({ label: x.source, count: x.count }));
        const doctors = (insights.doctor_performance_30d || []).map((x) => ({ label: x.doctor_name, count: x.total }));

        return (
            <div className="space-y-6">
                {/* Page header */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>
                        <p className="mt-0.5 text-sm text-gray-500">Today's operations, trends, and actionables.</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <Link to="/modules/patients/new" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                            + New Patient
                        </Link>
                        <Link to="/workflows/appointments/new" className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                            + New Appointment
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
                        title="Appointment Status (Today)"
                        subtitle="Distribution of today's appointments by status."
                        items={(today.appointment_status || []).map((x) => ({ label: x.status, count: x.count }))}
                    />
                    <Section title="Follow-up Health" subtitle="Operational follow-up metrics.">
                        <FollowupStats insights={insights} />
                        <div className="mt-4 flex flex-wrap gap-2">
                            <Link to="/modules/followups" className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                                Open Follow-ups
                            </Link>
                            <Link to="/workflows/appointments" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                                Appointments
                            </Link>
                        </div>
                    </Section>
                </div>

                {/* Trends */}
                <Section title="Trends" subtitle="30-day daily appointment volume.">
                    <LineChart
                        data={trends.appointments_30d || []}
                        xKey="date"
                        yKey="count"
                    />
                </Section>

                {/* Insights */}
                <div className="grid gap-5 lg:grid-cols-3">
                    <BarListChart
                        title="Doctor Performance (30d)"
                        subtitle="Top by appointment volume."
                        items={doctors}
                        labelKey="label"
                        valueKey="count"
                        maxItems={8}
                    />
                    <DonutChart
                        title="New vs Repeat (30d)"
                        subtitle="Patient visit type breakdown."
                        items={insights.new_vs_repeat_30d || []}
                        valueKey="count"
                    />
                </div>

                {bookingSources.length > 0 && (
                    <BarListChart
                        title="Booking Sources (30d)"
                        subtitle="Channels driving appointment bookings."
                        items={bookingSources}
                        labelKey="label"
                        valueKey="count"
                        maxItems={10}
                    />
                )}

                {/* Alerts */}
                {alerts.length > 0 && (
                    <Section title="Alerts & Actionables" subtitle="Items requiring attention.">
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

    // ── Super Admin / other roles ──────────────────────────────────────────────
    return (
        <div className="space-y-6">
            {/* Page header */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-xl font-bold text-gray-900">
                        {isSuperAdmin ? 'Super Admin Overview' : 'Dashboard'}
                    </h1>
                    <p className="mt-0.5 text-sm text-gray-500">
                        {isSuperAdmin
                            ? 'Onboard clinics, manage access, and monitor the network.'
                            : 'Run daily workflows: appointments, patients, billing, and communication.'}
                    </p>
                </div>
                {!isSuperAdmin && (
                    <div className="flex flex-wrap gap-2">
                        <Link to="/modules/patients/new" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                            + New Patient
                        </Link>
                        <Link to="/workflows/appointments/new" className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                            + New Appointment
                        </Link>
                    </div>
                )}
            </div>

            {/* Quick action cards */}
            <div className={isSuperAdmin ? 'grid gap-4' : 'grid gap-4 sm:grid-cols-2'}>
                {isSuperAdmin ? (
                    <ActionCard
                        title="Clinic Onboarding"
                        description="Guided flow to create a clinic and admin access."
                        icon="hospital"
                        actions={[
                            { to: '/workflows/onboard-clinic', label: 'Onboard New Clinic' },
                            { to: '/workflows/clinics', label: 'View Clinics' },
                        ]}
                    />
                ) : (
                    <ActionCard
                        title="Start of Day"
                        description="Jump into today's appointments and tasks."
                        icon="calendar"
                        actions={[
                            { to: '/workflows/appointments/new', label: 'New Appointment' },
                            { to: '/workflows/appointments', label: 'Appointments' },
                            { to: '/modules/followups', label: 'Follow-ups' },
                        ]}
                    />
                )}

                {!isSuperAdmin && (
                    <ActionCard
                        title="Team Management"
                        description="Add staff and doctors to your clinic."
                        icon="users"
                        actions={[
                            { to: '/workflows/create-staff', label: 'Add Staff' },
                            { to: '/workflows/setup-doctor', label: 'Add Doctor' },
                        ]}
                    />
                )}
            </div>

            {/* Summary stats */}
            {isSuperAdmin ? (
                <div className="space-y-5">
                    <Section title="Network" subtitle="High-level platform counts.">
                        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                            <StatCard label="Total Clinics" value={data.total_clinics} />
                            <StatCard label="Onboarded Today" value={data.today_clinic_onboarding} />
                            <StatCard label="Total Staff" value={data.total_staff} />
                            <StatCard label="Total Doctors" value={data.total_doctors} />
                        </div>
                    </Section>

                    <Section title="Patients & Appointments" subtitle="Totals and today's activity.">
                        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                            <StatCard label="Total Patients" value={data.total_patients} />
                            <StatCard label="Patients Today" value={data.today_patients} />
                            <StatCard label="Total Appointments" value={data.total_appointments} />
                            <StatCard label="Appointments Today" value={data.today_appointments} />
                        </div>
                    </Section>

                    <Section title="WhatsApp" subtitle="Conversation and booking activity.">
                        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                            <StatCard label="Total Conversations" value={data.total_whatsapp_conversations} />
                            <StatCard label="Conversations Today" value={data.today_whatsapp_conversations} />
                            <StatCard label="Total WhatsApp Appointments" value={data.total_whatsapp_appointments} />
                            <StatCard label="WhatsApp Appointments Today" value={data.today_whatsapp_appointments} />
                        </div>
                    </Section>
                </div>
            ) : (
                <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
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
