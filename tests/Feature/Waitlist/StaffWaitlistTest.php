<?php

namespace Tests\Feature\Waitlist;

use App\Models\Doctor;
use App\Models\User;
use App\Models\WaitlistEntry;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Spatie\Permission\Models\Role;
use Tests\TestCase;

/**
 * Task 5 of the waitlist (E3) plan: the staff waitlist endpoints (clinic
 * and super-admin, sharing App\Http\Controllers\Api\BaseStaffWaitlistController
 * and App\Support\Waitlist\StaffWaitlistPresenter) and the `waitlist`
 * block of the appointment detail payload.
 *
 * Clock frozen at 2026-10-01 10:15 Asia/Kolkata (in UTC, see
 * WaitlistTestHelpers); the doctor works 09:00-12:00 in 30-minute slots.
 */
class StaffWaitlistTest extends TestCase
{
    use RefreshDatabase;
    use WaitlistTestHelpers;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpWaitlist();
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

    /** A doctor-role user linked to $doctor (the clinic context scopes them to it). */
    private function doctorUser(Doctor $doctor): User
    {
        $user = User::create([
            'clinic_id' => $doctor->clinic_id,
            'uuid' => (string) Str::uuid(),
            'full_name' => 'Doctor User',
            'email' => 'doc-'.Str::random(6).'@x.test',
            'password' => 'x',
            'role' => 'doctor',
            'status' => 'active',
        ]);
        $user->assignRole('doctor');
        $doctor->update(['user_id' => $user->id]);

        return $user;
    }

    private function addPayload($patient, string $start = '09:00', ?string $date = null): array
    {
        return [
            'patient_id' => $patient->id,
            'doctor_id' => $this->doctor->id,
            'appointment_date' => $date ?? $this->tomorrow,
            'start_time' => $start,
        ];
    }

    // --- GET clinic/waitlist ------------------------------------------------

    public function test_list_defaults_to_active_entries_with_positions(): void
    {
        $booker = $this->consentedPatient();
        $this->appointment($booker, $this->tomorrow, '09:00');
        $this->appointment($booker, $this->tomorrow, '09:30');
        $first = $this->join($a = $this->consentedPatient(['first_name' => 'Asha', 'full_name' => 'Asha', 'phone' => '9111111111']), $this->tomorrow, '09:00');
        $second = $this->join($this->consentedPatient(), $this->tomorrow, '09:00', 'staff');
        $other = $this->join($this->consentedPatient(), $this->tomorrow, '09:30');
        $offer = $this->offeredEntry($this->consentedPatient(), $this->tomorrow, '10:00');
        $gone = $this->join($this->consentedPatient(), $this->tomorrow, '09:30');
        $gone->update(['status' => 'removed']);

        Sanctum::actingAs($this->receptionist());
        $response = $this->getJson('/api/clinic/waitlist');

        $response->assertOk()->assertJsonPath('meta.total', 4);
        $this->assertSame([$first->id, $second->id, $other->id, $offer->id], array_column($response->json('data'), 'id'));
        $this->assertSame([1, 2, 1, null], array_column($response->json('data'), 'position'));
        $this->assertSame([
            'id' => $first->id,
            'clinic_id' => $this->clinic->id,
            'patient' => ['id' => $a->id, 'full_name' => 'Asha', 'phone' => '9111111111'],
            'doctor' => ['id' => $this->doctor->id, 'name' => 'Dr Asha Rao'],
            'date' => $this->tomorrow,
            'start_time' => '09:00',
            'end_time' => '09:30',
            'status' => 'waiting',
            'position' => 1,
            'hold_expires_at' => null,
            'source' => 'portal',
            'created_at' => $first->created_at->toIso8601String(),
        ], $response->json('data.0'));
        $this->assertSame('staff', $response->json('data.1.source'));
        $this->assertSame($offer->hold_expires_at->toIso8601String(), $response->json('data.3.hold_expires_at'));
    }

