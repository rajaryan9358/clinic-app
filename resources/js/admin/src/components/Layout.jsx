import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { modules } from '../config/modules';
import { navigationFor, resolveNavHref } from '../config/navigation';
import { useAuth } from '../context/AuthContext';
import { useScope } from '../context/ScopeContext';
import AppIcon from './AppIcon';
import CommandPalette from './CommandPalette';

// Map route paths → icon names
const ROUTE_ICONS = {
    '/dashboard': 'home',
    '/workflows/appointments': 'calendar',
    '/workflows/appointments/new': 'calendar-plus',
    '/workflows/waitlist': 'users',
    '/workflows/onboard-clinic': 'hospital',
    '/workflows/create-staff': 'user-plus',
    '/workflows/setup-doctor': 'user-check',
    '/workflows/my-profile': 'user-circle',
    '/workflows/my-profile?tab=calendar': 'calendar',
    '/workflows/my-availability': 'activity',
    '/workflows/clinic-profile': 'building',
    '/settings': 'settings',
    '/workflows/clinics': 'hospital',
    '/workflows/system-settings': 'settings',
    '/billing/plans': 'layout-template',
    '/billing/subscription-transactions': 'credit-card',
    '/workflows/communication/delivery-issues': 'alert-triangle',
    '/workflows/subscription': 'credit-card',
    '/workflows/roles': 'key',
};

// Map module keys → icon names
const MODULE_ICONS = {
    clinics: 'hospital',
    domains: 'globe',
    users: 'users',
    doctors: 'stethoscope',
    patients: 'user',
    appointments: 'calendar',
    services: 'briefcase',
    followups: 'clipboard-check',
    reviews: 'star',
    whatsappConversations: 'message-circle',
    whatsappMessages: 'message-circle',
    whatsappFlowSessions: 'git-branch',
    reminders: 'bell',
    invoices: 'file-text',
    payments: 'credit-card',
    auditLogs: 'shield',
    clinicSettings: 'settings',
    bookingSources: 'share',
};

function resolveIcon(item) {
    if (item.type === 'route') return ROUTE_ICONS[item.to] || 'arrow-right';
    if (item.type === 'module') return MODULE_ICONS[item.moduleKey] || 'module';
    return 'module';
}

function roleLabel(role) {
    const map = {
        super_admin: 'Super Admin',
        clinic_admin: 'Clinic Admin',
        doctor: 'Doctor',
        receptionist: 'Receptionist',
        assistant: 'Assistant',
    };
    return map[role] || role;
}

function roleBadgeColor(role) {
    const map = {
        super_admin: 'bg-violet-100 text-violet-700',
        clinic_admin: 'bg-blue-100 text-blue-700',
        doctor: 'bg-teal-100 text-teal-700',
        receptionist: 'bg-amber-100 text-amber-700',
        assistant: 'bg-gray-100 text-gray-600',
    };
    return map[role] || 'bg-gray-100 text-gray-600';
}

