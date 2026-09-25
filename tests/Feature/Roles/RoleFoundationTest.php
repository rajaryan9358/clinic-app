<?php

namespace Tests\Feature\Roles;

use App\Models\Clinic;
use App\Models\Role;
use App\Models\User;
use App\Support\PermissionCatalogue;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Spatie\Permission\Models\Permission;
use Tests\TestCase;

class RoleFoundationTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
    }

    private function user(string $role): User
    {
        $clinic = Clinic::firstOrCreate(['slug' => 'c'], ['uuid' => (string) Str::uuid(), 'name' => 'C', 'status' => 'active']);
        $u = User::create(['clinic_id' => $role === 'super_admin' ? null : $clinic->id, 'uuid' => (string) Str::uuid(), 'full_name' => $role,
            'email' => Str::random(6).'@x.test', 'password' => 'x', 'role' => $role, 'status' => 'active']);
        $u->syncRoles([$role]);

        return $u;
    }

    public function test_catalogue_is_seeded_exactly(): void
    {
        $this->assertEqualsCanonicalizing(PermissionCatalogue::all(), Permission::pluck('name')->all());
        $this->assertContains('appointments.check_in', PermissionCatalogue::all());
        $this->assertNotContains('reports.create', PermissionCatalogue::all());
        $this->assertSame('check in appointments', PermissionCatalogue::label('appointments.check_in'));
        $this->assertSame('create patients', PermissionCatalogue::label('patients.create'));
    }

    public function test_system_roles_have_kinds_and_flags(): void
    {
        $expect = ['super_admin' => 'super_admin', 'clinic_admin' => 'clinic_admin', 'doctor' => 'doctor', 'receptionist' => 'staff', 'assistant' => 'staff'];
        foreach ($expect as $name => $kind) {
            $role = Role::findByName($name, 'web');
            $this->assertInstanceOf(Role::class, $role);
            $this->assertSame($kind, $role->kind);
            $this->assertTrue($role->is_system);
        }
        $this->assertTrue(Role::findByName('assistant', 'web')->limit_to_assigned_doctors);
        $this->assertSame('Receptionist', Role::findByName('receptionist', 'web')->label);
    }

    public function test_kind_helpers_and_gate_before(): void
    {
        $this->assertSame('super_admin', $this->user('super_admin')->roleKind());
        $admin = $this->user('clinic_admin');
        $this->assertSame('clinic_admin', $admin->roleKind());
        $this->assertTrue($admin->can('staff.delete'));           // Gate::before — full access
        $recep = $this->user('receptionist');
        $this->assertSame('staff', $recep->roleKind());
        $this->assertTrue($recep->can('patients.create'));
        $this->assertFalse($recep->can('staff.view'));
        $this->assertTrue($this->user('assistant')->limitsToAssignedDoctors());
        $this->assertSame('doctor', $this->user('doctor')->roleKind());
    }
}