    public function test_list_filters_by_doctor_date_and_status(): void
    {
        $booker = $this->consentedPatient();
        $dayAfter = $this->now->copy()->addDays(2)->toDateString();
        $this->appointment($booker, $this->tomorrow, '09:00');
        $this->appointment($booker, $dayAfter, '09:00');
        $tomorrowEntry = $this->join($this->consentedPatient(), $this->tomorrow, '09:00');
        $dayAfterEntry = $this->join($this->consentedPatient(), $dayAfter, '09:00');
        $removed = $this->join($this->consentedPatient(), $this->tomorrow, '09:00');
        $removed->update(['status' => 'removed']);
        $otherDoctor = $this->makeDoctorWithSchedule($this->clinic);
        $this->appointment($booker, $this->tomorrow, '09:00', [], $otherDoctor);
        $otherDoctorEntry = $this->service()->join($this->consentedPatient(), $otherDoctor->id, $this->tomorrow, '09:00', 'portal');

        Sanctum::actingAs($this->receptionist());

        $ids = fn (string $query) => array_column($this->getJson('/api/clinic/waitlist?'.$query)->assertOk()->json('data'), 'id');

        $this->assertSame([$tomorrowEntry->id, $otherDoctorEntry->id], $ids('date='.$this->tomorrow));
        $this->assertSame([$tomorrowEntry->id, $dayAfterEntry->id], $ids('doctor_id='.$this->doctor->id));
        $this->assertSame([$removed->id], $ids('status=removed'));
        $this->assertSame([$tomorrowEntry->id, $removed->id, $dayAfterEntry->id], $ids('doctor_id='.$this->doctor->id.'&status=all'));
        $this->getJson('/api/clinic/waitlist?status=bogus')->assertStatus(422);
    }

    public function test_list_is_limited_to_the_users_clinic(): void
    {
        $otherClinic = $this->makeClinic();
        $otherDoctor = $this->makeDoctorWithSchedule($otherClinic);
        $this->appointment($this->consentedPatient([], $otherClinic), $this->tomorrow, '09:00', [], $otherDoctor);
        $this->service()->join($this->consentedPatient([], $otherClinic), $otherDoctor->id, $this->tomorrow, '09:00', 'portal');

        Sanctum::actingAs($this->receptionist());

        $this->getJson('/api/clinic/waitlist')->assertOk()->assertJsonPath('meta.total', 0);
    }

    public function test_doctor_user_only_sees_their_own_doctors_entries(): void
    {
        $booker = $this->consentedPatient();
        $this->appointment($booker, $this->tomorrow, '09:00');
        $mine = $this->join($this->consentedPatient(), $this->tomorrow, '09:00');
        $otherDoctor = $this->makeDoctorWithSchedule($this->clinic);
        $this->appointment($booker, $this->tomorrow, '09:00', [], $otherDoctor);
        $this->service()->join($this->consentedPatient(), $otherDoctor->id, $this->tomorrow, '09:00', 'portal');

        Sanctum::actingAs($this->doctorUser($this->doctor));

        $this->assertSame([$mine->id], array_column($this->getJson('/api/clinic/waitlist')->assertOk()->json('data'), 'id'));
    }

    // --- POST clinic/waitlist -------------------------------------------------

    public function test_add_creates_a_staff_entry_even_outside_the_portal_window(): void
    {
        $farDate = $this->now->copy()->addDays(60)->toDateString();
        $this->appointment($this->consentedPatient(), $farDate, '09:00');
        $patient = $this->consentedPatient();
        $user = $this->receptionist();

        Sanctum::actingAs($user);
        $response = $this->postJson('/api/clinic/waitlist', $this->addPayload($patient, '09:00', $farDate));

        $response->assertCreated()
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.status', 'waiting')
            ->assertJsonPath('data.source', 'staff')
            ->assertJsonPath('data.position', 1)
            ->assertJsonPath('data.patient.id', $patient->id);
        $entry = WaitlistEntry::sole();
        $this->assertSame('staff', $entry->source);
        $this->assertSame($user->id, $entry->created_by_user_id);
    }

    public function test_add_maps_service_errors(): void
    {
        $patient = $this->consentedPatient();
        Sanctum::actingAs($this->receptionist());

        $this->postJson('/api/clinic/waitlist', $this->addPayload($patient))
            ->assertStatus(422)
            ->assertJsonPath('success', false)
            ->assertJsonPath('message', 'This slot is free — book it directly.');

        $this->appointment($patient, $this->tomorrow, '09:00');
        $this->postJson('/api/clinic/waitlist', $this->addPayload($patient))
            ->assertStatus(422)
            ->assertJsonPath('message', 'This patient already has this slot.');

        $this->appointment($this->consentedPatient(), $this->tomorrow, '09:30');
        $this->postJson('/api/clinic/waitlist', $this->addPayload($patient, '09:30'))->assertCreated();
        $this->postJson('/api/clinic/waitlist', $this->addPayload($patient, '09:30'))
            ->assertStatus(409)
            ->assertJsonPath('success', false)
            ->assertJsonPath('message', 'Already on the waitlist for this time.');

        $this->postJson('/api/clinic/waitlist', [])->assertStatus(422)
            ->assertJsonValidationErrors(['patient_id', 'doctor_id', 'appointment_date', 'start_time']);
    }

