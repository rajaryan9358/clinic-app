<?php

namespace Tests\Feature\TenantScoping;

use App\Models\Patient;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * Super admin generic patient writes: managed_by_patient_id only changes via
 * the managed-by endpoint, and FKs stay inside the patient's clinic.
 */
class SuperAdminPatientWriteTest extends TestCase
{
    use RefreshDatabase, TenantFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
        $this->setUpTenants();
        Sanctum::actingAs($this->superAdmin());
    }

    #[Test]
    public function create_with_admin_form_fields_works(): void
    {
        $id = $this->postJson('/api/super-admin/patients', [
            'clinic_id' => $this->clinic->id, 'first_name' => 'Asha', 'last_name' => 'Verma', 'phone' => '9000011111',
            'email' => 'asha@x.test', 'gender' => 'female', 'dob' => '1990-05-14', 'age' => 35,
            'preferred_doctor_id' => $this->local['doctor_id'],
        ])->assertCreated()->json('data.id');

        $patient = Patient::findOrFail($id);
        $this->assertSame($this->clinic->id, (int) $patient->clinic_id);
        $this->assertSame('Asha Verma', $patient->full_name);
        $this->assertSame($this->local['doctor_id'], (int) $patient->preferred_doctor_id);
    }

    #[Test]
    public function create_requires_a_clinic_and_same_clinic_foreign_keys(): void
    {
        $before = Patient::count();

        $this->postJson('/api/super-admin/patients', ['first_name' => 'A', 'phone' => '9000011112'])
            ->assertStatus(422)->assertJsonValidationErrors(['clinic_id']);

        $this->postJson('/api/super-admin/patients', [
            'clinic_id' => $this->clinic->id, 'first_name' => 'A', 'phone' => '9000011112',
            'preferred_doctor_id' => $this->foreign['doctor_id'],
        ])->assertStatus(422)->assertJsonValidationErrors(['preferred_doctor_id']);

        $this->assertSame($before, Patient::count());
    }

    #[Test]
    public function create_and_update_ignore_managed_by_patient_id(): void
    {
        $holder = Patient::find($this->local['patient_id']);
        $foreignHolder = Patient::find($this->foreign['patient_id']);

        $id = $this->postJson('/api/super-admin/patients', [
            'clinic_id' => $this->clinic->id, 'first_name' => 'Kid', 'phone' => '9000066666',
            'managed_by_patient_id' => $holder->id,
        ])->assertCreated()->json('data.id');
        $this->assertNull(Patient::find($id)->managed_by_patient_id);

        foreach ([$holder, $foreignHolder] as $manager) {
            $this->putJson("/api/super-admin/patients/{$id}", ['managed_by_patient_id' => $manager->id, 'city' => 'Pune'])->assertOk();
            $this->assertNull(Patient::find($id)->managed_by_patient_id);
        }

        // A dependent can't be detached through the generic route either.
        $dependent = $this->makePatient($this->clinic, ['managed_by_patient_id' => $holder->id]);
        $this->putJson("/api/super-admin/patients/{$dependent->id}", ['managed_by_patient_id' => null])->assertOk();
        $this->assertSame($holder->id, (int) $dependent->fresh()->managed_by_patient_id);
    }

    #[Test]
    public function update_keeps_foreign_keys_and_clinic_in_the_patients_clinic(): void
    {
        $patient = Patient::find($this->local['patient_id']);

        $this->putJson("/api/super-admin/patients/{$patient->id}", ['preferred_doctor_id' => $this->foreign['doctor_id']])
            ->assertStatus(422)->assertJsonValidationErrors(['preferred_doctor_id']);
        $this->putJson("/api/super-admin/patients/{$patient->id}", ['clinic_id' => $this->otherClinic->id])
            ->assertStatus(422)->assertJsonValidationErrors(['clinic_id']);

        $patient->refresh();
        $this->assertSame($this->clinic->id, (int) $patient->clinic_id);
        $this->assertNull($patient->preferred_doctor_id);

        // The admin edit form sends clinic_id back unchanged alongside the other fields.
        $this->putJson("/api/super-admin/patients/{$patient->id}", [
            'clinic_id' => $this->clinic->id, 'first_name' => 'Renamed', 'phone' => $patient->phone,
            'preferred_doctor_id' => $this->local['doctor_id'],
        ])->assertOk();
        $this->assertSame('Renamed', $patient->fresh()->first_name);
        $this->assertSame($this->local['doctor_id'], (int) $patient->fresh()->preferred_doctor_id);
    }
}
