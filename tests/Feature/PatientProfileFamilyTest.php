<?php

namespace Tests\Feature;

use App\Models\Clinic;
use App\Models\Patient;
use App\Models\PatientFamilyLink;
use App\Models\User;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Task 7 of the patient-portal plan: the staff patient-profile endpoint
 * must surface the portal fields (`managed_by_patient_id`,
 * `consent_given_at`, `consent_version`) and the patient's family — who
 * manages them, who they manage (dependents), and any one-directional
 * `patient_family_links` rows — so the admin UI can render the Family
 * card on PatientProfilePage.
 */
class PatientProfileFamilyTest extends TestCase
{
    use RefreshDatabase;

    private Clinic $clinic;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(RolesAndPermissionsSeeder::class);

        $this->clinic = Clinic::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Sunrise Clinic',
            'slug' => 'sunrise-clinic-'.Str::random(6),
            'status' => 'active',
        ]);
    }

    private function patient(array $overrides = []): Patient
    {
        return Patient::create(array_merge([
            'clinic_id' => $this->clinic->id,
            'uuid' => (string) Str::uuid(),
            'first_name' => 'Ravi',
            'full_name' => 'Ravi Kumar',
            'phone' => '9876543210'.random_int(0, 9),
        ], $overrides));
    }

    private function clinicAdmin(): User
    {
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

        return $user;
    }

    private function superAdmin(): User
    {
        $user = User::create([
            'clinic_id' => null,
            'uuid' => (string) Str::uuid(),
            'full_name' => 'Super Admin',
            'email' => 'super-'.Str::random(6).'@x.test',
            'password' => 'x',
            'role' => 'super_admin',
            'status' => 'active',
        ]);
        $user->assignRole('super_admin');

        return $user;
    }

    public function test_clinic_profile_includes_portal_fields_and_family(): void
    {
        $holder = $this->patient(['full_name' => 'Account Holder']);
        $dependent = $this->patient(['full_name' => 'Dependent Kid', 'managed_by_patient_id' => $holder->id]);
        $linked = $this->patient(['full_name' => 'Family Member']);

        $consentAt = Carbon::parse('2026-05-01 10:00:00');
        $holder->forceFill(['consent_given_at' => $consentAt, 'consent_version' => '2026-09-v1'])->save();

        PatientFamilyLink::create([
            'clinic_id' => $this->clinic->id,
            'patient_id' => $holder->id,
            'related_patient_id' => $linked->id,
            'relation' => 'spouse',
            'created_at' => now(),
        ]);

        Sanctum::actingAs($this->clinicAdmin());
        $response = $this->getJson("/api/clinic/patients/{$holder->id}/profile");

        $response->assertOk();
        $data = $response->json('data');

        $this->assertSame($holder->id, $data['patient']['id']);
        $this->assertNull($data['patient']['managed_by_patient_id']);
        $this->assertNotNull($data['patient']['consent_given_at']);
        $this->assertSame('2026-09-v1', $data['patient']['consent_version']);

        $this->assertNull($data['family']['managed_by']);
        $this->assertCount(1, $data['family']['dependents']);
        $this->assertSame($dependent->id, $data['family']['dependents'][0]['id']);

        $this->assertCount(1, $data['family']['links']);
        $this->assertSame($linked->id, $data['family']['links'][0]['related_patient']['id']);
        $this->assertSame('spouse', $data['family']['links'][0]['relation']);
    }

    public function test_clinic_profile_for_dependent_reports_managed_by(): void
    {
        $holder = $this->patient(['full_name' => 'Account Holder']);
        $dependent = $this->patient(['full_name' => 'Dependent Kid', 'managed_by_patient_id' => $holder->id]);

        Sanctum::actingAs($this->clinicAdmin());
        $response = $this->getJson("/api/clinic/patients/{$dependent->id}/profile");

        $response->assertOk();
        $data = $response->json('data');

        $this->assertSame($holder->id, $data['patient']['managed_by_patient_id']);
        $this->assertSame($holder->id, $data['family']['managed_by']['id']);
        $this->assertCount(0, $data['family']['dependents']);
    }

    public function test_super_admin_profile_includes_portal_fields_and_family(): void
    {
        $holder = $this->patient(['full_name' => 'Account Holder']);
        $dependent = $this->patient(['full_name' => 'Dependent Kid', 'managed_by_patient_id' => $holder->id]);

        Sanctum::actingAs($this->superAdmin());
        $response = $this->getJson("/api/super-admin/patients/{$holder->id}/profile");

        $response->assertOk();
        $data = $response->json('data');

        $this->assertArrayHasKey('managed_by_patient_id', $data['patient']);
        $this->assertArrayHasKey('consent_given_at', $data['patient']);
        $this->assertArrayHasKey('consent_version', $data['patient']);
        $this->assertCount(1, $data['family']['dependents']);
        $this->assertSame($dependent->id, $data['family']['dependents'][0]['id']);
    }
}
