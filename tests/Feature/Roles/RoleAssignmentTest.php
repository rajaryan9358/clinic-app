<?php

namespace Tests\Feature\Roles;

use App\Models\Clinic;
use App\Models\Role;
use App\Models\User;
use App\Services\DoctorManagementService;
use App\Support\PermissionCatalogue;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class RoleAssignmentTest extends TestCase
{
    use RefreshDatabase;

    private Clinic $clinic;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
        $this->clinic = Clinic::create(['uuid' => (string) Str::uuid(), 'name' => 'C', 'slug' => 'c', 'status' => 'active']);
    }

    private function makeUser(string $roleName, ?int $clinicId = null, bool $clinicless = false): User
    {
        if (! $clinicless && $clinicId === null) {
            $clinicId = $this->clinic->id;
        }
        $u = User::create([
            'clinic_id' => $clinicId,
            'uuid' => (string) Str::uuid(),
            'full_name' => $roleName,
            'email' => Str::random(10).'@x.test',
            'password' => 'x',
            'role' => $roleName,
            'status' => 'active',
        ]);
        $u->syncRoles([$roleName]);

        return $u;
    }

    private function clinicAdmin(): User
    {
        return $this->makeUser('clinic_admin');
    }

    private function superAdmin(): User
    {
        return $this->makeUser('super_admin', null, true);
    }

    private function customRole(string $kind, array $overrides = []): Role
    {
        return Role::create(array_merge([
            'name' => 'custom_'.$kind.'_'.Str::random(6),
            'guard_name' => 'web',
            'label' => 'Custom '.ucfirst($kind),
            'kind' => $kind,
        ], $overrides));
    }

    private function staffEditor(array $permissions): User
    {
        $role = $this->customRole('staff');
        $role->syncPermissions($permissions);

        return $this->makeUser($role->name);
    }

    public function test_clinic_admin_creates_user_with_custom_staff_role(): void
    {
        $role = $this->customRole('staff');
        Sanctum::actingAs($this->clinicAdmin());

        $this->postJson('/api/clinic/users', [
            'full_name' => 'New Staff',
            'email' => 'new-staff@x.test',
            'password' => 'Secret@123',
            'role' => $role->name,
        ])->assertStatus(201);
    }

    public function test_clinic_admin_cannot_assign_doctor_role_via_staff_form(): void
    {
        Sanctum::actingAs($this->clinicAdmin());

        $this->postJson('/api/clinic/users', [
            'full_name' => 'Should Fail',
            'email' => 'should-fail@x.test',
            'password' => 'Secret@123',
            'role' => 'doctor',
        ])->assertStatus(422)
            ->assertJsonPath('errors.role.0', "Doctor logins are created from the doctor's profile.");
    }

    public function test_staff_editor_cannot_touch_clinic_admins_or_self_promote(): void
    {
        $editor = $this->staffEditor(['staff.view', 'staff.create', 'staff.edit', 'staff.delete']);
        $admin = $this->clinicAdmin();

        Sanctum::actingAs($editor);

        // cannot create a clinic_admin
        $this->postJson('/api/clinic/users', [
            'full_name' => 'Nope',
            'email' => 'nope@x.test',
            'password' => 'Secret@123',
            'role' => 'clinic_admin',
        ])->assertStatus(403)
            ->assertJsonFragment(['message' => "You can't assign the Clinic Admin role."]);

        // cannot edit an existing clinic admin
        $this->putJson("/api/clinic/users/{$admin->id}", [
            'full_name' => 'Renamed',
        ])->assertStatus(403)
            ->assertJsonFragment(['message' => "You can't change a clinic admin."]);

        // cannot change own role
        $this->putJson("/api/clinic/users/{$editor->id}", [
            'role' => 'receptionist',
        ])->assertStatus(403)
            ->assertJsonFragment(['message' => "You can't change your own access."]);

        // cannot delete, block or unblock a clinic admin either
        $this->deleteJson("/api/clinic/users/{$admin->id}")
            ->assertStatus(403)
            ->assertJsonFragment(['message' => "You can't change a clinic admin."]);
        $this->postJson("/api/clinic/users/{$admin->id}/block")
            ->assertStatus(403)
            ->assertJsonFragment(['message' => "You can't change a clinic admin."]);
        $this->postJson("/api/clinic/users/{$admin->id}/unblock")
            ->assertStatus(403)
            ->assertJsonFragment(['message' => "You can't change a clinic admin."]);
    }

    public function test_staff_editor_cannot_promote_another_staff_user_to_clinic_admin(): void
    {
        $editor = $this->staffEditor(['staff.view', 'staff.create', 'staff.edit', 'staff.delete']);
        // Target's role must be a subset of the editor's own permissions, otherwise
        // assertCanMutate's "more access than you" guard (tested separately in
        // RoleEscalationTest) fires first. `receptionist` carries far more (patients.*,
        // billing.*, ...) than this editor, so a plain staff.view peer is used here to
        // isolate the clinic-admin-role-assignment rule this test targets.
        $target = $this->staffEditor(['staff.view']);

        Sanctum::actingAs($editor);

        $this->putJson("/api/clinic/users/{$target->id}", [
            'role' => 'clinic_admin',
        ])->assertStatus(403)
            ->assertJsonFragment(['message' => "You can't assign the Clinic Admin role."]);
    }

    public function test_staff_editor_cannot_widen_own_doctor_scope(): void
    {
        $editor = $this->staffEditor(['staff.view', 'staff.create', 'staff.edit', 'staff.delete']);
        $doctor = \App\Models\Doctor::create(['clinic_id' => $this->clinic->id, 'full_name' => 'Dr Other']);

        Sanctum::actingAs($editor);

        $this->putJson("/api/clinic/users/{$editor->id}", [
            'doctor_ids' => [$doctor->id],
        ])->assertStatus(403)
            ->assertJsonFragment(['message' => "You can't change your own access."]);
    }

    public function test_staff_editor_can_resave_own_record_with_unchanged_doctor_ids(): void
    {
        $role = $this->customRole('staff', ['limit_to_assigned_doctors' => true]);
        $role->syncPermissions(['staff.view', 'staff.edit']);
        $editor = $this->makeUser($role->name);

        $doctorA = \App\Models\Doctor::create(['clinic_id' => $this->clinic->id, 'full_name' => 'Dr A']);
        $doctorB = \App\Models\Doctor::create(['clinic_id' => $this->clinic->id, 'full_name' => 'Dr B']);
        $editor->assignedDoctors()->attach($doctorA->id, ['clinic_id' => $this->clinic->id]);
        $editor->assignedDoctors()->attach($doctorB->id, ['clinic_id' => $this->clinic->id]);

        Sanctum::actingAs($editor);

        // Same assignment, submitted in a different order, alongside an unrelated field change.
        $this->putJson("/api/clinic/users/{$editor->id}", [
            'full_name' => 'Renamed Self',
            'doctor_ids' => [$doctorB->id, $doctorA->id],
        ])->assertOk();

        $this->assertSame('Renamed Self', $editor->refresh()->full_name);
        $this->assertEqualsCanonicalizing(
            [$doctorA->id, $doctorB->id],
            $editor->assignedDoctors->pluck('id')->all()
        );
    }

    public function test_staff_editor_cannot_add_a_doctor_to_own_assignment(): void
    {
        $role = $this->customRole('staff', ['limit_to_assigned_doctors' => true]);
        $role->syncPermissions(['staff.view', 'staff.edit']);
        $editor = $this->makeUser($role->name);

        $doctorA = \App\Models\Doctor::create(['clinic_id' => $this->clinic->id, 'full_name' => 'Dr A']);
        $doctorB = \App\Models\Doctor::create(['clinic_id' => $this->clinic->id, 'full_name' => 'Dr B']);
        $editor->assignedDoctors()->attach($doctorA->id, ['clinic_id' => $this->clinic->id]);

        Sanctum::actingAs($editor);

        $this->putJson("/api/clinic/users/{$editor->id}", [
            'doctor_ids' => [$doctorA->id, $doctorB->id],
        ])->assertStatus(403)
            ->assertJsonFragment(['message' => "You can't change your own access."]);
    }

    public function test_restore_respects_admin_protection_and_manageable_roles(): void
    {
        $editor = $this->staffEditor(['staff.view', 'staff.create', 'staff.edit', 'staff.delete']);
        $admin = $this->clinicAdmin();
        $admin->delete();

        Sanctum::actingAs($editor);
        $this->postJson("/api/clinic/users/{$admin->id}/restore")
            ->assertStatus(403)
            ->assertJsonFragment(['message' => "You can't change a clinic admin."]);

        $doctorUser = $this->makeUser('doctor');
        $doctorUser->delete();
        Sanctum::actingAs($this->clinicAdmin());
        $this->postJson("/api/clinic/users/{$doctorUser->id}/restore")->assertStatus(404);

        $recep = $this->makeUser('receptionist');
        $recep->delete();
        Sanctum::actingAs($this->clinicAdmin());
        $this->postJson("/api/clinic/users/{$recep->id}/restore")->assertOk();
        $this->assertNull($recep->refresh()->deleted_at);
    }

    public function test_super_admin_cannot_assign_super_admin_role_with_a_clinic(): void
    {
        Sanctum::actingAs($this->superAdmin());

        $this->postJson('/api/super-admin/users', [
            'clinic_id' => $this->clinic->id,
            'full_name' => 'Bad Admin',
            'email' => 'bad-admin@x.test',
            'password' => 'Secret@123',
            'role' => 'super_admin',
        ])->assertStatus(422);
    }

    public function test_super_admin_can_assign_clinic_admin_to_a_clinic_user(): void
    {
        Sanctum::actingAs($this->superAdmin());

        $this->postJson('/api/super-admin/users', [
            'clinic_id' => $this->clinic->id,
            'full_name' => 'Good Admin',
            'email' => 'good-admin@x.test',
            'password' => 'Secret@123',
            'role' => 'clinic_admin',
        ])->assertStatus(201);
    }

    public function test_clinic_roles_endpoint_filters_by_actor_kind(): void
    {
        Sanctum::actingAs($this->clinicAdmin());
        $data = $this->getJson('/api/clinic/roles')->assertOk()->json('data');
        $kinds = array_unique(array_column($data, 'kind'));
        $this->assertContains('clinic_admin', $kinds);
        $this->assertNotContains('doctor', $kinds);
        $this->assertNotContains('super_admin', $kinds);
        $this->assertContains('staff', $kinds);

        $editor = $this->staffEditor(['staff.view']);
        Sanctum::actingAs($editor);
        $data = $this->getJson('/api/clinic/roles')->assertOk()->json('data');
        $kinds = array_unique(array_column($data, 'kind'));
        $this->assertNotContains('clinic_admin', $kinds);
        $this->assertNotContains('doctor', $kinds);
        $this->assertNotContains('super_admin', $kinds);
        $this->assertContains('staff', $kinds);
    }

    public function test_doctor_onboarding_accepts_custom_doctor_role_and_rejects_staff_role(): void
    {
        $doctorRole = $this->customRole('doctor');
        $service = app(DoctorManagementService::class);

        $doctor = $service->create([
            'clinic_id' => $this->clinic->id,
            'full_name' => 'Dr Custom',
            'create_linked_user' => true,
            'linked_user' => [
                'full_name' => 'Dr Custom',
                'email' => 'dr-custom@x.test',
                'password' => 'Secret@123',
                'role' => $doctorRole->name,
            ],
        ]);

        $this->assertSame($doctorRole->name, $doctor->user->role);

        $this->expectException(ValidationException::class);
        $service->create([
            'clinic_id' => $this->clinic->id,
            'full_name' => 'Dr Fail',
            'create_linked_user' => true,
            'linked_user' => [
                'full_name' => 'Dr Fail',
                'email' => 'dr-fail@x.test',
                'password' => 'Secret@123',
                'role' => 'receptionist',
            ],
        ]);
    }

    public function test_doctor_onboarding_defaults_to_doctor_role_when_none_given(): void
    {
        $service = app(DoctorManagementService::class);

        $doctor = $service->create([
            'clinic_id' => $this->clinic->id,
            'full_name' => 'Dr Default',
            'create_linked_user' => true,
            'linked_user' => [
                'full_name' => 'Dr Default',
                'email' => 'dr-default@x.test',
                'password' => 'Secret@123',
            ],
        ]);

        $this->assertSame('doctor', $doctor->user->role);
    }

    public function test_me_context_exposes_permissions_by_role_kind(): void
    {
        Sanctum::actingAs($this->makeUser('receptionist'));
        $data = $this->getJson('/api/clinic/me/context')->assertOk()->json('data');
        $this->assertContains('patients.create', $data['permissions']);
        $this->assertNotContains('staff.view', $data['permissions']);
        $this->assertSame('staff', $data['role_kind']);
        $this->assertSame('Receptionist', $data['role_label']);
        $this->assertFalse($data['role_limits_assigned_doctors']);

        Sanctum::actingAs($this->clinicAdmin());
        $data = $this->getJson('/api/clinic/me/context')->assertOk()->json('data');
        $this->assertEqualsCanonicalizing(PermissionCatalogue::all(), $data['permissions']);
        $this->assertSame('clinic_admin', $data['role_kind']);
    }
}
