<?php

namespace Tests\Feature\Roles;

use App\Models\Clinic;
use App\Models\Doctor;
use App\Models\Role;
use App\Models\User;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Covers two small, additive backend extensions made to support Task 7's
 * role pickers:
 *  - SuperAdmin\UserController::show()/update() now return `doctor_ids`
 *    (mirroring the clinic UserController, which already did this).
 *  - Clinic\RolePermissionController::roles() gained a `?kind=doctor`
 *    branch for the doctor onboarding wizard's "Login role" picker.
 */
class RolePickerSupportTest extends TestCase
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

    private function superAdmin(): User
    {
        return $this->makeUser('super_admin', null, true);
    }

    private function clinicAdmin(): User
    {
        return $this->makeUser('clinic_admin');
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

    public function test_super_admin_show_and_update_return_doctor_ids_and_leave_assignment_unchanged(): void
    {
        // `assistant` is the seeded system role with limit_to_assigned_doctors = true.
        $assistant = $this->makeUser('assistant');
        $doctorA = Doctor::create(['clinic_id' => $this->clinic->id, 'full_name' => 'Dr A']);
        $doctorB = Doctor::create(['clinic_id' => $this->clinic->id, 'full_name' => 'Dr B']);
        $assistant->assignedDoctors()->attach($doctorA->id, ['clinic_id' => $this->clinic->id]);
        $assistant->assignedDoctors()->attach($doctorB->id, ['clinic_id' => $this->clinic->id]);

        Sanctum::actingAs($this->superAdmin());

        // GET: doctor_ids reflects both assigned doctors. This also exercises the
        // `assignedDoctors:id` eager load through the pivot join — Laravel qualifies
        // the restricted column as `doctors.id` for a BelongsToMany, so it doesn't
        // collide with the pivot table's own `id` primary key; if that ever regressed
        // this assertion (or the request itself) would fail with an ambiguous-column
        // SQL error.
        $show = $this->getJson("/api/super-admin/users/{$assistant->id}")
            ->assertOk()
            ->json('data');
        $this->assertEqualsCanonicalizing([$doctorA->id, $doctorB->id], $show['doctor_ids']);

        // PUT (unrelated field change, doctor_ids not submitted): response still
        // carries doctor_ids, and the assignment itself is untouched.
        $update = $this->putJson("/api/super-admin/users/{$assistant->id}", [
            'full_name' => 'Renamed Assistant',
        ])->assertOk()->json('data');

        $this->assertSame('Renamed Assistant', $update['full_name']);
        $this->assertEqualsCanonicalizing([$doctorA->id, $doctorB->id], $update['doctor_ids']);

        $this->assertEqualsCanonicalizing(
            [$doctorA->id, $doctorB->id],
            $assistant->refresh()->assignedDoctors->pluck('id')->all()
        );
    }

    public function test_clinic_roles_kind_doctor_lists_only_doctor_kind_roles(): void
    {
        $customDoctorRole = $this->customRole('doctor');

        Sanctum::actingAs($this->clinicAdmin());

        $data = $this->getJson('/api/clinic/roles?kind=doctor')->assertOk()->json('data');
        $names = array_column($data, 'name');
        $kinds = array_unique(array_column($data, 'kind'));

        $this->assertContains('doctor', $names);
        $this->assertContains($customDoctorRole->name, $names);
        $this->assertSame(['doctor'], $kinds);
        $this->assertNotContains('clinic_admin', $kinds);
        $this->assertNotContains('staff', $kinds);
        $this->assertNotContains('super_admin', $kinds);

        // The default (no `kind` param) listing is unchanged by the new branch:
        // staff kinds + clinic_admin for an admin actor, never doctor/super_admin.
        $default = $this->getJson('/api/clinic/roles')->assertOk()->json('data');
        $defaultKinds = array_unique(array_column($default, 'kind'));
        $this->assertContains('clinic_admin', $defaultKinds);
        $this->assertContains('staff', $defaultKinds);
        $this->assertNotContains('doctor', $defaultKinds);
        $this->assertNotContains('super_admin', $defaultKinds);
    }

    public function test_clinic_roles_requires_staff_view_permission_with_or_without_kind_param(): void
    {
        $role = $this->customRole('staff'); // no permissions synced
        $staffUser = $this->makeUser($role->name);

        Sanctum::actingAs($staffUser);

        $this->getJson('/api/clinic/roles?kind=doctor')->assertStatus(403);
        $this->getJson('/api/clinic/roles')->assertStatus(403);
    }
}
