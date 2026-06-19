import { modules } from './modules';

const moduleItem = (moduleKey, overrides = {}) => ({
    type: 'module',
    moduleKey,
    label: overrides.label || modules[moduleKey]?.label || moduleKey,
});

const routeItem = (to, label) => ({ type: 'route', to, label });

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
                moduleItem('doctors', { label: 'Doctors' }),
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

    // ── Clinic Admin ───────────────────────────────────────────────────────────
    clinic_admin: [
        {
            section: 'Overview',
            items: [
                routeItem('/dashboard', 'Overview'),
            ],
        },
        {
            section: 'Operations',
            items: [
                routeItem('/workflows/appointments', 'Appointments'),
                moduleItem('patients'),
            ],
        },
        {
            section: 'Clinic',
            items: [
                moduleItem('doctors'),
                moduleItem('services'),
                moduleItem('branches'),
                moduleItem('users', { label: 'Staff Users' }),
            ],
        },
        {
            section: 'Communication',
            items: [
                moduleItem('whatsappConversations', { label: 'WhatsApp' }),
                moduleItem('reminders'),
            ],
        },
        {
            section: 'Settings',
            items: [
                routeItem('/workflows/clinic-profile', 'Clinic Profile'),
            ],
        },
    ],

    // ── Branch Manager ─────────────────────────────────────────────────────────
    branch_manager: [
        {
            section: 'Overview',
            items: [
                routeItem('/dashboard', 'Overview'),
            ],
        },
        {
            section: 'Operations',
            items: [
                routeItem('/workflows/appointments', 'Appointments'),
                moduleItem('patients'),
            ],
        },
        {
            section: 'Branch',
            items: [
                moduleItem('doctors'),
                moduleItem('services'),
                moduleItem('users', { label: 'Staff Users' }),
            ],
        },
        {
            section: 'Communication',
            items: [
                moduleItem('whatsappConversations', { label: 'WhatsApp' }),
                moduleItem('reminders'),
            ],
        },
        {
            section: 'Settings',
            items: [
                routeItem('/workflows/branch-profile', 'Branch Profile'),
            ],
        },
    ],

    // ── Receptionist ──────────────────────────────────────────────────────────
    receptionist: [
        {
            section: 'Front Desk',
            items: [
                routeItem('/dashboard', 'Today'),
                routeItem('/workflows/appointments', 'Appointments'),
                moduleItem('patients'),
            ],
        },
        {
            section: 'Services',
            items: [
                moduleItem('services'),
            ],
        },
        {
            section: 'Communication',
            items: [
                moduleItem('whatsappConversations', { label: 'WhatsApp' }),
                moduleItem('reminders'),
            ],
        },
    ],

    // ── Assistant ─────────────────────────────────────────────────────────────
    assistant: [
        {
            section: 'Daily',
            items: [
                routeItem('/dashboard', 'Today'),
                routeItem('/workflows/appointments', 'Appointments'),
                moduleItem('patients'),
            ],
        },
    ],

    // ── Doctor ────────────────────────────────────────────────────────────────
    doctor: [
        {
            section: 'Daily',
            items: [
                routeItem('/dashboard', 'Today'),
                routeItem('/workflows/appointments', 'Appointments'),
                routeItem('/workflows/my-profile?tab=calendar', 'Calendar'),
            ],
        },
        {
            section: 'Patients',
            items: [
                moduleItem('patients', { label: 'Patients' }),
            ],
        },
        {
            section: 'Practice',
            items: [
                routeItem('/workflows/my-availability', 'Availability'),
                moduleItem('services', { label: 'Services' }),
                routeItem('/workflows/my-profile', 'Doctor Profile'),
            ],
        },
    ],
};

export function resolveNavHref(item) {
    if (!item) return '/dashboard';
    if (item.type === 'route') return item.to;
    if (item.type === 'module') return `/modules/${item.moduleKey}`;
    return '/dashboard';
}
