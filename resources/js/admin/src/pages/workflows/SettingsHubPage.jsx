import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../../api/client';
import AppIcon from '../../components/AppIcon';
import { useScope } from '../../context/ScopeContext';

// Every card names the permission it needs; a role only sees what it holds.
// Counts and states are filled in after load where they are cheap to get.
const GROUPS = [
    {
        title: 'Clinic',
        items: [
            { key: 'profile', title: 'Clinic profile', desc: 'Name, address, contact, logo and colours shown to patients.', to: '/workflows/clinic-profile', perm: 'clinic_profile.view', icon: 'building' },
            { key: 'rules', title: 'Booking & waitlist rules', desc: 'Online booking, walk-ins, tokens, reminders, cancel and reschedule limits.', to: '/modules/clinicSettings', perm: 'clinic_settings.view', icon: 'settings' },
            { key: 'services', title: 'Services & fees', desc: 'What you offer, how long it takes and what it costs.', to: '/modules/services', perm: 'services.view', icon: 'briefcase', count: 'services' },
            { key: 'domains', title: 'Domains', desc: 'Web addresses for booking and the patient portal.', to: '/modules/domains', perm: 'clinic_settings.view', icon: 'globe' },
        ],
    },
    {
        title: 'People',
        items: [
            { key: 'doctors', title: 'Doctors & availability', desc: 'Profiles, fees, weekly hours, leave and slot length.', to: '/modules/doctors', perm: 'doctors.view', icon: 'stethoscope', count: 'doctors' },
            { key: 'team', title: 'Team', desc: 'Staff accounts, their role and which doctors they work for.', to: '/modules/users', perm: 'staff.view', icon: 'users', count: 'users' },
        ],
    },
    {
        title: 'Patients & messages',
        items: [
            { key: 'reminders', title: 'Reminders', desc: 'Every reminder sent to patients and whether it arrived.', to: '/modules/reminders', perm: 'reminders.view', icon: 'bell' },
            { key: 'delivery', title: 'Message delivery issues', desc: 'WhatsApp messages and reminders that failed to send.', to: '/workflows/communication/delivery-issues', perm: 'whatsapp.view', icon: 'alert-triangle' },
            { key: 'followups', title: 'Follow-ups', desc: 'Calls and check-ins due after a visit.', to: '/modules/followups', perm: 'followups.view', icon: 'clipboard-check' },
            { key: 'reviews', title: 'Reviews', desc: 'Patient reviews and your replies.', to: '/modules/reviews', perm: 'reviews.view', icon: 'star' },
        ],
    },
    {
        title: 'Money & account',
        items: [
            { key: 'invoices', title: 'Bills', desc: 'Invoices issued to patients.', to: '/modules/invoices', perm: 'billing.view', icon: 'file-text' },
            { key: 'payments', title: 'Payments', desc: 'Money received, by method.', to: '/modules/payments', perm: 'billing.view', icon: 'credit-card' },
            { key: 'subscription', title: 'Subscription', desc: 'Your ClinicFlow plan and payment history.', to: '/workflows/subscription', perm: 'subscription.view', icon: 'layout-template' },
            { key: 'audit', title: 'Activity log', desc: 'Who changed what, and when.', to: '/modules/auditLogs', perm: 'audit_logs.view', icon: 'shield' },
        ],
    },
];

const COUNT_PATHS = { services: '/clinic/services', doctors: '/clinic/doctors', users: '/clinic/users' };
const PROFILE_FIELDS = [['address_line_1', 'address'], ['city', 'city'], ['pincode', 'pincode'], ['phone', 'phone'], ['email', 'email'], ['logo_url', 'logo']];

const TONE = {
    ok: 'bg-emerald-100 text-emerald-800',
    warn: 'bg-amber-100 text-amber-800',
    info: 'bg-slate-100 text-slate-700',
};

