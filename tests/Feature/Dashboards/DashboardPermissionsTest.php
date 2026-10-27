<?php

namespace Tests\Feature\Dashboards;

use App\Models\Role;
use App\Models\User;
use App\Support\PermissionCatalogue;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\Test;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\PermissionRegistrar;
use Tests\TestCase;

/**
 * The dashboard.* permissions: catalogue entries, role defaults, and the
 * migration that backfills them on existing databases.
 */
class DashboardPermissionsTest extends TestCase
{
    use RefreshDatabase;

    private const DASHBOARD_PERMISSIONS = ['dashboard.admin', 'dashboard.receptionist', 'dashboard.assistant'];

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
    }

    #[Test]
    public function catalogue_lists_dashboard_permissions_in_their_own_group(): void
    {
        foreach (self::DASHBOARD_PERMISSIONS as $name) {
            $this->assertContains($name, PermissionCatalogue::all());
        }
        $this->assertSame('view the clinic admin dashboard', PermissionCatalogue::label('dashboard.admin'));

        $superAdmin = User::create([
            'clinic_id' => null, 'uuid' => (string) Str::uuid(), 'full_name' => 'SA',
            'email' => 'sa@x.test', 'password' => 'x', 'role' => 'super_admin', 'status' => 'active',
        ]);
        $superAdmin->assignRole('super_admin');
        Sanctum::actingAs($superAdmin);

        $specials = collect($this->getJson('/api/super-admin/permission-catalogue')->assertOk()->json('data.specials'));
        foreach (self::DASHBOARD_PERMISSIONS as $name) {
            $this->assertSame('Dashboards', $specials->firstWhere('name', $name)['group'] ?? null, $name);
        }
        $this->assertNull($specials->firstWhere('name', 'appointments.check_in')['group']);
    }

    #[Test]
    public function system_role_defaults(): void
    {
        $perms = fn (string $role) => Role::findByName($role, 'web')->permissions->pluck('name')->all();

        $this->assertEqualsCanonicalizing(self::DASHBOARD_PERMISSIONS, array_values(array_intersect(self::DASHBOARD_PERMISSIONS, $perms('clinic_admin'))));
        $this->assertSame(['dashboard.receptionist'], array_values(array_intersect(self::DASHBOARD_PERMISSIONS, $perms('receptionist'))));
        $this->assertSame(['dashboard.assistant'], array_values(array_intersect(self::DASHBOARD_PERMISSIONS, $perms('assistant'))));
        $this->assertSame([], array_values(array_intersect(self::DASHBOARD_PERMISSIONS, $perms('doctor'))));
    }

    #[Test]
    public function migration_backfills_existing_databases_without_resetting_customisations(): void
    {
        // Simulate a database seeded before the dashboard permissions existed,
        // where the receptionist role has since been customised.
        Permission::query()->whereIn('name', self::DASHBOARD_PERMISSIONS)->delete();
        app(PermissionRegistrar::class)->forgetCachedPermissions();
        $receptionist = Role::findByName('receptionist', 'web');
        $receptionist->revokePermissionTo('billing.delete');
        $custom = Role::create(['name' => 'front_desk', 'guard_name' => 'web', 'label' => 'Front desk', 'kind' => 'staff']);
        $custom->syncPermissions(['patients.view']);

        $migration = require database_path('migrations/2026_10_27_000100_add_dashboard_permissions.php');
        $migration->up();
        $migration->up(); // idempotent

        $this->assertSame(3, Permission::query()->whereIn('name', self::DASHBOARD_PERMISSIONS)->count());

        $receptionist = Role::findByName('receptionist', 'web')->load('permissions');
        $this->assertTrue($receptionist->hasPermissionTo('dashboard.receptionist'));
        $this->assertFalse($receptionist->hasPermissionTo('dashboard.admin'));
        $this->assertFalse($receptionist->hasPermissionTo('billing.delete'), 'customisation kept');

        $assistant = Role::findByName('assistant', 'web');
        $this->assertTrue($assistant->hasPermissionTo('dashboard.assistant'));
        $this->assertFalse($assistant->hasPermissionTo('dashboard.receptionist'));

        $admin = Role::findByName('clinic_admin', 'web');
        foreach (self::DASHBOARD_PERMISSIONS as $name) {
            $this->assertTrue($admin->hasPermissionTo($name));
        }

        $this->assertFalse(Role::findByName('doctor', 'web')->hasPermissionTo('dashboard.admin'));
        $this->assertSame(['patients.view'], Role::findByName('front_desk', 'web')->permissions->pluck('name')->all());
    }
}