    public function test_add_for_another_clinics_patient_or_doctor_is_404(): void
    {
        $otherClinic = $this->makeClinic();
        $outsider = $this->consentedPatient([], $otherClinic);
        $otherDoctor = $this->makeDoctorWithSchedule($otherClinic);
        $this->appointment($this->consentedPatient(), $this->tomorrow, '09:00');
        Sanctum::actingAs($this->receptionist());

        $this->postJson('/api/clinic/waitlist', $this->addPayload($outsider))->assertNotFound();
        $this->postJson('/api/clinic/waitlist', ['doctor_id' => $otherDoctor->id] + $this->addPayload($this->consentedPatient()))->assertNotFound();
        $this->assertSame(0, WaitlistEntry::count());
    }

    public function test_add_without_appointments_create_is_403(): void
    {
        Role::findByName('doctor')->revokePermissionTo('appointments.create');
        $this->appointment($this->consentedPatient(), $this->tomorrow, '09:00');
        $user = $this->doctorUser($this->doctor);

        Sanctum::actingAs($user);
        $this->postJson('/api/clinic/waitlist', $this->addPayload($this->consentedPatient()))->assertForbidden();
        $this->getJson('/api/clinic/waitlist')->assertOk();
        $this->assertSame(0, WaitlistEntry::count());
    }

    // --- DELETE clinic/waitlist/{id} ----------------------------------------

    public function test_remove_offered_entry_offers_the_next(): void
    {
        $booked = $this->appointment($this->consentedPatient(), $this->tomorrow, '09:00');
        $first = $this->join($this->consentedPatient(), $this->tomorrow, '09:00');
        $second = $this->join($this->consentedPatient(), $this->tomorrow, '09:00');
        $booked->update(['status' => 'cancelled']);
        $this->service()->slotFreed($this->clinic->id, $this->doctor->id, $this->tomorrow, '09:00');

        Sanctum::actingAs($this->receptionist());
        $this->deleteJson("/api/clinic/waitlist/{$first->id}")
            ->assertOk()
            ->assertJsonPath('data.status', 'removed');

        $this->assertSame('removed', $first->fresh()->status);
        $this->assertSame('offered', $second->fresh()->status);
        $this->assertSame(2, $this->waitlistMessages()->count());
    }

    public function test_remove_another_clinics_entry_is_404(): void
    {
        $otherClinic = $this->makeClinic();
        $otherDoctor = $this->makeDoctorWithSchedule($otherClinic);
        $this->appointment($this->consentedPatient([], $otherClinic), $this->tomorrow, '09:00', [], $otherDoctor);
        $entry = $this->service()->join($this->consentedPatient([], $otherClinic), $otherDoctor->id, $this->tomorrow, '09:00', 'portal');

        Sanctum::actingAs($this->receptionist());
        $this->deleteJson("/api/clinic/waitlist/{$entry->id}")->assertNotFound();
        $this->assertSame('waiting', $entry->fresh()->status);
    }

    public function test_remove_without_appointments_create_is_403(): void
    {
        Role::findByName('doctor')->revokePermissionTo('appointments.create');
        $this->appointment($this->consentedPatient(), $this->tomorrow, '09:00');
        $entry = $this->join($this->consentedPatient(), $this->tomorrow, '09:00');

        Sanctum::actingAs($this->doctorUser($this->doctor));
        $this->deleteJson("/api/clinic/waitlist/{$entry->id}")->assertForbidden();
        $this->assertSame('waiting', $entry->fresh()->status);
    }

    // --- super admin -----------------------------------------------------------