export default function SettingsHubPage() {
    const scope = useScope() || {};
    const can = typeof scope.can === 'function' ? scope.can : () => false;
    const subscription = scope.context?.subscription;
    const [query, setQuery] = useState('');
    const [counts, setCounts] = useState({});
    const [missing, setMissing] = useState(null);
    const [failed, setFailed] = useState(null);

    const groups = useMemo(() => {
        const q = query.trim().toLowerCase();
        return GROUPS
            .map((g) => ({
                ...g,
                items: g.items.filter((i) => can(i.perm) && (!q || `${i.title} ${i.desc}`.toLowerCase().includes(q))),
            }))
            .filter((g) => g.items.length);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [query, scope.context]);

    useEffect(() => {
        let cancelled = false;
        const all = GROUPS.flatMap((g) => g.items).filter((i) => i.count && can(i.perm));
        Promise.all(all.map((i) => client.get(COUNT_PATHS[i.count], { params: { per_page: 1 } })
            .then((r) => [i.count, r.data?.meta?.total ?? null]).catch(() => [i.count, null])))
            .then((pairs) => { if (!cancelled) setCounts(Object.fromEntries(pairs)); });

        if (can('clinic_profile.view')) {
            client.get('/clinic/clinic/profile')
                .then((r) => {
                    const c = r.data?.data || {};
                    if (!cancelled) setMissing(PROFILE_FIELDS.filter(([k]) => !c[k]).map(([, label]) => label));
                })
                .catch(() => {});
        }
        if (can('whatsapp.view')) {
            client.get('/clinic/whatsapp/messages', { params: { delivery_status: 'failed', per_page: 1 } })
                .then((r) => { if (!cancelled) setFailed(r.data?.meta?.total ?? 0); })
                .catch(() => {});
        }
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scope.context]);

    const stateFor = (item) => {
        if (item.key === 'profile' && missing) {
            return missing.length ? { label: `Add ${missing.slice(0, 2).join(', ')}${missing.length > 2 ? '…' : ''}`, tone: 'warn' } : { label: 'Complete', tone: 'ok' };
        }
        if (item.key === 'delivery' && failed != null) {
            return failed ? { label: `${failed} failed`, tone: 'warn' } : { label: 'All delivered', tone: 'ok' };
        }
        if (item.key === 'subscription' && subscription?.status) {
            if (subscription.status === 'trialing') {
                const days = subscription.trial_ends_at ? Math.max(0, Math.ceil((new Date(subscription.trial_ends_at) - new Date()) / 864e5)) : null;
                return { label: days != null ? `Trial · ${days} day${days === 1 ? '' : 's'} left` : 'Trial', tone: 'warn' };
            }
            if (subscription.status === 'active') return { label: subscription.plan_name || 'Active', tone: 'ok' };
            return { label: String(subscription.status).replace(/_/g, ' '), tone: 'warn' };
        }
        if (item.count && counts[item.count] != null) {
            const n = counts[item.count];
            const noun = { services: 'service', doctors: 'doctor', users: 'person' }[item.count];
            const plural = item.count === 'users' ? (n === 1 ? 'person' : 'people') : `${noun}${n === 1 ? '' : 's'}`;
            return { label: `${n} ${plural}`, tone: n ? 'info' : 'warn' };
        }
        return null;
    };

    return (
        <div className="mx-auto max-w-[1200px] space-y-6">
            <header className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-slate-900">Settings</h1>
                    <p className="mt-0.5 text-sm text-slate-600">Everything about how {scope.context?.clinic_name || 'the clinic'} runs, in one place.</p>
                </div>
                <label className="flex h-10 w-full max-w-xs items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
                    <AppIcon name="search" className="h-4 w-4 text-slate-500" />
                    <span className="sr-only">Find a setting</span>
                    <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a setting, e.g. reminders" className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400" />
                </label>
            </header>

            {groups.length === 0 && <p className="text-sm text-slate-600">{query ? 'No settings match that.' : 'Your role has no settings to manage.'}</p>}

            {groups.map((g) => (
                <section key={g.title} aria-labelledby={`sg-${g.title}`} className="space-y-2.5">
                    <h2 id={`sg-${g.title}`} className="text-xs font-semibold uppercase tracking-wider text-slate-500">{g.title}</h2>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {g.items.map((item) => {
                            const state = stateFor(item);
                            return (
                                <Link key={item.key} to={item.to} className="group flex min-h-[112px] gap-3 rounded-2xl border border-slate-200 bg-white p-4 hover:border-slate-300 hover:shadow-sm">
                                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 group-hover:bg-blue-50 group-hover:text-blue-700">
                                        <AppIcon name={item.icon} className="h-4 w-4" />
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="flex flex-wrap items-start justify-between gap-2">
                                            <span className="text-[15px] font-semibold text-slate-900">{item.title}</span>
                                            {state && <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE[state.tone]}`}>{state.label}</span>}
                                        </span>
                                        <span className="mt-1 block text-sm text-slate-600">{item.desc}</span>
                                    </span>
                                </Link>
                            );
                        })}
                    </div>
                </section>
            ))}

            <p className="text-xs text-slate-500">Roles and what each role may do are set up by ClinicFlow. Ask your administrator if someone needs different access.</p>
        </div>
    );
}
