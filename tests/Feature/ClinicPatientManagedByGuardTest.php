<?php

namespace Tests\Feature;

use App\Models\Clinic;
use App\Models\Patient;
use App\Models\User;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * The generic clinic patient CRUD (PUT/POST /api/clinic/patients) must not
 * let `managed_by_patient_id` point at another clinic's patient (or break
 * the flat family hierarchy); it follows the same rule as
 * PUT /patients/{id}/managed-by (PatientManagedByService).
 */
class ClinicPatientManagedByGuardTest extends TestCase
{
    use RefreshDatabase;

    private Clinic $clinic;

    private Clinic $other;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
        $this->clinic = $this->clinic('Sunrise');
        $this->other = $this->clinic('Other');
        $user = User::create([
            'clinic_id' => $this->clinic->id,
            'uuid' => (string) Str::uuid(),
            'full_name' => 'Amit Admin',
            'email' => 'amit-'.Str::random(6).'@x.test',
            'password' => 'x',
            'role' => 'clinic_admin',
            'status' => 'active',
        ]);
        $user->assignRole('clinic_admin');
        Sanctum::actingAs($user);
    }

    private function clinic(string $name): Clinic
    {
        return Clinic::create(['uuid' => (string) Str::uuid(), 'name' => $name, 'slug' => Str::slug($name).'-'.Str::random(6), 'status' => 'active']);
    }

    private function patient(Clinic $clinic, array $o = []): Patient
    {
        return Patient::create(array_merge([
            'clinic_id' => $clinic->id,
            'uuid' => (string) Str::uuid(),
            'first_name' => 'Test',
            'full_name' => 'Test Patient',
            'phone' => '98765'.random_int(10000, 99999),
        ], $o));
    }

    public function test_update_rejects_managed_by_in_another_clinic(): void
    {
        $dependent = $this->patient($this->clinic);
        $outsider = $this->patient($this->other);

        $this->putJson("/api/clinic/patients/{$dependent->id}", ['managed_by_patient_id' => $outsider->id])
            ->assertStatus(422);

        $this->assertNull($dependent->fresh()->managed_by_patient_id);
    }

    public function test_update_rejects_unknown_managed_by(): void
    {
        $dependent = $this->patient($this->clinic);

        $this->putJson("/api/clinic/patients/{$dependent->id}", ['managed_by_patient_id' => 999999])
            ->assertStatus(422);
    }

    public function test_update_allows_same_clinic_holder_and_clearing(): void
    {
        $holder = $this->patient($this->clinic);
        $dependent = $this->patient($this->clinic);

        $this->putJson("/api/clinic/patients/{$dependent->id}", ['first_name' => 'Baby', 'managed_by_patient_id' => $holder->id])
            ->assertOk();
        $this->assertSame($holder->id, $dependent->fresh()->managed_by_patient_id);
        $this->assertSame('Baby', $dependent->fresh()->first_name);

        $this->putJson("/api/clinic/patients/{$dependent->id}", ['managed_by_patient_id' => null])->assertOk();
        $this->assertNull($dependent->fresh()->managed_by_patient_id);
    }

    public function test_update_without_the_field_leaves_existing_link_alone(): void
    {
        $holder = $this->patient($this->clinic);
        $dependent = $this->patient($this->clinic, ['managed_by_patient_id' => $holder->id]);

        $this->putJson("/api/clinic/patients/{$dependent->id}", ['first_name' => 'Renamed'])->assertOk();

        $this->assertSame($holder->id, $dependent->fresh()->managed_by_patient_id);
    }

    public function test_store_rejects_managed_by_in_another_clinic_and_creates_nothing(): void
    {
        $outsider = $this->patient($this->other);
        $before = Patient::count();

        $this->postJson('/api/clinic/patients', [
            'first_name' => 'New',
            'full_name' => 'New Dep',
            'phone' => '9811111111',
            'managed_by_patient_id' => $outsider->id,
        ])->assertStatus(422);

        $this->assertSame($before, Patient::count());
    }

    public function test_store_allows_same_clinic_holder(): void
    {
        $holder = $this->patient($this->clinic);

        $this->postJson('/api/clinic/patients', [
            'first_name' => 'New',
            'full_name' => 'New Dep',
            'phone' => '9811111112',
            'managed_by_patient_id' => $holder->id,
        ])->assertStatus(201);

        $this->assertSame($holder->id, Patient::where('phone', '9811111112')->value('managed_by_patient_id'));
    }

    public function test_update_with_array_payload_is_422_not_500(): void
    {
        $dependent = $this->patient($this->clinic);

        $this->putJson("/api/clinic/patients/{$dependent->id}", ['managed_by_patient_id' => [5]])->assertStatus(422);
        $this->postJson('/api/clinic/patients', ['first_name' => 'N', 'full_name' => 'N', 'phone' => '9811111113', 'managed_by_patient_id' => [5]])->assertStatus(422);
    }

    public function test_profile_does_not_leak_a_cross_clinic_holder(): void
    {
        $outsider = $this->patient($this->other, ['full_name' => 'Zed Outsider', 'phone' => '9777000111']);
        $dependent = $this->patient($this->clinic);
        $dependent->forceFill(['managed_by_patient_id' => $outsider->id])->save();

        $body = $this->getJson("/api/clinic/patients/{$dependent->id}/profile")->assertOk()->getContent();

        $this->assertStringNotContainsString('Zed Outsider', $body);
        $this->assertStringNotContainsString('9777000111', $body);
    }

    public function test_super_admin_generic_crud_rejects_cross_clinic_holder(): void
    {
        $su = User::create([
            'clinic_id' => null,
            'uuid' => (string) Str::uuid(),
            'full_name' => 'Super',
            'email' => 'su-'.Str::random(6).'@x.test',
            'password' => 'x',
            'role' => 'super_admin',
            'status' => 'active',
        ]);
        $su->assignRole('super_admin');
        Sanctum::actingAs($su);

        $outsider = $this->patient($this->other);
        $dependent = $this->patient($this->clinic);

        $this->putJson("/api/super-admin/patients/{$dependent->id}", ['managed_by_patient_id' => $outsider->id])->assertStatus(422);
        $this->assertNull($dependent->fresh()->managed_by_patient_id);

        $before = Patient::count();
        $this->postJson('/api/super-admin/patients', [
            'clinic_id' => $this->clinic->id, 'first_name' => 'N', 'full_name' => 'N', 'phone' => '9811111114',
            'managed_by_patient_id' => $outsider->id,
        ])->assertStatus(422);
        $this->assertSame($before, Patient::count());

        $holder = $this->patient($this->clinic);
        $this->putJson("/api/super-admin/patients/{$dependent->id}", ['managed_by_patient_id' => $holder->id])->assertOk();
        $this->assertSame($holder->id, $dependent->fresh()->managed_by_patient_id);
    }
}
