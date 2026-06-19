<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;
use Spatie\Permission\PermissionRegistrar;

class RolesAndPermissionsSeeder extends Seeder
{
    public function run(): void
    {
        app(PermissionRegistrar::class)->forgetCachedPermissions();

        $modules = [
            'clinics', 'branches', 'domains', 'users', 'roles', 'permissions', 'doctors', 'schedules',
            'services', 'patients', 'patient_notes', 'appointments', 'followups', 'reminders',
            'whatsapp_accounts', 'whatsapp_templates', 'whatsapp_conversations', 'invoices', 'payments',
            'settings', 'audit_logs',
        ];

        $actions = ['view_any', 'view', 'create', 'update', 'delete', 'restore', 'block', 'unblock', 'change_status'];

        $allPermissions = [];
        foreach ($modules as $module) {
            foreach ($actions as $action) {
                $allPermissions[] = Permission::firstOrCreate([
                    'name' => "{$module}.{$action}",
                    'guard_name' => 'web',
                ]);
            }
        }

        $roles = [
            'super_admin',
            'clinic_admin',
            'branch_manager',
            'doctor',
            'receptionist',
            'assistant',
        ];

        foreach ($roles as $roleName) {
            Role::firstOrCreate(['name' => $roleName, 'guard_name' => 'web']);
        }

        Role::findByName('super_admin')->syncPermissions($allPermissions);

        Role::findByName('clinic_admin')->syncPermissions(
            Permission::whereNotIn('name', ['roles.delete', 'permissions.delete'])->get()
        );

        Role::findByName('branch_manager')->syncPermissions(Permission::where(function ($q) {
            $q->where('name', 'like', 'branches.%')
                ->orWhere('name', 'like', 'appointments.%')
                ->orWhere('name', 'like', 'patients.%')
                ->orWhere('name', 'like', 'followups.%')
                ->orWhere('name', 'like', 'reminders.%');
        })->get());

        Role::findByName('doctor')->syncPermissions(Permission::where(function ($q) {
            $q->where('name', 'like', 'appointments.%')
                ->orWhere('name', 'like', 'patients.view%')
                ->orWhere('name', 'like', 'patient_notes.%')
                ->orWhere('name', 'like', 'schedules.%');
        })->get());

        Role::findByName('receptionist')->syncPermissions(Permission::where(function ($q) {
            $q->where('name', 'like', 'appointments.%')
                ->orWhere('name', 'like', 'patients.%')
                ->orWhere('name', 'like', 'reminders.%')
                ->orWhere('name', 'like', 'followups.%');
        })->get());

        Role::findByName('assistant')->syncPermissions(Permission::where(function ($q) {
            $q->where('name', 'like', 'patients.view%')
                ->orWhere('name', 'like', 'appointments.view%')
                ->orWhere('name', 'like', 'followups.view%');
        })->get());
    }
}
