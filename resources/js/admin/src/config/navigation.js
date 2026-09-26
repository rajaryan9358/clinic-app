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

// ── Clinic users (clinic_admin, doctor, and every staff role) ───────────────
// A single permission-driven list: every item declares the permission it
// needs (via `perm`) or is unconditional (no `perm`). The Doctor-practice
// section is further limited to doctor-kind users via `doctorOnly`.
// clinic_admin (and super_admin) always pass `can()`, so this list alone
// determines what any clinic user sees.
const clinicNavigation = [
    {
        section: 'Overview',
        items: [
            routeItem('/dashboard', 'Overview'),
        ],
    },
    {
        section: 'Operations',
        items: [
            routeItem('/workflows/appointments', 'Appointments', { perm: 'appointments.view' }),
            moduleItem('patients', { perm: 'patients.view' }),
        ],
    },
    {
        section: 'Clinic',
        items: [
            moduleItem('doctors', { perm: 'doctors.view' }),
            moduleItem('services', { perm: 'services.view' }),
            moduleItem('users', { label: 'Staff Users', perm: 'staff.view' }),
        ],
    },
    {
        section: 'Doctor Practice',
        items: [
            routeItem('/workflows/my-profile?tab=calendar', 'Calendar', { doctorOnly: true }),
            routeItem('/workflows/my-availability', 'Availability', { doctorOnly: true }),
            routeItem('/workflows/my-profile', 'Doctor Profile', { doctorOnly: true }),
        ],
    },
    {
        section: 'Communication',
        items: [
            moduleItem('whatsappConversations', { label: 'WhatsApp', perm: 'whatsapp.view' }),
            moduleItem('reminders', { perm: 'reminders.view' }),
        ],
    },
    {
        section: 'Settings',
        items: [
            routeItem('/workflows/clinic-profile', 'Clinic Profile', { perm: 'clinic_profile.view' }),
            routeItem('/workflows/subscription', 'Subscription', { perm: 'subscription.view' }),
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
