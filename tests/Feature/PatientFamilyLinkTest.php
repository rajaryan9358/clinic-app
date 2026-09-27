<?php

namespace Tests\Feature;

use App\Models\Clinic;
use App\Models\Patient;
use App\Models\PatientFamilyLink;
use App\Models\User;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Feature\Portal\PortalTestHelpers;
use Tests\TestCase;

/**
 * Task 7 fix round 1: staff can create/remove `patient_family_links` rows
 * (App\Services\Patients\PatientFamilyLinkService, shared by the clinic and
 * super-admin Api\PatientFamilyController::{storeFamilyLink,destroyFamilyLink}).
 * A link `patient_id -> related_patient_id` is a one-directional grant: the
 * related patient's portal account can act for `patient_id`, not the
 * reverse — see App\Support\Portal\PortalProfiles::allowedFor().
 */
class PatientFamilyLinkTest extends TestCase
{
    use RefreshDatabase, PortalTestHelpers;

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
            'first_name' => 'Test',
            'full_name' => 'Test Patient',
            'phone' => '98765'.random_int(10000, 99999),
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

    // --- Clinic: create -------------------------------------------------

    public function test_clinic_creates_family_link(): void
    {
        $a = $this->patient(['full_name' => 'Holder A']);
        $b = $this->patient(['full_name' => 'Family B']);

        Sanctum::actingAs($this->clinicAdmin());
        $response = $this->postJson("/api/clinic/patients/{$a->id}/family-links", [
            'related_patient_id' => $b->id,
            'relation' => 'spouse',
        ]);

        $response->assertStatus(201);
        $this->assertTrue($response->json('success'));
        $this->assertSame($b->id, $response->json('data.related_patient.id'));
        $this->assertSame('spouse', $response->json('data.relation'));

        $this->assertDatabaseHas('patient_family_links', [
            'clinic_id' => $this->clinic->id,
            'patient_id' => $a->id,
            'related_patient_id' => $b->id,
            'relation' => 'spouse',
        ]);
    }

    public function test_clinic_create_family_link_rejects_self(): void
    {
        $a = $this->patient();

        Sanctum::actingAs($this->clinicAdmin());
        $response = $this->postJson("/api/clinic/patients/{$a->id}/family-links", [
            'related_patient_id' => $a->id,
        ]);

        $response->assertStatus(422);
        $this->assertSame('Choose a patient in this clinic.', $response->json('message'));
    }

    public function test_clinic_create_family_link_rejects_other_clinics_patient(): void
    {
        $a = $this->patient();
        $otherClinic = Clinic::create(['uuid' => (string) Str::uuid(), 'name' => 'Other', 'slug' => 'other-'.Str::random(6), 'status' => 'active']);
        $outsider = $this->patient(['clinic_id' => $otherClinic->id]);

        Sanctum::actingAs($this->clinicAdmin());
        $response = $this->postJson("/api/clinic/patients/{$a->id}/family-links", [
            'related_patient_id' => $outsider->id,
        ]);

        $response->assertStatus(422);
        $this->assertSame('Choose a patient in this clinic.', $response->json('message'));
    }

    public function test_clinic_create_family_link_rejects_unknown_patient(): void
    {
        $a = $this->patient();

        Sanctum::actingAs($this->clinicAdmin());
        $response = $this->postJson("/api/clinic/patients/{$a->id}/family-links", [
            'related_patient_id' => $a->id + 999999,
        ]);

        $response->assertStatus(422);
        $this->assertSame('Choose a patient in this clinic.', $response->json('message'));
    }

    public function test_clinic_create_family_link_rejects_duplicate(): void
    {
        $a = $this->patient();
        $b = $this->patient();

        PatientFamilyLink::create([
            'clinic_id' => $this->clinic->id,
            'patient_id' => $a->id,
            'related_patient_id' => $b->id,
            'relation' => 'spouse',
            'created_at' => now(),
        ]);

        Sanctum::actingAs($this->clinicAdmin());
        $response = $this->postJson("/api/clinic/patients/{$a->id}/family-links", [
            'related_patient_id' => $b->id,
        ]);

        $response->assertStatus(422);
        $this->assertSame('These patients are already linked.', $response->json('message'));
    }

    // --- Clinic: delete ---------------------------------------------------

    public function test_clinic_deletes_family_link(): void
    {
        $a = $this->patient();
        $b = $this->patient();

        $link = PatientFamilyLink::create([
            'clinic_id' => $this->clinic->id,
            'patient_id' => $a->id,
            'related_patient_id' => $b->id,
            'relation' => null,
            'created_at' => now(),
        ]);

        Sanctum::actingAs($this->clinicAdmin());
        $response = $this->deleteJson("/api/clinic/patients/{$a->id}/family-links/{$link->id}");

        $response->assertOk();
        $this->assertDatabaseMissing('patient_family_links', ['id' => $link->id]);
    }

    public function test_clinic_delete_family_link_belonging_to_another_patient_is_not_found(): void
    {
        $a = $this->patient();
        $b = $this->patient();
        $c = $this->patient();

        $link = PatientFamilyLink::create([
            'clinic_id' => $this->clinic->id,
            'patient_id' => $b->id,
            'related_patient_id' => $c->id,
            'relation' => null,
            'created_at' => now(),
        ]);

        Sanctum::actingAs($this->clinicAdmin());
        // Attempting to delete B's link while scoped to A must 404, not leak/delete it.
        $response = $this->deleteJson("/api/clinic/patients/{$a->id}/family-links/{$link->id}");

        $response->assertNotFound();
        $this->assertDatabaseHas('patient_family_links', ['id' => $link->id]);
    }

    // --- Super-admin ------------------------------------------------------

    public function test_super_admin_creates_family_link(): void
    {
        $a = $this->patient();
        $b = $this->patient();

        Sanctum::actingAs($this->superAdmin());
        $response = $this->postJson("/api/super-admin/patients/{$a->id}/family-links", [
            'related_patient_id' => $b->id,
            'relation' => 'sibling',
        ]);

        $response->assertStatus(201);
        $this->assertDatabaseHas('patient_family_links', [
            'clinic_id' => $this->clinic->id,
            'patient_id' => $a->id,
            'related_patient_id' => $b->id,
            'relation' => 'sibling',
        ]);
    }

    // --- Portal effect ------------------------------------------------------

    public function test_family_link_lets_related_patient_act_for_linker_but_not_the_reverse(): void
    {
        $a = $this->patient(['full_name' => 'Holder A']);
        $b = $this->patient(['full_name' => 'Family B']);

        Sanctum::actingAs($this->clinicAdmin());
        $this->postJson("/api/clinic/patients/{$a->id}/family-links", [
            'related_patient_id' => $b->id,
        ])->assertStatus(201);

        $tokenA = $this->portalToken($a);
        $tokenB = $this->portalToken($b);

        // The link is patient_id=A, related_patient_id=B: A's account (the
        // "linker") can act for B.
        $asB = $this->portalGet('/api/portal/auth/me', $tokenA, $b->id);
        $asB->assertOk();

        // The grant is one-directional — B's account cannot act for A.
        $asA = $this->portalGet('/api/portal/auth/me', $tokenB, $a->id);
        $asA->assertStatus(403);
        $this->assertSame("You can't view this profile.", $asA->json('message'));
    }
}
