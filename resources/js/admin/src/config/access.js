// Modules the super_admin should not access directly (handled via clinic detail pages or workflows)
export const SUPER_ADMIN_HIDDEN_MODULE_KEYS = [
    'doctors', 'domains',
    'appointments', 'patients', 'followups', 'services', 'invoices', 'payments',
    'reviews', 'whatsappConversations',
    'reminders', 'whatsappMessages', 'whatsappSessions',
];

export function isSuperAdminHiddenModuleKey(moduleKey) {
    if (!moduleKey) return false;
    return SUPER_ADMIN_HIDDEN_MODULE_KEYS.includes(String(moduleKey));
}

// Modules that cannot be created via the generic form
export const NON_CREATABLE_MODULE_KEYS = ['clinicSettings', 'auditLogs'];

// System-generated records: the API refuses every write (405)
export const READ_ONLY_MODULE_KEYS = ['auditLogs', 'reminders', 'whatsappMessages', 'whatsappSessions'];

// Module key → permission module name (the `{module}` in `{module}.{view|create|edit|delete}`).
export const MODULE_PERMISSION = {
    patients: 'patients',
    appointments: 'appointments',
    doctors: 'doctors',
    services: 'services',
    users: 'staff',
    followups: 'followups',
    reminders: 'reminders',
    whatsappConversations: 'whatsapp',
    whatsappMessages: 'whatsapp',
    whatsappSessions: 'whatsapp',
    invoices: 'billing',
    payments: 'billing',
    reviews: 'reviews',
    auditLogs: 'audit_logs',
    clinicSettings: 'clinic_settings',
    domains: 'clinic_settings',
};

function clinicPermissionFor(moduleKey, action) {
    const permModule = MODULE_PERMISSION[String(moduleKey)];
    if (!permModule) return null;
    return `${permModule}.${action}`;
}

export function canCreateModule(role, moduleKey, can) {
    if (!moduleKey) return false;
    const key = String(moduleKey);
    const r = String(role || '');

    if (NON_CREATABLE_MODULE_KEYS.includes(key) || READ_ONLY_MODULE_KEYS.includes(key)) return false;

    // Clinics: only super_admin
    if (key === 'clinics') return r === 'super_admin';

    // Domains: only super_admin
    if (key === 'domains') return r === 'super_admin';

    if (r === 'super_admin') return true;

    const perm = clinicPermissionFor(key, 'create');
    if (!perm) return true;
    return typeof can === 'function' ? can(perm) : false;
}

export function canEditModule(role, moduleKey, can) {
    if (!moduleKey) return false;
    const key = String(moduleKey);
    const r = String(role || '');

    if (READ_ONLY_MODULE_KEYS.includes(key)) return false;

    if (r === 'super_admin') return true;

    const perm = clinicPermissionFor(key, 'edit');
    if (!perm) return true;
    return typeof can === 'function' ? can(perm) : false;
}

export function canDeleteModule(role, moduleKey, can) {
    if (!moduleKey) return false;
    const key = String(moduleKey);
    const r = String(role || '');

    if (READ_ONLY_MODULE_KEYS.includes(key)) return false;

    if (r === 'super_admin') return true;

    const perm = clinicPermissionFor(key, 'delete');
    if (!perm) return true;
    return typeof can === 'function' ? can(perm) : false;
}

export function canAccessModule(role, moduleKey, can) {
    if (!moduleKey) return false;
    const r = String(role || '');
    const key = String(moduleKey);

    // Reviews and domains are not in use yet: hidden from all roles.
    if (key === 'reviews' || key === 'domains') return false;

    if (r === 'super_admin') {
        return !isSuperAdminHiddenModuleKey(key);
    }

    const perm = clinicPermissionFor(key, 'view');
    if (!perm) return true;
    return typeof can === 'function' ? can(perm) : false;
}

/** Whether doctor_id should be hidden (booking for self) */
export function isAutoDocRole(role) {
    return String(role || '') === 'doctor';
}
