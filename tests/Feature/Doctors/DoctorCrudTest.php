<?php

namespace Tests\Feature\Doctors;

use App\Models\ClinicSubscription;
use App\Models\Doctor;
use App\Models\Plan;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

class DoctorCrudTest extends TestCase
{
    use DoctorTestHelpers;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDoctors();
        Sanctum::actingAs($this->makeUser('clinic_admin'));
    }

    #[Test]
    public function admin_creates_doctor_scoped_to_own_clinic_ignoring_submitted_clinic_id(): void
    {
        $response = $this->postJson('/api/clinic/doctors', [
            'clinic_id' => $this->otherClinic->id,
            'full_name' => 'Dr New',
            'specialization' => 'Cardiology',
            'consultation_fee' => 500,
        ]);

        $response->assertCreated()->assertJsonPath('success', true)->assertJsonPath('data.full_name', 'Dr New');
        $doctor = Doctor::findOrFail($response->json('data.id'));
        $this->assertSame($this->clinic->id, (int) $doctor->clinic_id);
        $this->assertNull($doctor->user_id);
        $this->assertSame('Cardiology', $doctor->specialization);
    }

    #[Test]
    public function create_with_linked_user_creates_a_doctor_login_with_doctor_role(): void
    {
        $response = $this->postJson('/api/clinic/doctors', [
            'full_name' => 'Dr Linked',
            'create_linked_user' => true,
            'linked_user' => ['email' => 'linked@x.test', 'password' => 'secret123'],
        ])->assertCreated();

        $doctor = Doctor::findOrFail($response->json('data.id'));
        $user = User::findOrFail($doctor->user_id);
        $this->assertSame($this->clinic->id, (int) $user->clinic_id);
        $this->assertSame('Dr Linked', $user->full_name);
        $this->assertSame('linked@x.test', $user->email);
        $this->assertSame('doctor', $user->role);
        $this->assertTrue($user->hasRole('doctor'));
        $this->assertTrue(Hash::check('secret123', $user->password));
    }

    #[Test]
    public function create_with_inline_schedules_stores_them_for_the_clinic(): void
    {
        $response = $this->postJson('/api/clinic/doctors', [
            'full_name' => 'Dr Sched',
            'schedules' => [
                ['day_of_week' => 2, 'start_time' => '09:00', 'end_time' => '12:00', 'consultation_mode' => 'in_person'],
            ],
        ])->assertCreated();

        $this->assertDatabaseHas('doctor_schedules', [
            'doctor_id' => $response->json('data.id'), 'clinic_id' => $this->clinic->id, 'day_of_week' => 2,
        ]);
    }

    #[Test]
    public function create_with_malformed_inline_schedule_is_a_validation_error(): void
    {
        $this->postJson('/api/clinic/doctors', [
            'full_name' => 'Dr Bad Sched',
            'schedules' => [['start_time' => '09:00']],
        ])->assertUnprocessable();
    }

    #[Test]
    public function create_with_inverted_inline_schedule_is_a_validation_error(): void
    {
        $this->postJson('/api/clinic/doctors', [
            'full_name' => 'Dr Inverted',
            'schedules' => [['day_of_week' => 1, 'start_time' => '12:00', 'end_time' => '09:00', 'consultation_mode' => 'in_person']],
        ])->assertUnprocessable()->assertJsonValidationErrors(['schedules.0.end_time']);

        $this->assertDatabaseMissing('doctors', ['full_name' => 'Dr Inverted']);
    }

    #[Test]
    public function linked_user_requires_a_password(): void
    {
        $this->postJson('/api/clinic/doctors', [
            'full_name' => 'Dr NoPw',
            'create_linked_user' => true,
            'linked_user' => ['email' => 'nopw@x.test'],
        ])->assertUnprocessable()->assertJsonValidationErrors(['linked_user.password']);

        $this->assertDatabaseMissing('users', ['email' => 'nopw@x.test']);
    }

    #[Test]
    public function linked_user_role_must_be_doctor_kind(): void
    {
        $this->postJson('/api/clinic/doctors', [
            'full_name' => 'Dr Admin',
            'create_linked_user' => true,
            'linked_user' => ['email' => 'esc@x.test', 'password' => 'secret123', 'role' => 'clinic_admin'],
        ])->assertUnprocessable()->assertJsonValidationErrors(['linked_user.role']);

        $this->assertDatabaseMissing('users', ['email' => 'esc@x.test']);
        $this->assertSame(0, Doctor::where('full_name', 'Dr Admin')->count());
    }

    #[Test]
    public function non_admin_creator_cannot_hand_out_a_doctor_role_with_more_permissions_than_they_hold(): void
    {
        $this->makeRole('onboarder', 'staff', ['doctors.view', 'doctors.create']);
        Sanctum::actingAs($this->makeUser('onboarder'));

        $this->postJson('/api/clinic/doctors', [
            'full_name' => 'Dr Escalate',
            'create_linked_user' => true,
            'linked_user' => ['email' => 'esc2@x.test', 'password' => 'secret123'],
        ])->assertForbidden();

        $this->assertDatabaseMissing('users', ['email' => 'esc2@x.test']);
        $this->assertSame(0, Doctor::where('full_name', 'Dr Escalate')->count());
    }

    /** @return array<string, array{array<string, mixed>, string}> */
    public static function invalidCreatePayloads(): array
    {
        return [
            'missing name' => [[], 'full_name'],
            'bad gender' => [['full_name' => 'Dr X', 'gender' => 'robot'], 'gender'],
            'bad email' => [['full_name' => 'Dr X', 'email' => 'nope'], 'email'],
            'negative fee' => [['full_name' => 'Dr X', 'consultation_fee' => -1], 'consultation_fee'],
            'slot too short' => [['full_name' => 'Dr X', 'slot_duration_minutes' => 2], 'slot_duration_minutes'],
            'bad status' => [['full_name' => 'Dr X', 'status' => 'blocked'], 'status'],
            'experience too high' => [['full_name' => 'Dr X', 'experience_years' => 81], 'experience_years'],
        ];
    }

    #[Test]
    #[DataProvider('invalidCreatePayloads')]
    public function create_validates_input(array $payload, string $field): void
    {
        $this->postJson('/api/clinic/doctors', $payload)
            ->assertUnprocessable()->assertJsonValidationErrors([$field]);
    }

    #[Test]
    public function create_is_blocked_when_plan_doctor_limit_is_reached(): void
    {
        $plan = Plan::create(['name' => 'Solo', 'monthly_price' => 99900, 'max_doctors' => 1]);
        ClinicSubscription::create(['clinic_id' => $this->clinic->id, 'plan_id' => $plan->id, 'billing_cycle' => 'monthly', 'status' => 'active']);
        $this->makeDoctor();

        $this->postJson('/api/clinic/doctors', ['full_name' => 'Dr Two'])
            ->assertUnprocessable()->assertJsonValidationErrors(['plan']);
    }

    #[Test]
    public function index_lists_only_own_clinic_doctors_and_supports_search_and_filters(): void
    {
        $this->makeDoctor(['full_name' => 'Dr Alice', 'specialization' => 'Cardiology']);
        $this->makeDoctor(['full_name' => 'Dr Bob', 'specialization' => 'Dermatology', 'status' => 'inactive']);
        $this->makeDoctor(['full_name' => 'Dr Alice Foreign', 'specialization' => 'Cardiology'], $this->otherClinic);

        $names = fn (string $query) => collect($this->getJson('/api/clinic/doctors'.$query)->assertOk()->json('data'))
            ->pluck('full_name')->sort()->values()->all();

        $this->assertSame(['Dr Alice', 'Dr Bob'], $names(''));
        $this->assertSame(['Dr Alice'], $names('?search=alice'));
        $this->assertSame(['Dr Bob'], $names('?status=inactive'));
        $this->assertSame(['Dr Alice'], $names('?specialization=Cardiology'));
        $this->assertSame(2, $this->getJson('/api/clinic/doctors')->json('meta.total'));
    }

    #[Test]
    public function show_returns_own_clinic_doctor(): void
    {
        $doctor = $this->makeDoctor(['full_name' => 'Dr Show']);

        $this->getJson("/api/clinic/doctors/{$doctor->id}")
            ->assertOk()->assertJsonPath('data.full_name', 'Dr Show');
    }

    #[Test]
    public function admin_updates_doctor_but_cannot_move_it_to_another_clinic(): void
    {
        $doctor = $this->makeDoctor();

        $this->putJson("/api/clinic/doctors/{$doctor->id}", [
            'full_name' => 'Dr Renamed', 'clinic_id' => $this->otherClinic->id,
        ])->assertOk()->assertJsonPath('data.full_name', 'Dr Renamed');

        $this->assertSame($this->clinic->id, (int) $doctor->fresh()->clinic_id);
    }

    #[Test]
    public function generic_update_validates_input(): void
    {
        $doctor = $this->makeDoctor();

        $this->putJson("/api/clinic/doctors/{$doctor->id}", ['gender' => 'robot'])->assertUnprocessable();
    }

    #[Test]
    public function generic_update_cannot_link_doctor_to_a_user_from_another_clinic(): void
    {
        $doctor = $this->makeDoctor();
        $foreignUser = $this->makeUser('receptionist', $this->otherClinic);

        $this->putJson("/api/clinic/doctors/{$doctor->id}", ['user_id' => $foreignUser->id]);

        $this->assertNull($doctor->fresh()->user_id);
    }

    #[Test]
    public function status_change_toggles_active_and_inactive(): void
    {
        $doctor = $this->makeDoctor();

        $this->postJson("/api/clinic/doctors/{$doctor->id}/status", ['status' => 'inactive'])
            ->assertOk()->assertJsonPath('data.status', 'inactive');
        $this->postJson("/api/clinic/doctors/{$doctor->id}/status", ['status' => 'active'])
            ->assertOk()->assertJsonPath('data.status', 'active');
    }

    #[Test]
    public function status_change_rejects_unknown_status(): void
    {
        $doctor = $this->makeDoctor();

        $this->postJson("/api/clinic/doctors/{$doctor->id}/status", ['status' => 'bogus'])->assertUnprocessable();
        $this->assertSame('active', $doctor->fresh()->status);
    }

    #[Test]
    public function block_does_not_error_on_doctors(): void
    {
        $doctor = $this->makeDoctor();

        $this->assertLessThan(500, $this->postJson("/api/clinic/doctors/{$doctor->id}/block")->status());
    }

    #[Test]
    public function block_is_rejected_for_doctors_and_unblock_reactivates(): void
    {
        $doctor = $this->makeDoctor(['status' => 'inactive']);

        $this->postJson("/api/clinic/doctors/{$doctor->id}/block")->assertUnprocessable();
        $this->assertSame('inactive', $doctor->fresh()->status);

        $this->postJson("/api/clinic/doctors/{$doctor->id}/unblock")->assertOk()->assertJsonPath('data.status', 'active');
    }

    #[Test]
    public function delete_soft_deletes_and_restore_brings_back(): void
    {
        $doctor = $this->makeDoctor(['full_name' => 'Dr Gone']);

        $this->deleteJson("/api/clinic/doctors/{$doctor->id}")->assertOk();
        $this->assertSoftDeleted('doctors', ['id' => $doctor->id]);

        $this->assertSame([], $this->getJson('/api/clinic/doctors')->json('data'));
        $this->assertSame(['Dr Gone'], collect($this->getJson('/api/clinic/doctors?with_trashed=1')->json('data'))->pluck('full_name')->all());

        $this->postJson("/api/clinic/doctors/{$doctor->id}/restore")->assertOk();
        $this->assertNotSoftDeleted('doctors', ['id' => $doctor->id]);
    }

    #[Test]
    public function delete_is_not_blocked_by_existing_schedules(): void
    {
        // Pinned current behaviour: delete is a soft delete with no dependency check,
        // so schedules (and appointments) are left in place.
        $doctor = $this->makeDoctor();
        $schedule = $this->makeSchedule($doctor);

        $this->deleteJson("/api/clinic/doctors/{$doctor->id}")->assertOk();

        $this->assertDatabaseHas('doctor_schedules', ['id' => $schedule->id]);
    }
}