    public function test_super_admin_lists_with_clinic_filter(): void
    {
        $this->appointment($this->consentedPatient(), $this->tomorrow, '09:00');
        $here = $this->join($this->consentedPatient(), $this->tomorrow, '09:00');
        $otherClinic = $this->makeClinic();
        $otherDoctor = $this->makeDoctorWithSchedule($otherClinic);
        $this->appointment($this->consentedPatient([], $otherClinic), $this->tomorrow, '09:00', [], $otherDoctor);
        $there = $this->service()->join($this->consentedPatient([], $otherClinic), $otherDoctor->id, $this->tomorrow, '09:00', 'portal');

        Sanctum::actingAs($this->superAdmin());

        $this->assertSame([$here->id, $there->id], array_column($this->getJson('/api/super-admin/waitlist')->assertOk()->json('data'), 'id'));
        $this->assertSame([$there->id], array_column($this->getJson('/api/super-admin/waitlist?clinic_id='.$otherClinic->id)->assertOk()->json('data'), 'id'));
    }

    public function test_super_admin_adds_for_a_clinics_patient(): void
    {
        $this->appointment($this->consentedPatient(), $this->tomorrow, '09:00');
        $patient = $this->consentedPatient();
        $admin = $this->superAdmin();
        Sanctum::actingAs($admin);

        $this->postJson('/api/super-admin/waitlist', $this->addPayload($patient))
            ->assertStatus(422)->assertJsonValidationErrors(['clinic_id']);

        $otherClinic = $this->makeClinic();
        $this->postJson('/api/super-admin/waitlist', ['clinic_id' => $otherClinic->id] + $this->addPayload($patient))
            ->assertNotFound();

        $this->postJson('/api/super-admin/waitlist', ['clinic_id' => $this->clinic->id] + $this->addPayload($patient))
            ->assertCreated()
            ->assertJsonPath('data.clinic_id', $this->clinic->id)
            ->assertJsonPath('data.source', 'staff');
        $this->assertSame($admin->id, WaitlistEntry::sole()->created_by_user_id);
    }

    public function test_super_admin_removes_an_entry(): void
    {
        $this->appointment($this->consentedPatient(), $this->tomorrow, '09:00');
        $entry = $this->join($this->consentedPatient(), $this->tomorrow, '09:00');
        Sanctum::actingAs($this->superAdmin());

        $this->deleteJson("/api/super-admin/waitlist/{$entry->id}")->assertOk()->assertJsonPath('data.status', 'removed');
        $this->deleteJson('/api/super-admin/waitlist/999999')->assertNotFound();
    }

    public function test_super_admin_endpoints_reject_clinic_staff(): void
    {
        Sanctum::actingAs($this->receptionist());

        $this->getJson('/api/super-admin/waitlist')->assertForbidden();
    }

    // --- appointment detail ------------------------------------------------------

    public function test_appointment_detail_includes_waitlist_counts(): void
    {
        $appointment = $this->appointment($this->consentedPatient(), $this->tomorrow, '09:00');
        $this->join($this->consentedPatient(), $this->tomorrow, '09:00');
        $this->join($this->consentedPatient(), $this->tomorrow, '09:00');
        $quiet = $this->appointment($this->consentedPatient(), $this->tomorrow, '10:00');

        Sanctum::actingAs($this->receptionist());

        $this->getJson("/api/clinic/appointments/{$appointment->id}/detail")
            ->assertOk()
            ->assertJsonPath('data.waitlist', ['waiting_count' => 2, 'held_for' => null]);
        $this->getJson("/api/clinic/appointments/{$quiet->id}/detail")
            ->assertJsonPath('data.waitlist', ['waiting_count' => 0, 'held_for' => null]);
    }

    public function test_appointment_detail_shows_who_the_slot_is_held_for(): void
    {
        $appointment = $this->appointment($this->consentedPatient(), $this->tomorrow, '09:00', ['status' => 'cancelled']);
        $offer = $this->offeredEntry($this->consentedPatient(['first_name' => 'Meera', 'last_name' => 'Shah']), $this->tomorrow, '09:00');
        // Entries for another slot don't count towards this one.
        $this->appointment($this->consentedPatient(), $this->tomorrow, '09:30');
        $this->join($this->consentedPatient(), $this->tomorrow, '09:30', 'staff');

        Sanctum::actingAs($this->receptionist());
        $expected = [
            'waiting_count' => 0,
            'held_for' => ['patient_name' => 'Meera Shah', 'until' => $offer->hold_expires_at->toIso8601String()],
        ];

        $this->getJson("/api/clinic/appointments/{$appointment->id}/detail")->assertOk()->assertJsonPath('data.waitlist', $expected);

        Sanctum::actingAs($this->superAdmin());
        $this->getJson("/api/super-admin/appointments/{$appointment->id}/detail")->assertOk()->assertJsonPath('data.waitlist', $expected);
    }
}
