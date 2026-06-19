// Modules the super_admin should not access directly (handled via clinic detail pages or workflows)
export const SUPER_ADMIN_HIDDEN_MODULE_KEYS = [
    'appointments', 'patients', 'followups', 'services', 'invoices', 'payments',
    'reviews', 'whatsappAccounts', 'whatsappTemplates', 'whatsappConversations',
    'reminders', 'whatsappMessages', 'whatsappSessions',
];

export function isSuperAdminHiddenModuleKey(moduleKey) {
    if (!moduleKey) return false;
    return SUPER_ADMIN_HIDDEN_MODULE_KEYS.includes(String(moduleKey));
}

// Modules that cannot be created via the generic form
export const NON_CREATABLE_MODULE_KEYS = ['clinicSettings', 'branchSettings', 'auditLogs'];

export function canCreateModule(role, moduleKey) {
    if (!moduleKey) return false;
    const key = String(moduleKey);
    const r = String(role || '');

    if (NON_CREATABLE_MODULE_KEYS.includes(key)) return false;

    // Branches: only super_admin can create (via clinic detail page)
    if (key === 'branches') return r === 'super_admin';

    // Clinics: only super_admin
    if (key === 'clinics') return r === 'super_admin';

    // Domains: only super_admin
    if (key === 'domains') return r === 'super_admin';

    // Staff users: not allowed for receptionist, assistant, doctor
    if (key === 'users') return !['receptionist', 'assistant', 'doctor'].includes(r);

    // Doctors: not allowed for receptionist, assistant, doctor
    if (key === 'doctors') return !['receptionist', 'assistant', 'doctor'].includes(r);

    // Services: not allowed for receptionist (read-only), assistant, doctor
    if (key === 'services') return !['receptionist', 'assistant', 'doctor'].includes(r);

    // Invoices/payments: receptionist can create, not others below
    if (key === 'invoices' || key === 'payments') return !['assistant', 'doctor'].includes(r);

    return true;
}

export function canAccessModule(role, moduleKey) {
    if (!moduleKey) return false;
    const r = String(role || '');
    const key = String(moduleKey);

    // Reviews hidden from all roles
    if (key === 'reviews') return false;

    if (r === 'super_admin') {
        return !isSuperAdminHiddenModuleKey(key);
    }

    // Doctor: patients + services (read-only via isReadOnly in ModuleListPage)
    if (r === 'doctor') {
        return ['patients', 'services'].includes(key);
    }

    // Assistant: appointments (workflow), patients
    if (r === 'assistant') {
        return ['patients'].includes(key);
    }

    // Receptionist: patients, services, invoices, payments, reviews, whatsapp, reminders
    if (r === 'receptionist') {
        return ['patients', 'services', 'invoices', 'payments', 'reviews',
            'whatsappConversations', 'reminders'].includes(key);
    }

    // Branch manager: everything clinic-scoped except branches (no branch management)
    if (r === 'branch_manager') {
        return !['branches', 'clinics', 'domains', 'auditLogs', 'clinicSettings',
            'branchSettings', 'followups'].includes(key);
    }

    // Clinic admin: almost everything except audit (for clinic admins, restricted via backend)
    if (r === 'clinic_admin') {
        return !['clinics', 'domains', 'auditLogs', 'followups'].includes(key);
    }

    return true;
}

/** Whether this role should have branch auto-set (no branch selector in forms) */
export function isAutoBranchRole(role) {
    return ['branch_manager', 'receptionist', 'assistant', 'doctor'].includes(String(role || ''));
}

/** Whether doctor_id should be hidden (booking for self) */
export function isAutoDocRole(role) {
    return String(role || '') === 'doctor';
}

/** Which staff roles the current actor is allowed to create/manage (UI hint; backend is source of truth). */
export function allowedStaffRolesForCreator(actorRole) {
    const r = String(actorRole || '');
    // NOTE: creating doctor logins is handled via doctor onboarding (linked user),
    // not the generic staff user form.
    if (r === 'super_admin') return ['super_admin', 'clinic_admin', 'branch_manager', 'receptionist', 'assistant'];
    if (r === 'clinic_admin') return ['branch_manager', 'receptionist', 'assistant'];
    if (r === 'branch_manager') return ['receptionist', 'assistant'];
    return [];
}
