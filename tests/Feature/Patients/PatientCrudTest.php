<?php

namespace Tests\Feature\Patients;

use App\Models\Clinic;
use App\Models\DoctorSchedule;
use App\Models\Patient;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * Clinic patients CRUD: Api\Clinic\PatientController (BaseClinicCrudController),
 * routes from registerCrudRoutes('patients', ..., 'patients') in routes/api.php.
 */
class PatientCrudTest extends TestCase
{
    use RefreshDatabase, PatientTestHelpers;

    private Clinic $clinic;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
        $this->clinic = $this->makeClinic('Sunrise');
    }

    // --- Create ----------------------------------------------------------

    #[Test]
    public function receptionist_creates_patient_with_prd_fields(): void
    {
        Sanctum::actingAs($this->makeUser($this->clinic, 'receptionist'));

        $res = $this->postJson('/api/clinic/patients', [
            'first_name' => 'Asha',
            'last_name' => 'Verma',
            'phone' => '9000011111',
            'gender' => 'female',
            'dob' => '1990-05-14',
            'age' => 35,
            'address_line_1' => '12 MG Road',
            'city' => 'Pune',
        ]);

        $res->assertCreated();
        $this->assertTrue($res->json('success'));
        $this->assertSame('Asha Verma', $res->json('data.full_name'));
        $this->assertSame($this->clinic->id, (int) $res->json('data.clinic_id'));
        $this->assertNotEmpty($res->json('data.uuid'));

        $patient = Patient::findOrFail($res->json('data.id'));
        $this->assertSame('active', $patient->status_tag);
        $this->assertSame('female', $patient->gender);
        $this->assertSame('1990-05-14', $patient->dob->toDateString());
        $this->assertSame('12 MG Road', $patient->address_line_1);
    }

    #[Test]
    public function create_with_only_name_and_phone_leaves_optional_fields_null(): void
    {
        Sanctum::actingAs($this->makeUser($this->clinic));

        $res = $this->postJson('/api/clinic/patients', ['first_name' => 'Solo', 'phone' => '9000022222']);

        $res->assertCreated();
        $this->assertSame('Solo', $res->json('data.full_name'));
        $this->assertDatabaseHas('patients', [
            'id' => $res->json('data.id'),
            'gender' => null,
            'dob' => null,
            'address_line_1' => null,
        ]);
    }

    #[Test]
    public function create_ignores_clinic_id_from_payload(): void
    {
        $other = $this->makeClinic('Other');
        Sanctum::actingAs($this->makeUser($this->clinic));

        $res = $this->postJson('/api/clinic/patients', [
            'first_name' => 'Spoof', 'phone' => '9000033333', 'clinic_id' => $other->id,
        ]);

        $res->assertCreated();
        $this->assertDatabaseHas('patients', ['id' => $res->json('data.id'), 'clinic_id' => $this->clinic->id]);
        $this->assertDatabaseMissing('patients', ['clinic_id' => $other->id]);
    }

    public static function invalidCreatePayloads(): array
    {
        return [
            'empty body' => [[]],
            'missing phone' => [['first_name' => 'NoPhone']],
            'missing name' => [['phone' => '9000044444']],
            'invalid gender' => [['first_name' => 'G', 'phone' => '9000055555', 'gender' => 'unknown']],
        ];
    }

    #[Test]
    #[DataProvider('invalidCreatePayloads')]
    public function create_rejects_invalid_payload_with_422(array $payload): void
    {
        Sanctum::actingAs($this->makeUser($this->clinic));

        $this->postJson('/api/clinic/patients', $payload)->assertStatus(422);
        $this->assertSame(0, Patient::count());
    }

    #[Test]
    public function create_ignores_managed_by_patient_id(): void
    {
        $other = $this->makeClinic('Other');
        $foreign = $this->makePatient($other, ['first_name' => 'Foreign', 'last_name' => 'Holder', 'phone' => '9111100000']);
        $holder = $this->makePatient($this->clinic, ['first_name' => 'Local', 'last_name' => 'Holder']);
        Sanctum::actingAs($this->makeUser($this->clinic));

        foreach ([$foreign, $holder] as $manager) {
            $res = $this->postJson('/api/clinic/patients', [
                'first_name' => 'Kid', 'phone' => '9000066666', 'managed_by_patient_id' => $manager->id,
            ])->assertCreated();

            $this->assertNull(Patient::find($res->json('data.id'))->managed_by_patient_id);
        }
    }

    #[Test]
    public function generic_update_cannot_bypass_flat_family_hierarchy(): void
    {
        $holder = $this->makePatient($this->clinic);
        $dependent = $this->makePatient($this->clinic, ['managed_by_patient_id' => $holder->id]);
        $other = $this->makePatient($this->clinic);
        Sanctum::actingAs($this->makeUser($this->clinic));

        // Manager that is itself a dependent.
        $this->putJson("/api/clinic/patients/{$other->id}", ['managed_by_patient_id' => $dependent->id])->assertOk();
        $this->assertNull($other->fresh()->managed_by_patient_id);

        // Account holder with dependents becoming a dependent.
        $this->putJson("/api/clinic/patients/{$holder->id}", ['managed_by_patient_id' => $other->id])->assertOk();
        $this->assertNull($holder->fresh()->managed_by_patient_id);

        // Clearing the link also goes through the managed-by endpoint only.
        $this->putJson("/api/clinic/patients/{$dependent->id}", ['managed_by_patient_id' => null, 'city' => 'Pune'])->assertOk();
        $this->assertSame($holder->id, $dependent->fresh()->managed_by_patient_id);
        $this->assertSame('Pune', $dependent->fresh()->city);
    }

    #[Test]
    public function update_rejects_cross_clinic_links_and_system_fields(): void
    {
        $other = $this->makeClinic('Other');
        $foreign = $this->makePatient($other);
        $foreignDoctor = $this->makeDoctor($other);
        $p = $this->makePatient($this->clinic);
        Sanctum::actingAs($this->makeUser($this->clinic));

        $this->putJson("/api/clinic/patients/{$p->id}", ['managed_by_patient_id' => $foreign->id])->assertOk();
        $this->assertNull($p->fresh()->managed_by_patient_id);
        $this->putJson("/api/clinic/patients/{$p->id}", ['preferred_doctor_id' => $foreignDoctor->id])
            ->assertUnprocessable()->assertJsonValidationErrors(['preferred_doctor_id']);
        $this->putJson("/api/clinic/patients/{$p->id}", ['phone' => null])
            ->assertUnprocessable()->assertJsonValidationErrors(['phone']);

        $this->putJson("/api/clinic/patients/{$p->id}", ['visit_count' => 99, 'uuid' => 'spoofed', 'city' => 'Pune'])->assertOk();
        $fresh = $p->fresh();
        $this->assertSame(0, (int) $fresh->visit_count);
        $this->assertSame($p->uuid, $fresh->uuid);
        $this->assertSame('Pune', $fresh->city);
    }

    #[Test]
    public function profile_does_not_expose_a_preexisting_cross_clinic_manager(): void
    {
        $other = $this->makeClinic('Other');
        $foreign = $this->makePatient($other);
        $p = $this->makePatient($this->clinic, ['managed_by_patient_id' => $foreign->id]);
        Sanctum::actingAs($this->makeUser($this->clinic));

        $this->getJson("/api/clinic/patients/{$p->id}/profile")->assertOk()->assertJsonPath('data.family.managed_by', null);
    }

    // --- Duplicate avoidance -------------------------------------------

    #[Test]
    public function direct_create_with_existing_phone_in_same_clinic_creates_second_record(): void
    {
        // Pinned current behaviour: the CRUD store does no phone dedupe
        // (families commonly share one phone). Only inline creation via
        // AppointmentService::create() dedupes by (clinic_id, phone).
        $this->makePatient($this->clinic, ['first_name' => 'First', 'phone' => '9000077777']);
        Sanctum::actingAs($this->makeUser($this->clinic));

        $this->postJson('/api/clinic/patients', ['first_name' => 'Second', 'phone' => '9000077777'])->assertCreated();

        $this->assertSame(2, Patient::where('clinic_id', $this->clinic->id)->where('phone', '9000077777')->count());
    }

    #[Test]
    public function same_phone_in_another_clinic_is_allowed(): void
    {
        $other = $this->makeClinic('Other');
        $this->makePatient($other, ['phone' => '9000088888']);
        Sanctum::actingAs($this->makeUser($this->clinic));

        $this->postJson('/api/clinic/patients', ['first_name' => 'Here', 'phone' => '9000088888'])->assertCreated();

        $this->assertSame(1, Patient::where('clinic_id', $this->clinic->id)->where('phone', '9000088888')->count());
        $this->assertSame(1, Patient::where('clinic_id', $other->id)->where('phone', '9000088888')->count());
    }

    #[Test]
    public function inline_appointment_booking_reuses_existing_patient_by_phone_within_clinic_only(): void
    {
        $other = $this->makeClinic('Other');
        $foreignTwin = $this->makePatient($other, ['first_name' => 'Twin', 'phone' => '9000099999']);
        $existing = $this->makePatient($this->clinic, ['first_name' => 'Existing', 'phone' => '9000099999']);

        $doctor = $this->makeDoctor($this->clinic);
        $date = Carbon::now()->addDays(2)->startOfDay();
        DoctorSchedule::create([
            'clinic_id' => $this->clinic->id, 'doctor_id' => $doctor->id, 'day_of_week' => $date->dayOfWeek,
            'start_time' => '10:00:00', 'end_time' => '12:00:00', 'consultation_mode' => 'in_person', 'is_active' => true,
        ]);
        Sanctum::actingAs($this->makeUser($this->clinic, 'receptionist'));

        $res = $this->postJson('/api/clinic/appointments', [
            'doctor_id' => $doctor->id,
            'appointment_date' => $date->toDateString(),
            'start_time' => '10:00',
            'end_time' => '10:30',
            'visit_type' => 'new',
            'booking_channel' => 'walk_in',
            'patient' => ['phone' => '9000099999', 'first_name' => 'Different', 'last_name' => 'Name'],
        ]);

        $res->assertCreated();
        $this->assertSame($existing->id, (int) $res->json('data.patient_id'));
        $this->assertSame(1, Patient::where('clinic_id', $this->clinic->id)->where('phone', '9000099999')->count());
        $this->assertSame('Existing', $existing->fresh()->first_name, 'existing record must not be overwritten');
        $this->assertSame('Twin', $foreignTwin->fresh()->first_name);
    }

    // --- Read / list / search -----------------------------------------

    #[Test]
    public function show_returns_patient_with_clinic(): void
    {
        $p = $this->makePatient($this->clinic, ['first_name' => 'Ravi', 'last_name' => 'Kumar']);
        Sanctum::actingAs($this->makeUser($this->clinic));

        $this->getJson("/api/clinic/patients/{$p->id}")
            ->assertOk()
            ->assertJsonPath('data.id', $p->id)
            ->assertJsonPath('data.full_name', 'Ravi Kumar')
            ->assertJsonPath('data.clinic.id', $this->clinic->id);
    }

    #[Test]
    public function list_only_returns_own_clinic_patients(): void
    {
        $other = $this->makeClinic('Other');
        $mine = $this->makePatient($this->clinic);
        $this->makePatient($other);
        Sanctum::actingAs($this->makeUser($this->clinic));

        $res = $this->getJson('/api/clinic/patients')->assertOk();

        $this->assertSame([$mine->id], array_column($res->json('data'), 'id'));
        $this->assertSame(1, $res->json('meta.total'));
    }

    #[Test]
    public function list_search_matches_name(): void
    {
        $hit = $this->makePatient($this->clinic, ['first_name' => 'Meenakshi', 'last_name' => 'Iyer']);
        $this->makePatient($this->clinic, ['first_name' => 'Rahul', 'last_name' => 'Shah']);
        Sanctum::actingAs($this->makeUser($this->clinic));

        $res = $this->getJson('/api/clinic/patients?search=meenak')->assertOk();

        $this->assertSame([$hit->id], array_column($res->json('data'), 'id'));
    }

    #[Test]
    public function list_search_matches_partial_phone(): void
    {
        $hit = $this->makePatient($this->clinic, ['phone' => '9123456789']);
        $this->makePatient($this->clinic, ['phone' => '9000000000']);
        Sanctum::actingAs($this->makeUser($this->clinic));

        $res = $this->getJson('/api/clinic/patients?search=34567')->assertOk();

        $this->assertSame([$hit->id], array_column($res->json('data'), 'id'));
    }

    #[Test]
    public function list_search_does_not_leak_other_clinic_matches(): void
    {
        $other = $this->makeClinic('Other');
        $this->makePatient($other, ['first_name' => 'Uniquename']);
        $mine = $this->makePatient($this->clinic, ['first_name' => 'Uniquename']);
        Sanctum::actingAs($this->makeUser($this->clinic));

        $res = $this->getJson('/api/clinic/patients?search=Uniquename')->assertOk();

        $this->assertSame([$mine->id], array_column($res->json('data'), 'id'));
    }

    #[Test]
    public function list_paginates_with_per_page(): void
    {
        foreach (range(1, 5) as $i) {
            $this->makePatient($this->clinic, ['first_name' => "P{$i}"]);
        }
        Sanctum::actingAs($this->makeUser($this->clinic));

        $res = $this->getJson('/api/clinic/patients?per_page=2&page=3')->assertOk();

        $this->assertCount(1, $res->json('data'));
        $res->assertJsonPath('meta.total', 5)
            ->assertJsonPath('meta.per_page', 2)
            ->assertJsonPath('meta.current_page', 3)
            ->assertJsonPath('meta.last_page', 3);
    }

    #[Test]
    public function list_rejects_invalid_sort_direction_without_500(): void
    {
        // Note: sort_by is also unvalidated, but SQLite treats an unknown
        // quoted identifier as a string literal, so that can't be pinned here.
        $this->makePatient($this->clinic);
        Sanctum::actingAs($this->makeUser($this->clinic));

        $status = $this->getJson('/api/clinic/patients?sort_dir=sideways')->status();
        $this->assertContains($status, [200, 422]);
    }

    #[Test]
    public function status_route_is_rejected_for_patients_without_500(): void
    {
        $patient = $this->makePatient($this->clinic);
        Sanctum::actingAs($this->makeUser($this->clinic));

        $this->postJson("/api/clinic/patients/{$patient->id}/status", ['status' => 'active'])
            ->assertUnprocessable();
    }

    #[Test]
    public function list_falls_back_to_default_sort_for_unknown_column(): void
    {
        $first = $this->makePatient($this->clinic);
        $second = $this->makePatient($this->clinic);
        Sanctum::actingAs($this->makeUser($this->clinic));

        $res = $this->getJson('/api/clinic/patients?sort_by=nope&sort_dir=desc')->assertOk();
        $this->assertSame([$second->id, $first->id], array_column($res->json('data'), 'id'));
    }

    #[Test]
    public function doctor_only_sees_patients_whose_preferred_doctor_is_them(): void
    {
        [$user, $doctor] = $this->makeDoctorUser($this->clinic);
        $otherDoctor = $this->makeDoctor($this->clinic);
        $mine = $this->makePatient($this->clinic, ['preferred_doctor_id' => $doctor->id]);
        $theirs = $this->makePatient($this->clinic, ['preferred_doctor_id' => $otherDoctor->id]);
        Sanctum::actingAs($user);

        $res = $this->getJson('/api/clinic/patients')->assertOk();
        $this->assertSame([$mine->id], array_column($res->json('data'), 'id'));

        $this->getJson("/api/clinic/patients/{$theirs->id}")->assertNotFound();
        $this->getJson("/api/clinic/patients/{$theirs->id}/profile")->assertNotFound();
    }

    // --- Update / delete ----------------------------------------------

    #[Test]
    public function update_changes_fields_and_recomputes_full_name(): void
    {
        $p = $this->makePatient($this->clinic, ['first_name' => 'Old', 'last_name' => 'Name']);
        Sanctum::actingAs($this->makeUser($this->clinic, 'receptionist'));

        $this->putJson("/api/clinic/patients/{$p->id}", [
            'first_name' => 'New', 'city' => 'Nagpur', 'gender' => 'male',
        ])->assertOk()->assertJsonPath('data.full_name', 'New Name');

        $fresh = $p->fresh();
        $this->assertSame('Nagpur', $fresh->city);
        $this->assertSame('male', $fresh->gender);
    }

    #[Test]
    public function update_cannot_move_patient_to_another_clinic(): void
    {
        $other = $this->makeClinic('Other');
        $p = $this->makePatient($this->clinic);
        Sanctum::actingAs($this->makeUser($this->clinic));

        $this->putJson("/api/clinic/patients/{$p->id}", ['clinic_id' => $other->id, 'city' => 'X'])->assertOk();

        $this->assertSame($this->clinic->id, $p->fresh()->clinic_id);
    }

    #[Test]
    public function delete_soft_deletes_hides_from_list_and_restore_brings_back(): void
    {
        $p = $this->makePatient($this->clinic);
        Sanctum::actingAs($this->makeUser($this->clinic));

        $this->deleteJson("/api/clinic/patients/{$p->id}")->assertOk()->assertJsonPath('success', true);

        $this->assertSoftDeleted('patients', ['id' => $p->id]);
        $this->assertSame([], $this->getJson('/api/clinic/patients')->json('data'));
        $this->assertCount(1, $this->getJson('/api/clinic/patients?with_trashed=1')->json('data'));
        // show() deliberately includes trashed rows.
        $this->getJson("/api/clinic/patients/{$p->id}")->assertOk()->assertJsonPath('data.id', $p->id);

        $this->postJson("/api/clinic/patients/{$p->id}/restore")->assertOk();
        $this->assertNotSoftDeleted('patients', ['id' => $p->id]);
    }

    #[Test]
    public function missing_patient_returns_404(): void
    {
        Sanctum::actingAs($this->makeUser($this->clinic));

        $this->getJson('/api/clinic/patients/999999')->assertNotFound();
        $this->putJson('/api/clinic/patients/999999', ['city' => 'X'])->assertNotFound();
        $this->deleteJson('/api/clinic/patients/999999')->assertNotFound();
    }

    // --- Permissions ---------------------------------------------------

    public static function crudPermissionRoutes(): array
    {
        return [
            'list' => ['GET', '', 'patients.view'],
            'show' => ['GET', '/{id}', 'patients.view'],
            'create' => ['POST', '', 'patients.create'],
            'update' => ['PUT', '/{id}', 'patients.edit'],
            'delete' => ['DELETE', '/{id}', 'patients.delete'],
            'restore' => ['POST', '/{id}/restore', 'patients.edit'],
        ];
    }

    #[Test]
    #[DataProvider('crudPermissionRoutes')]
    public function crud_route_requires_its_permission(string $method, string $suffix, string $permission): void
    {
        $p = $this->makePatient($this->clinic);
        $uri = '/api/clinic/patients'.str_replace('{id}', (string) $p->id, $suffix);
        $payload = $method === 'POST' && $suffix === '' ? ['first_name' => 'X', 'phone' => '9000000001'] : ['city' => 'X'];

        $others = array_values(array_diff(['patients.view', 'patients.create', 'patients.edit', 'patients.delete'], [$permission]));
        Sanctum::actingAs($this->staffWith($this->clinic, $others));
        $this->json($method, $uri, $payload)->assertForbidden();

        Sanctum::actingAs($this->staffWith($this->clinic, [$permission]));
        $this->assertContains($this->json($method, $uri, $payload)->status(), [200, 201]);
    }

    #[Test]
    public function doctor_role_cannot_create_or_delete_patients(): void
    {
        [$user, $doctor] = $this->makeDoctorUser($this->clinic);
        $p = $this->makePatient($this->clinic, ['preferred_doctor_id' => $doctor->id]);
        Sanctum::actingAs($user);

        $this->postJson('/api/clinic/patients', ['first_name' => 'X', 'phone' => '9000000002'])->assertForbidden();
        $this->deleteJson("/api/clinic/patients/{$p->id}")->assertForbidden();
        $this->putJson("/api/clinic/patients/{$p->id}", ['city' => 'Allowed'])->assertOk();
    }

    #[Test]
    public function unauthenticated_requests_are_rejected(): void
    {
        $p = $this->makePatient($this->clinic);

        $this->getJson('/api/clinic/patients')->assertUnauthorized();
        $this->getJson("/api/clinic/patients/{$p->id}")->assertUnauthorized();
    }
}
