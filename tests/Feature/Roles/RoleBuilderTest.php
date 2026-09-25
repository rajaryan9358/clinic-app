<?php

namespace Tests\Feature\Roles;

use App\Models\Clinic;
use App\Models\Role;
use App\Models\User;
use App\Support\PermissionCatalogue;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class RoleBuilderTest extends TestCase
{
    use RefreshDatabase;

    private Clinic $clinic;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
        $this->clinic = Clinic::create(['uuid' => (string) Str::uuid(), 'name' => 'C', 'slug' => 'c', 'status' => 'active']);
    }

    private function superAdmin(): User
    {
        $user = User::create([
            'uuid' => (string) Str::uuid(), 'full_name' => 'Super', 'email' => Str::random(6).'@x.test',
            'password' => 'x', 'role' => 'super_admin', 'status' => 'active',
        ]);
        $user->assignRole('super_admin');

        return $user;
    }

    private function clinicUser(string $role): User
    {
        $u = User::create([
            'clinic_id' => $this->clinic->id, 'uuid' => (string) Str::uuid(), 'full_name' => $role,
            'email' => Str::random(6).'@x.test', 'password' => 'x', 'role' => $role, 'status' => 'active',
        ]);
        $u->syncRoles([$role]);

        return $u;
    }

    // --- index / catalogue shape ---------------------------------------

    public function test_index_lists_roles_with_expected_shape_and_excludes_super_admin(): void
    {
        Sanctum::actingAs($this->superAdmin());

        $res = $this->getJson('/api/super-admin/roles')->assertOk();
        $names = collect($res->json('data'))->pluck('name')->all();

        $this->assertNotContains('super_admin', $names);
        $this->assertContains('receptionist', $names);

        $receptionist = collect($res->json('data'))->firstWhere('name', 'receptionist');
        $this->assertSame('Receptionist', $receptionist['label']);
        $this->assertSame('staff', $receptionist['kind']);
        $this->assertFalse($receptionist['limit_to_assigned_doctors']);
        $this->assertTrue($receptionist['is_system']);
        $this->assertContains('patients.view', $receptionist['permissions']);
        $this->assertArrayHasKey('users_count', $receptionist);
        $this->assertArrayHasKey('id', $receptionist);
        $this->assertArrayHasKey('description', $receptionist);
    }

    public function test_index_users_count_reflects_non_deleted_users_with_that_role(): void
    {
        $this->clinicUser('receptionist');
        $deleted = $this->clinicUser('receptionist');
        $deleted->delete();

        Sanctum::actingAs($this->superAdmin());
        $receptionist = collect($this->getJson('/api/super-admin/roles')->json('data'))->firstWhere('name', 'receptionist');

        $this->assertSame(1, $receptionist['users_count']);
    }

    public function test_permission_catalogue_endpoint_shape(): void
    {
        Sanctum::actingAs($this->superAdmin());

        $res = $this->getJson('/api/super-admin/permission-catalogue')->assertOk();

        $modules = collect($res->json('data.modules'));
        $patients = $modules->firstWhere('key', 'patients');
        $this->assertEqualsCanonicalizing(['view', 'create', 'edit', 'delete'], $patients['actions']);

        $reports = $modules->firstWhere('key', 'reports');
        $this->assertSame(['view'], $reports['actions']);

        $specials = collect($res->json('data.specials'));
        $checkIn = $specials->firstWhere('name', 'appointments.check_in');
        $this->assertSame('appointments', $checkIn['module']);
    }

    // --- create ----------------------------------------------------------

    public function test_create_role_success(): void
    {
        Sanctum::actingAs($this->superAdmin());

        $res = $this->postJson('/api/super-admin/roles', [
            'label' => 'Billing Clerk',
            'kind' => 'staff',
            'limit_to_assigned_doctors' => true,
            'description' => 'Handles invoices',
            'permissions' => ['billing.view', 'billing.create'],
        ])->assertCreated();

        $res->assertJsonPath('data.name', 'billing_clerk');
        $res->assertJsonPath('data.label', 'Billing Clerk');
        $res->assertJsonPath('data.kind', 'staff');
        $res->assertJsonPath('data.limit_to_assigned_doctors', true);
        $res->assertJsonPath('data.is_system', false);
        $this->assertEqualsCanonicalizing(['billing.view', 'billing.create'], $res->json('data.permissions'));

        $this->assertDatabaseHas('roles', ['name' => 'billing_clerk', 'label' => 'Billing Clerk', 'kind' => 'staff']);
    }

    public function test_create_forces_limit_to_assigned_doctors_false_for_doctor_kind(): void
    {
        Sanctum::actingAs($this->superAdmin());

        $res = $this->postJson('/api/super-admin/roles', [
            'label' => 'Junior Doctor',
            'kind' => 'doctor',
            'limit_to_assigned_doctors' => true,
            'permissions' => ['patients.view'],
        ])->assertCreated();

        $res->assertJsonPath('data.limit_to_assigned_doctors', false);
    }

    public function test_create_validation_errors(): void
    {
        Sanctum::actingAs($this->superAdmin());

        $this->postJson('/api/super-admin/roles', ['kind' => 'staff'])->assertStatus(422); // label required
        $this->postJson('/api/super-admin/roles', ['label' => str_repeat('a', 61), 'kind' => 'staff'])->assertStatus(422); // max:60
        $this->postJson('/api/super-admin/roles', ['label' => 'X', 'kind' => 'clinic_admin'])->assertStatus(422); // kind not in staff,doctor
        $this->postJson('/api/super-admin/roles', ['label' => 'X', 'kind' => 'staff', 'description' => str_repeat('a', 501)])->assertStatus(422);
        $this->postJson('/api/super-admin/roles', ['label' => 'X', 'kind' => 'staff', 'permissions' => ['not.a.permission']])->assertStatus(422);
    }

    public function test_create_duplicate_name_is_rejected(): void
    {
        Sanctum::actingAs($this->superAdmin());

        $this->postJson('/api/super-admin/roles', ['label' => 'Billing Clerk', 'kind' => 'staff'])->assertCreated();

        $this->postJson('/api/super-admin/roles', ['label' => 'Billing Clerk', 'kind' => 'staff'])
            ->assertStatus(422)
            ->assertJsonFragment(['message' => 'A role with this name already exists.']);
    }

    // --- update ------------------------------------------------------------

    public function test_role_in_use_cannot_be_deleted_and_name_is_immutable(): void
    {
        Sanctum::actingAs($this->superAdmin());
        $roleId = $this->postJson('/api/super-admin/roles', [
            'label' => 'Front Desk', 'kind' => 'staff', 'permissions' => ['patients.view'],
        ])->assertCreated()->json('data.id');

        $user = $this->clinicUser('front_desk');
        $this->assertTrue($user->can('patients.view'));

        $this->putJson("/api/super-admin/roles/{$roleId}", ['label' => 'Front Desk Team'])
            ->assertOk()
            ->assertJsonPath('data.label', 'Front Desk Team')
            ->assertJsonPath('data.name', 'front_desk');

        $this->assertDatabaseHas('roles', ['id' => $roleId, 'name' => 'front_desk', 'label' => 'Front Desk Team']);

        // The user's role still resolves fine after the rename.
        $fresh = User::find($user->id);
        $this->assertSame('front_desk', $fresh->role);
        $this->assertTrue($fresh->can('patients.view'));

        $this->deleteJson("/api/super-admin/roles/{$roleId}")
            ->assertStatus(422)
            ->assertJsonFragment(['message' => 'Move its 1 users to another role first.']);

        $this->assertDatabaseHas('roles', ['id' => $roleId]);
    }

    public function test_update_validation_errors(): void
    {
        Sanctum::actingAs($this->superAdmin());
        $roleId = $this->postJson('/api/super-admin/roles', ['label' => 'Front Desk', 'kind' => 'staff'])
            ->assertCreated()->json('data.id');

        $this->putJson("/api/super-admin/roles/{$roleId}", ['label' => str_repeat('a', 61)])->assertStatus(422);
        $this->putJson("/api/super-admin/roles/{$roleId}", ['permissions' => ['bogus.permission']])->assertStatus(422);
    }

    public function test_update_forces_limit_to_assigned_doctors_false_when_kind_is_doctor(): void
    {
        Sanctum::actingAs($this->superAdmin());
        $roleId = $this->postJson('/api/super-admin/roles', ['label' => 'Junior Doctor', 'kind' => 'doctor'])
            ->assertCreated()->json('data.id');

        $this->putJson("/api/super-admin/roles/{$roleId}", ['limit_to_assigned_doctors' => true])
            ->assertOk()
            ->assertJsonPath('data.limit_to_assigned_doctors', false);
    }

    public function test_system_role_kind_is_immutable(): void
    {
        Sanctum::actingAs($this->superAdmin());
        $receptionistId = Role::findByName('receptionist', 'web')->id;

        $this->putJson("/api/super-admin/roles/{$receptionistId}", ['kind' => 'doctor'])
            ->assertStatus(422)
            ->assertJsonFragment(['message' => "A role's kind can't be changed after it's created."]);

        $this->assertDatabaseHas('roles', ['id' => $receptionistId, 'kind' => 'staff']);
    }

    public function test_custom_role_kind_is_immutable_even_when_in_use(): void
    {
        Sanctum::actingAs($this->superAdmin());
        $roleId = $this->postJson('/api/super-admin/roles', ['label' => 'Front Desk', 'kind' => 'staff'])
            ->assertCreated()->json('data.id');
        $this->clinicUser('front_desk');

        $this->putJson("/api/super-admin/roles/{$roleId}", ['kind' => 'doctor'])
            ->assertStatus(422)
            ->assertJsonFragment(['message' => "A role's kind can't be changed after it's created."]);

        $this->assertDatabaseHas('roles', ['id' => $roleId, 'kind' => 'staff']);
    }

    public function test_update_with_same_kind_and_new_label_succeeds(): void
    {
        Sanctum::actingAs($this->superAdmin());
        $roleId = $this->postJson('/api/super-admin/roles', ['label' => 'Front Desk', 'kind' => 'staff'])
            ->assertCreated()->json('data.id');

        $this->putJson("/api/super-admin/roles/{$roleId}", ['kind' => 'staff', 'label' => 'Front Desk Team'])
            ->assertOk()
            ->assertJsonPath('data.kind', 'staff')
            ->assertJsonPath('data.label', 'Front Desk Team');
    }

    public function test_clinic_admin_role_permissions_cannot_be_edited(): void
    {
        Sanctum::actingAs($this->superAdmin());
        $clinicAdminId = Role::findByName('clinic_admin', 'web')->id;

        $this->putJson("/api/super-admin/roles/{$clinicAdminId}", ['permissions' => ['patients.view']])
            ->assertStatus(422)
            ->assertJsonFragment(['message' => 'Clinic Admin always has full access.']);

        // Other fields on clinic_admin remain editable.
        $this->putJson("/api/super-admin/roles/{$clinicAdminId}", ['description' => 'Runs the clinic'])
            ->assertOk()
            ->assertJsonPath('data.description', 'Runs the clinic');
    }

    public function test_super_admin_role_is_hidden_from_update_and_delete(): void
    {
        Sanctum::actingAs($this->superAdmin());
        $superAdminId = Role::findByName('super_admin', 'web')->id;

        $this->putJson("/api/super-admin/roles/{$superAdminId}", ['description' => 'x'])->assertStatus(404);
        $this->deleteJson("/api/super-admin/roles/{$superAdminId}")->assertStatus(404);
    }

    // --- delete ------------------------------------------------------------

    public function test_system_role_cannot_be_deleted(): void
    {
        Sanctum::actingAs($this->superAdmin());
        $receptionistId = Role::findByName('receptionist', 'web')->id;

        $this->deleteJson("/api/super-admin/roles/{$receptionistId}")
            ->assertStatus(422)
            ->assertJsonFragment(['message' => "Built-in roles can't be deleted."]);
    }

    public function test_unused_custom_role_can_be_deleted(): void
    {
        Sanctum::actingAs($this->superAdmin());
        $roleId = $this->postJson('/api/super-admin/roles', ['label' => 'Spare Role', 'kind' => 'staff'])
            ->assertCreated()->json('data.id');

        $this->deleteJson("/api/super-admin/roles/{$roleId}")->assertOk();
        $this->assertDatabaseMissing('roles', ['id' => $roleId]);
    }

    // --- authorization -------------------------------------------------

    public function test_non_super_admin_users_are_forbidden(): void
    {
        foreach (['clinic_admin', 'receptionist'] as $role) {
            Sanctum::actingAs($this->clinicUser($role));
            $this->getJson('/api/super-admin/roles')->assertStatus(403);
            $this->getJson('/api/super-admin/permission-catalogue')->assertStatus(403);
            $this->postJson('/api/super-admin/roles', ['label' => 'X', 'kind' => 'staff'])->assertStatus(403);
        }
    }

    // --- cache: permission change takes effect immediately -------------

    public function test_permission_change_takes_effect_immediately(): void
    {
        $receptionist = $this->clinicUser('receptionist');

        Sanctum::actingAs($receptionist);
        $this->getJson('/api/clinic/patients')->assertOk();

        Sanctum::actingAs($this->superAdmin());
        $receptionistRoleId = Role::findByName('receptionist', 'web')->id;
        $remaining = array_values(array_diff(PermissionCatalogue::defaults('receptionist'), ['patients.view']));

        $this->putJson("/api/super-admin/roles/{$receptionistRoleId}", ['permissions' => $remaining])->assertOk();

        // Same receptionist, fresh request/model — must see the change immediately.
        Sanctum::actingAs(User::find($receptionist->id));
        $this->getJson('/api/clinic/patients')->assertStatus(403);
    }
}