export default function Layout({ children }) {
    const { user, logout } = useAuth();
    const scope = useScope() || {};
    const { context, setActiveDoctorId } = scope;
    const location = useLocation();
    const role = user?.role || 'staff';
    const isSuperAdmin = role === 'super_admin';
    const navSections = navigationFor(user, scope);
    const displayRoleLabel = scope.roleLabel || roleLabel(role);
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);

    // ⌘K / Ctrl+K opens search from anywhere in the app.
    useEffect(() => {
        const onKey = (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                setPaletteOpen((o) => !o);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    // Close the phone menu whenever the route changes.
    useEffect(() => { setMenuOpen(false); }, [location.pathname, location.search]);

    const itemLabel = (item) => item.label || modules[item.moduleKey]?.label || '';
    const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');

    const paletteSections = navSections.map((s) => s.section).join('|');
    const palettePages = useMemo(
        () => navSections.flatMap((section) => (section.items || []).map((item) => ({
            label: item.label || itemLabel(item),
            href: resolveNavHref(item),
            icon: resolveIcon(item),
            section: section.section,
        }))),
        // navSections is rebuilt each render; its section names are a stable key.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [paletteSections, navSections.length],
    );

    const renderNavLink = (item) => {
        const href = resolveNavHref(item);
        const [path, query] = href.split('?');
        const isActive = query
            ? location.pathname === path && location.search === `?${query}`
            : location.pathname === href
                || (href !== '/dashboard' && location.pathname.startsWith(`${href}/`))
                || (path === '/workflows/my-profile' && location.pathname === path && !location.search.includes('tab=calendar'));

        return (
            <Link
                key={`${item.type}:${href}`}
                to={href}
                aria-current={isActive ? 'page' : undefined}
                className={`group flex h-9 items-center gap-3 rounded-lg px-3 text-sm transition-colors ${
                    isActive
                        ? 'bg-blue-50 font-semibold text-blue-700'
                        : 'font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
            >
                <AppIcon
                    name={resolveIcon(item)}
                    className={`h-4 w-4 flex-shrink-0 ${isActive ? 'text-blue-600' : 'text-slate-400 group-hover:text-slate-600'}`}
                />
                <span className="truncate">{itemLabel(item)}</span>
            </Link>
        );
    };

    const clinicName = isSuperAdmin ? 'Clinic SaaS' : (context?.clinic_name || 'Clinic');
    const clinicLogoUrl = isSuperAdmin ? null : context?.clinic_logo_url;
    const userName = user?.full_name || user?.email || 'User';

    const subscriptionBanner = (() => {
        const sub = context?.subscription;
        if (!sub) return null;
        const now = new Date();
        const daysLeft = (dateStr) => {
            if (!dateStr) return null;
            return Math.max(0, Math.ceil((new Date(dateStr) - now) / (1000 * 60 * 60 * 24)));
        };

        if (sub.status === 'trialing') {
            const days = daysLeft(sub.trial_ends_at);
            // A trial with plenty of time left is not worth a banner on every page.
            if (days != null && days > 7) return null;
            return {
                tone: 'amber',
                text: days == null ? 'Your account is on a trial period' : `Trial ends in ${days} day${days === 1 ? '' : 's'}`,
                payNow: true,
            };
        }

        if (sub.status === 'pending_payment' || sub.status === 'past_due') {
            const days = daysLeft(sub.grace_ends_at);
            return {
                tone: 'amber',
                text: days == null ? 'Payment due' : `Payment due — ${days} day${days === 1 ? '' : 's'} left`,
                payNow: true,
            };
        }

        if (sub.status === 'cancelled') {
            const endsAt = sub.current_period_end ? new Date(sub.current_period_end).toLocaleDateString() : null;
            return {
                tone: 'red',
                text: endsAt ? `Subscription cancelled — access until ${endsAt}` : 'Subscription cancelled',
                payNow: false,
            };
        }

        return null;
    })();

    const sidebar = (
        <div className="flex h-full flex-col">
            <div className="flex items-center gap-3 px-4 pb-3 pt-4">
                {clinicLogoUrl ? (
                    <img src={clinicLogoUrl} alt="" className="h-9 w-9 rounded-lg border border-slate-200 bg-white object-contain" />
                ) : (
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white">
                        <AppIcon name="hospital" className="h-5 w-5" />
                    </span>
                )}
                <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{clinicName}</p>
                    <p className="truncate text-xs text-slate-500">{displayRoleLabel}</p>
                </div>
            </div>

            <div className="space-y-2 px-3 pb-2">
                <button
                    type="button"
                    onClick={() => setPaletteOpen(true)}
                    className="flex h-10 w-full items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-left text-sm text-slate-500 hover:border-slate-300 hover:bg-white"
                >
                    <AppIcon name="search" className="h-4 w-4" />
                    <span className="flex-1 truncate">{isSuperAdmin ? 'Go to…' : 'Search patients, bookings…'}</span>
                    <kbd className="rounded border border-slate-300 bg-white px-1.5 text-[11px] text-slate-500">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
                </button>
                {!isSuperAdmin && scope.can?.('appointments.create') && (
                    <Link
                        to="/workflows/appointments/new"
                        className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700"
                    >
                        <AppIcon name="plus" className="h-4 w-4" />
                        New booking
                    </Link>
                )}
                {context?.allowed_doctors?.length > 1 && (
                    <label className="block">
                        <span className="sr-only">Working as doctor</span>
                        <select
                            className="h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm font-medium text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                            value={context.active_doctor_id || ''}
                            onChange={(e) => setActiveDoctorId?.(e.target.value)}
                        >
                            {context.allowed_doctors.map((d) => (
                                <option key={d.id} value={d.id}>{d.full_name}</option>
                            ))}
                        </select>
                    </label>
                )}
            </div>

            <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 pb-4">
                {navSections.map((section, i) => (
                    <div key={section.section || `s${i}`} className="pt-3 first:pt-1">
                        {section.section && (
                            <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                                {section.section}
                            </p>
                        )}
                        <div className="space-y-0.5">
                            {(section.items || []).map(renderNavLink)}
                        </div>
                    </div>
                ))}
            </nav>

            <div className="flex items-center gap-2.5 border-t border-slate-100 p-3">
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-700">
                    {userName[0].toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">{userName}</p>
                    <span className={`inline-block rounded-full px-1.5 py-px text-[10px] font-semibold ${roleBadgeColor(role)}`}>{displayRoleLabel}</span>
                </div>
                <button
                    type="button"
                    onClick={logout}
                    title="Sign out"
                    aria-label="Sign out"
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                >
                    <AppIcon name="log-out" className="h-4 w-4" />
                </button>
            </div>
        </div>
    );

    return (
        <div className="min-h-screen bg-slate-50">
            {/* ── Phone top bar ── */}
            <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-slate-200 bg-white px-3 lg:hidden">
                <button
                    type="button"
                    onClick={() => setMenuOpen(true)}
                    aria-label="Open menu"
                    className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100"
                >
                    <AppIcon name="menu" className="h-5 w-5" />
                </button>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">{clinicName}</span>
                <button
                    type="button"
                    onClick={() => setPaletteOpen(true)}
                    aria-label="Search"
                    className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100"
                >
                    <AppIcon name="search" className="h-5 w-5" />
                </button>
            </header>

            {/* ── Sidebar: fixed on desktop, a drawer on phones ── */}
            {menuOpen && <div className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden" onClick={() => setMenuOpen(false)} aria-hidden="true" />}
            <aside
                className={`fixed inset-y-0 left-0 z-40 w-64 border-r border-slate-200 bg-white transition-transform lg:z-20 lg:translate-x-0 ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}
            >
                {sidebar}
            </aside>

            {/* ── Main content ── */}
            <main className="lg:pl-64">
                {subscriptionBanner && (
                    <div className={`flex flex-wrap items-center justify-center gap-3 px-4 py-2 text-sm font-medium ${subscriptionBanner.tone === 'red' ? 'bg-red-600 text-white' : 'bg-amber-50 text-amber-900 border-b border-amber-200'}`}>
                        {subscriptionBanner.text}
                        {subscriptionBanner.payNow && scope.can?.('subscription.manage') && (
                            <Link to="/workflows/subscription" className="font-semibold underline underline-offset-2">
                                Choose a plan
                            </Link>
                        )}
                    </div>
                )}
                <div className="min-h-screen p-4 sm:p-6">
                    {children}
                </div>
            </main>

            <CommandPalette
                open={paletteOpen}
                onClose={() => setPaletteOpen(false)}
                pages={palettePages}
                can={scope.can || (() => false)}
                isClinicUser={!isSuperAdmin}
            />
        </div>
    );
}
