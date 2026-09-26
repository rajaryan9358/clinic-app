<?php

namespace Tests\Feature\Roles;

use App\Models\Clinic;
use App\Models\Role;
use App\Models\User;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Closes the privilege-escalation path found in the final whole-branch review: a
 * staff-kind actor holding only staff.create/staff.edit (or doctors.create) could
 * assign ANY staff- or doctor-kind role to a new or existing user — including one
 * carrying permissions far beyond their own — then log in as it, or take over an
 * existing account with more access than themselves.
 */
class RoleEscalationTest extends TestCase
{
    use RefreshDatabase;

    private Clinic $clinic;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
        $this->clinic = Clinic::create(['uuid' => (string) Str::uuid(), 'name' => 'C', 'slug' => 'c', 'status' => 'active']);
    }

    private function makeUser(string $roleName): User
    {
        $u = User::create([
            'clinic_id' => $this->clinic->id,
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

    private function role(string $name, array $permissions, string $kind = 'staff'): Role
    {
        $role = Role::create([
            'name' => $name,
            'guard_name' => 'web',
            'label' => ucfirst(str_replace('_', ' ', $name)),
            'kind' => $kind,
        ]);
        $role->syncPermissions($permissions);

        return $role;
    }

    private function clinicAdmin(): User
    {
        return $this->makeUser('clinic_admin');
    }

    private function seedRoles(): void
    {
        $this->role('office_manager', ['staff.view', 'staff.create', 'staff.edit', 'patients.view']);
        $this->role('billing_lead', ['billing.view', 'billing.create', 'billing.edit', 'billing.delete', 'patients.view']);
        $this->role('front_desk_lite', ['patients.view']);
    }

    public function test_office_manager_cannot_create_user_with_billing_lead_role(): void
    {
        $this->seedRoles();
        Sanctum::actingAs($this->makeUser('office_manager'));

        $this->postJson('/api/clinic/users', [
            'full_name' => 'New Billing',
            'email' => 'new-billing@x.test',
            'password' => 'Secret@123',
            'role' => 'billing_lead',
        ])->assertStatus(403)
            ->assertJsonFragment(['message' => "You can't assign a role with permissions you don't have."]);

        $this->assertDatabaseMissing('users', ['email' => 'new-billing@x.test']);
    }

    public function test_office_manager_cannot_upgrade_existing_user_to_billing_lead_role(): void
    {
        $this->seedRoles();
        $officeManager = $this->makeUser('office_manager');
        $target = $this->makeUser('front_desk_lite');

        Sanctum::actingAs($officeManager);

        $this->putJson("/api/clinic/users/{$target->id}", [
            'role' => 'billing_lead',
        ])->assertStatus(403)
            ->assertJsonFragment(['message' => "You can't assign a role with permissions you don't have."]);

        $this->assertSame('front_desk_lite', $target->refresh()->role);
    }

    public function test_office_manager_cannot_change_a_user_with_more_access_than_them(): void
    {
        $this->seedRoles();
        $officeManager = $this->makeUser('office_manager');
        $billingUser = $this->makeUser('billing_lead');

        Sanctum::actingAs($officeManager);

        $this->putJson("/api/clinic/users/{$billingUser->id}", [
            'password' => 'NewPass@123',
        ])->assertStatus(403)
            ->assertJsonFragment(['message' => "You can't change a user with more access than you."]);

        $this->postJson("/api/clinic/users/{$billingUser->id}/block")
            ->assertStatus(403)
            ->assertJsonFragment(['message' => "You can't change a user with more access than you."]);

        // office_manager doesn't hold staff.delete at all, so destroy is denied by the
        // permission gate itself (a different, equally valid 403) before assertCanMutate
        // would even run — still confirms the account can't be deleted by this actor.
        $this->deleteJson("/api/clinic/users/{$billingUser->id}")
            ->assertStatus(403);

        $this->assertNotNull($billingUser->refresh());

        // A staff-kind actor who *does* hold staff.delete is still blocked from
        // destroying a user with more access than themselves, exercising assertCanMutate
        // (not just the permission gate) on the destroy path.
        $this->role('office_manager_full', ['staff.view', 'staff.create', 'staff.edit', 'staff.delete', 'patients.view']);
        Sanctum::actingAs($this->makeUser('office_manager_full'));

        $this->deleteJson("/api/clinic/users/{$billingUser->id}")
            ->assertStatus(403)
            ->assertJsonFragment(['message' => "You can't change a user with more access than you."]);

        $this->assertNotNull($billingUser->refresh());
    }

    public function test_office_manager_can_still_manage_users_within_their_own_permissions(): void
    {
        $this->seedRoles();
        Sanctum::actingAs($this->makeUser('office_manager'));

        $created = $this->postJson('/api/clinic/users', [
            'full_name' => 'Front Desk',
            'email' => 'front-desk@x.test',
            'password' => 'Secret@123',
            'role' => 'front_desk_lite',
        ])->assertStatus(201)->json('data');

        $this->putJson("/api/clinic/users/{$created['id']}", [
            'full_name' => 'Front Desk Renamed',
        ])->assertOk();
    }

    public function test_doctor_onboarding_rejects_explicit_and_default_doctor_role_beyond_actors_permissions(): void
    {
        $this->role('doctor_onboarder', ['doctors.create', 'doctors.view']);
        Sanctum::actingAs($this->makeUser('doctor_onboarder'));

        // Explicit linked_user.role = system `doctor` role, which carries far more
        // permissions than doctors.create/doctors.view.
        $this->postJson('/api/clinic/doctors', [
            'full_name' => 'Dr New',
            'create_linked_user' => true,
            'linked_user' => [
                'full_name' => 'Dr New',
                'email' => 'dr-new@x.test',
                'password' => 'Secret@123',
                'role' => 'doctor',
            ],
        ])->assertStatus(403)
            ->assertJsonFragment(['message' => "You can't assign a role with permissions you don't have."]);

        // Decision: no linked_user.role given defaults to the system `doctor` role,
        // which is subject to the same escalation check as an explicit role — the
        // default is not a free pass.
        $this->postJson('/api/clinic/doctors', [
            'full_name' => 'Dr Default',
            'create_linked_user' => true,
            'linked_user' => [
                'full_name' => 'Dr Default',
                'email' => 'dr-default@x.test',
                'password' => 'Secret@123',
            ],
        ])->assertStatus(403)
            ->assertJsonFragment(['message' => "You can't assign a role with permissions you don't have."]);
    }

    public function test_clinic_admin_can_onboard_doctor_with_default_doctor_role(): void
    {
        Sanctum::actingAs($this->clinicAdmin());

        $this->postJson('/api/clinic/doctors', [
            'full_name' => 'Dr Admin Onboarded',
            'create_linked_user' => true,
            'linked_user' => [
                'full_name' => 'Dr Admin Onboarded',
                'email' => 'dr-admin-onboard@x.test',
                'password' => 'Secret@123',
            ],
        ])->assertStatus(201);
    }

    public function test_clinic_admin_can_still_assign_any_staff_role_and_edit_any_user(): void
    {
        $this->seedRoles();
        Sanctum::actingAs($this->clinicAdmin());

        $created = $this->postJson('/api/clinic/users', [
            'full_name' => 'Billing By Admin',
            'email' => 'billing-by-admin@x.test',
            'password' => 'Secret@123',
            'role' => 'billing_lead',
        ])->assertStatus(201)->json('data');

        $this->putJson("/api/clinic/users/{$created['id']}", [
            'full_name' => 'Renamed By Admin',
        ])->assertOk();
    }
}
