<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Spatie\Permission\PermissionRegistrar;

/**
 * Backfills the role-specific dashboard permissions on existing databases.
 *
 * RolesAndPermissionsSeeder creates these for fresh installs, but re-running
 * it on a live database would also reset every built-in role's permissions
 * to the defaults. This migration is additive only: it creates the
 * permissions and grants each one to the built-in role that owns that
 * dashboard (plus clinic_admin, which has every permission), leaving any
 * other customisation untouched. Custom roles get them via the role builder.
 */
return new class extends Migration
{
    private const GRANTS = [
        'dashboard.admin' => ['clinic_admin'],
        'dashboard.receptionist' => ['clinic_admin', 'receptionist'],
        'dashboard.assistant' => ['clinic_admin', 'assistant'],
    ];

    public function up(): void
    {
        $tables = config('permission.table_names');
        $now = now();

        foreach (self::GRANTS as $permission => $roleNames) {
            $permissionId = DB::table($tables['permissions'])
                ->where('name', $permission)->where('guard_name', 'web')->value('id');

            if (! $permissionId) {
                $permissionId = DB::table($tables['permissions'])->insertGetId([
                    'name' => $permission, 'guard_name' => 'web', 'created_at' => $now, 'updated_at' => $now,
                ]);
            }

            $roleIds = DB::table($tables['roles'])
                ->whereIn('name', $roleNames)->where('guard_name', 'web')->pluck('id');

            foreach ($roleIds as $roleId) {
                DB::table($tables['role_has_permissions'])->insertOrIgnore([
                    'permission_id' => $permissionId, 'role_id' => $roleId,
                ]);
            }
        }

        app(PermissionRegistrar::class)->forgetCachedPermissions();
    }

    public function down(): void
    {
        $tables = config('permission.table_names');
        $ids = DB::table($tables['permissions'])
            ->whereIn('name', array_keys(self::GRANTS))->where('guard_name', 'web')->pluck('id');

        DB::table($tables['role_has_permissions'])->whereIn('permission_id', $ids)->delete();
        DB::table($tables['model_has_permissions'])->whereIn('permission_id', $ids)->delete();
        DB::table($tables['permissions'])->whereIn('id', $ids)->delete();

        app(PermissionRegistrar::class)->forgetCachedPermissions();
    }
};
