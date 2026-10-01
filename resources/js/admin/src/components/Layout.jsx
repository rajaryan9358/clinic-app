import { Link, useLocation } from 'react-router-dom';
import { modules } from '../config/modules';
import { navigationFor, resolveNavHref } from '../config/navigation';
import { useAuth } from '../context/AuthContext';
import { useScope } from '../context/ScopeContext';
import AppIcon from './AppIcon';

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
    const navSections = navigationFor(user, scope);
    const displayRoleLabel = scope.roleLabel || roleLabel(role);

    const renderNavLink = (item) => {
        const href = resolveNavHref(item);
        const isActive = location.pathname === href || (href !== '/dashboard' && location.pathname.startsWith(`${href}/`));
        const label = item.type === 'module'
            ? (modules[item.moduleKey]?.label || item.label)
            : item.label;
        const iconName = resolveIcon(item);

        return (
            <Link
                key={`${item.type}:${href}`}
                to={href}
                className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                    isActive
                        ? 'bg-blue-50 font-semibold text-blue-700'
                        : 'font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`}
            >
                <AppIcon
                    name={iconName}
                    className={`h-4 w-4 flex-shrink-0 ${isActive ? 'text-blue-600' : 'text-gray-400 group-hover:text-gray-600'}`}
                />
                <span className="truncate">{label}</span>
            </Link>
        );
    };

    const clinicName = context?.clinic_name || 'Clinic SaaS';
    const clinicLogoUrl = context?.clinic_logo_url;

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
            return {
                tone: 'amber',
                text: days == null ? 'Your account is on a trial period' : `Trial: ${days} day${days === 1 ? '' : 's'} left`,
                payNow: false,
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

    return (
        <div className="min-h-screen bg-gray-50">
            {/* ── Subscription Banner ── */}
            {subscriptionBanner && (
                <div className={`fixed inset-x-0 top-0 z-40 flex items-center justify-center gap-3 px-4 py-1.5 text-xs font-semibold ${subscriptionBanner.tone === 'red' ? 'bg-red-600 text-white' : 'bg-amber-400 text-amber-900'}`}>
                    {subscriptionBanner.text}
                    {subscriptionBanner.payNow && scope.can?.('subscription.manage') && (
                        <Link to="/workflows/subscription" className="rounded-full bg-amber-900/20 px-2.5 py-0.5 text-[11px] font-bold text-amber-900 hover:bg-amber-900/30">
                            Pay now →
                        </Link>
                    )}
                </div>
            )}
            {/* ── Top Header ── */}
            <header className={`fixed inset-x-0 z-30 flex h-14 items-center justify-between border-b border-gray-200 bg-white px-4 shadow-sm ${subscriptionBanner ? 'top-7' : 'top-0'}`}>
                {/* Logo */}
                <div className="flex items-center gap-3">
                    {clinicLogoUrl ? (
                        <img src={clinicLogoUrl} alt={clinicName} className="h-8 w-8 rounded-lg border border-gray-200 object-contain" />
                    ) : (
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600">
                            <AppIcon name="hospital" className="h-4.5 w-4.5 text-white" />
                        </div>
                    )}
                    <div className="hidden sm:block">
                        <span className="text-sm font-bold text-gray-900">{clinicName}</span>
                    </div>
                </div>

                {/* Right side */}
                <div className="flex items-center gap-3">
                    {/* Doctor selector */}
                    {context?.allowed_doctors?.length > 0 && (
                        <div className="hidden items-center gap-2 sm:flex">
                            <AppIcon name="stethoscope" className="h-3.5 w-3.5 text-gray-400" />
                            {context.allowed_doctors.length === 1 ? (
                                <span className="text-sm font-medium text-gray-700">{context.allowed_doctors[0].full_name}</span>
                            ) : (
                                <select
                                    className="rounded-lg border border-gray-200 bg-white py-1.5 pl-2 pr-7 text-sm font-medium text-gray-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                                    value={context.active_doctor_id || ''}
                                    onChange={(e) => setActiveDoctorId?.(e.target.value)}
                                >
                                    {context.allowed_doctors.map((d) => (
                                        <option key={d.id} value={d.id}>{d.full_name}</option>
                                    ))}
                                </select>
                            )}
                        </div>
                    )}

                    {/* Divider */}
                    <div className="h-6 w-px bg-gray-200" />

                    {/* User info + logout */}
                    <div className="flex items-center gap-2.5">
                        <div className="hidden flex-col items-end sm:flex">
                            <span className="text-sm font-semibold text-gray-900 leading-tight">{user?.full_name || user?.email || 'User'}</span>
                            <span className={`mt-0.5 rounded-full px-1.5 py-px text-[10px] font-semibold ${roleBadgeColor(role)}`}>
                                {displayRoleLabel}
                            </span>
                        </div>
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                            {(user?.full_name || user?.email || 'U')[0].toUpperCase()}
                        </div>
                        <button
                            onClick={logout}
                            className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
                            title="Sign out"
                        >
                            <AppIcon name="log-out" className="h-3.5 w-3.5" />
                            <span className="hidden sm:inline">Sign out</span>
                        </button>
                    </div>
                </div>
            </header>

            {/* ── Sidebar ── */}
            <aside className={`fixed inset-y-0 left-0 z-20 flex w-64 flex-col border-r border-gray-200 bg-white ${subscriptionBanner ? 'pt-[84px]' : 'pt-14'}`}>
                <div className="flex-1 overflow-y-auto px-3 py-4">
                    <nav className="space-y-0.5">
                        {navSections.map((section) => (
                            <div key={section.section} className="pb-2 pt-4 first:pt-0">
                                <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                                    {section.section}
                                </p>
                                <div className="space-y-0.5">
                                    {(section.items || []).map(renderNavLink)}
                                </div>
                            </div>
                        ))}
                    </nav>
                </div>

                {/* Sidebar footer */}
                <div className="border-t border-gray-100 p-3">
                    <div className="flex items-center gap-2.5 rounded-lg bg-gray-50 px-3 py-2.5">
                        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                            {(user?.full_name || user?.email || 'U')[0].toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-semibold text-gray-900">{user?.full_name || user?.email}</p>
                            <p className="truncate text-[10px] text-gray-500">{displayRoleLabel}</p>
                        </div>
                    </div>
                </div>
            </aside>

            {/* ── Main content ── */}
            <main className={`pl-64 ${subscriptionBanner ? 'pt-[84px]' : 'pt-14'}`}>
                <div className="min-h-[calc(100vh-3.5rem)] p-6">
                    {children}
                </div>
            </main>
        </div>
    );
}
