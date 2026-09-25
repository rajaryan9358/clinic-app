<?php

namespace Database\Seeders;

use App\Models\Role;
use App\Support\PermissionCatalogue;
use Illuminate\Database\Seeder;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\PermissionRegistrar;

class RolesAndPermissionsSeeder extends Seeder
{
    public function run(): void
    {
        app(PermissionRegistrar::class)->forgetCachedPermissions();

        foreach (PermissionCatalogue::all() as $name) {
            Permission::firstOrCreate(['name' => $name, 'guard_name' => 'web']);
        }

        $system = [
            ['super_admin', 'Super Admin', 'super_admin', false],
            ['clinic_admin', 'Clinic Admin', 'clinic_admin', false],
            ['doctor', 'Doctor', 'doctor', false],
            ['receptionist', 'Receptionist', 'staff', false],
            ['assistant', 'Assistant', 'staff', true],
        ];
        foreach ($system as [$name, $label, $kind, $limit]) {
            $role = Role::firstOrCreate(['name' => $name, 'guard_name' => 'web']);
            $role->fill(['label' => $label, 'kind' => $kind, 'limit_to_assigned_doctors' => $limit, 'is_system' => true])->save();
            if ($name !== 'super_admin') {
                $role->syncPermissions(PermissionCatalogue::defaults($name));
            }
        }

        app(PermissionRegistrar::class)->forgetCachedPermissions();
    }
}
