import { modules } from './modules';

const moduleItem = (moduleKey, overrides = {}) => ({
    type: 'module',
    moduleKey,
    label: overrides.label || modules[moduleKey]?.label || moduleKey,
    perm: overrides.perm,
    doctorOnly: Boolean(overrides.doctorOnly),
});

const routeItem = (to, label, overrides = {}) => ({
    type: 'route',
    to,
    label,
    perm: overrides.perm,
    anyPerm: overrides.anyPerm,
    doctorOnly: Boolean(overrides.doctorOnly),
});

export const navigationByRole = {

    // ── Super Admin ────────────────────────────────────────────────────────────
    super_admin: [
        {
            section: 'Overview',
            items: [
                routeItem('/dashboard', 'Overview'),
            ],
        },
        {
            section: 'Onboarding',
            items: [
                routeItem('/workflows/onboard-clinic', 'Onboard New Clinic'),
            ],
        },
        {
            section: 'Network',
            items: [
                routeItem('/workflows/clinics', 'Clinics'),
            ],
        },
        {
            section: 'Billing',
            items: [
                routeItem('/billing/plans', 'Plans'),
                routeItem('/billing/subscription-transactions', 'Subscription Transactions'),
            ],
        },
        {
            section: 'Admin',
            items: [
                moduleItem('auditLogs', { label: 'Audit Logs' }),
                routeItem('/workflows/roles', 'Roles'),
            ],
        },
        {
            section: 'Settings',
            items: [
                routeItem('/workflows/system-settings', 'System Settings'),
            ],
        },
    ],

};

// The Settings hub only holds real settings (see SettingsHubPage); its nav
// item appears for anyone holding at least one of their permissions.
const SETTINGS_PERMS = ['clinic_profile.view', 'clinic_settings.view', 'subscription.view', 'audit_logs.view'];

// ── Clinic users (clinic_admin, doctor, and every staff role) ───────────────
// A single permission-driven list: every item declares the permission it
// needs (via `perm`) or is unconditional (no `perm`). The Doctor-practice
// section is further limited to doctor-kind users via `doctorOnly`.
// clinic_admin (and super_admin) always pass `can()`, so this list alone
// determines what any clinic user sees.
const clinicNavigation = [
    {
        section: '',
        items: [
            routeItem('/dashboard', 'Today'),
            routeItem('/workflows/appointments', 'Schedule', { perm: 'appointments.view' }),
            routeItem('/workflows/waitlist', 'Waitlist', { perm: 'appointments.view' }),
            moduleItem('patients', { perm: 'patients.view' }),
            moduleItem('followups', { label: 'Follow-ups', perm: 'followups.view' }),
        ],
    },
    {
        section: 'Messages',
        items: [
            moduleItem('whatsappConversations', { label: 'WhatsApp chats', perm: 'whatsapp.view' }),
            moduleItem('reminders', { perm: 'reminders.view' }),
            routeItem('/workflows/communication/delivery-issues', 'Delivery issues', { perm: 'whatsapp.view' }),
        ],
    },
    {
        section: 'Billing',
        items: [
            moduleItem('invoices', { label: 'Bills', perm: 'billing.view' }),
            moduleItem('payments', { label: 'Payments', perm: 'billing.view' }),
        ],
    },
    {
        section: 'My practice',
        items: [
            routeItem('/workflows/my-profile?tab=calendar', 'Calendar', { doctorOnly: true }),
            routeItem('/workflows/my-availability', 'Availability', { doctorOnly: true }),
            routeItem('/workflows/my-profile', 'Doctor profile', { doctorOnly: true }),
        ],
    },
    {
        section: 'Clinic',
        items: [
            moduleItem('doctors', { perm: 'doctors.view' }),
            moduleItem('services', { perm: 'services.view' }),
            moduleItem('users', { label: 'Team', perm: 'staff.view' }),
        ],
    },
    {
        section: '',
        items: [
            routeItem('/settings', 'Settings', { anyPerm: SETTINGS_PERMS }),
        ],
    },
];

/**
 * Returns the navigation sections for the current user. Super admins keep
 * their own fixed block; every clinic user (clinic_admin, doctor, staff — of
 * any custom role) gets `clinicNavigation` filtered by permission and by the
 * doctor-only rule, with any section left empty after filtering dropped.
 */
export function navigationFor(user, scope) {
    if (user?.role === 'super_admin') return navigationByRole.super_admin;

    const roleKind = scope?.roleKind;
    const can = typeof scope?.can === 'function' ? scope.can : () => false;

    return clinicNavigation
        .map((section) => ({
            ...section,
            items: (section.items || []).filter((item) => {
                if (item.doctorOnly && roleKind !== 'doctor') return false;
                if (item.perm && !can(item.perm)) return false;
                if (item.anyPerm && !item.anyPerm.some((p) => can(p))) return false;
                return true;
            }),
        }))
        .filter((section) => (section.items || []).length > 0);
}

export function resolveNavHref(item) {
    if (!item) return '/dashboard';
    if (item.type === 'route') return item.to;
    if (item.type === 'module') return `/modules/${item.moduleKey}`;
    return '/dashboard';
}
