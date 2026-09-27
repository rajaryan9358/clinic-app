<?php

namespace App\Support;

class PermissionCatalogue
{
    private const CRUD = ['view', 'create', 'edit', 'delete'];

    public static function modules(): array
    {
        $m = fn (string $label, array $actions = self::CRUD) => ['label' => $label, 'actions' => $actions];

        return [
            'patients' => $m('patients', array_merge(self::CRUD, ['portal_link'])),
            'appointments' => $m('appointments'),
            'doctors' => $m('doctors'),
            'doctor_schedules' => $m('doctor schedules'),
            'services' => $m('services'),
            'staff' => $m('staff users'),
            'whatsapp' => $m('WhatsApp'),
            'reminders' => $m('reminders'),
            'followups' => $m('follow-ups'),
            'billing' => $m('invoices and payments'),
            'reviews' => $m('reviews'),
            'reports' => $m('reports', ['view']),
            'audit_logs' => $m('the audit log', ['view']),
            'clinic_profile' => $m('the clinic profile'),
            'clinic_settings' => $m('clinic settings'),
            'subscription' => $m('the subscription'),
        ];
    }

    public static function specials(): array
    {
        return [
            'appointments.check_in' => ['label' => 'check in appointments', 'module' => 'appointments'],
            'appointments.cancel' => ['label' => 'cancel appointments', 'module' => 'appointments'],
            'appointments.prescribe' => ['label' => 'write prescriptions and consultation notes', 'module' => 'appointments'],
            'subscription.manage' => ['label' => 'manage the subscription', 'module' => 'subscription'],
        ];
    }

    /** @return string[] */
    public static function all(): array
    {
        $names = [];
        foreach (self::modules() as $key => $def) {
            foreach ($def['actions'] as $action) {
                $names[] = "{$key}.{$action}";
            }
        }

        return array_merge($names, array_keys(self::specials()));
    }

    public static function label(string $permission): string
    {
        if ($permission === 'patients.portal_link') {
            return 'send patient portal links';
        }
        if (isset(self::specials()[$permission])) {
            return self::specials()[$permission]['label'];
        }
        [$module, $action] = array_pad(explode('.', $permission, 2), 2, '');

        return trim($action.' '.(self::modules()[$module]['label'] ?? $module));
    }

    /** @return string[] */
    public static function defaults(string $roleName): array
    {
        $crud = fn (string $m, array $a = ['view', 'create', 'edit']) => array_map(fn ($x) => "{$m}.{$x}", $a);

        return match ($roleName) {
            'clinic_admin' => self::all(),
            'doctor' => array_merge(
                $crud('patients', ['view', 'edit']),
                $crud('appointments', ['view', 'create', 'edit']),
                ['appointments.check_in', 'appointments.prescribe'],
                $crud('doctor_schedules', ['view', 'create', 'edit', 'delete']),
                ['doctors.view', 'doctors.edit', 'services.view'], // doctors.edit: own profile only (kind rule in DoctorProfileController)
                $crud('followups'),
            ),
            'receptionist' => array_merge(
                $crud('patients'), ['patients.portal_link'], $crud('appointments'), ['appointments.check_in', 'appointments.cancel'],
                ['doctors.view', 'doctor_schedules.view', 'services.view', 'reminders.view'],
                $crud('followups'), $crud('whatsapp', ['view', 'create']), $crud('billing'), ['reports.view'],
            ),
            'assistant' => array_merge(
                $crud('patients'), $crud('appointments'), ['appointments.check_in'],
                ['doctors.view', 'doctor_schedules.view', 'services.view', 'followups.view'],
            ),
            default => [],
        };
    }
}
