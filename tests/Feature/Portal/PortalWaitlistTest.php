<?php

namespace Tests\Feature\Portal;

use App\Models\Appointment;
use App\Models\ClinicSetting;
use App\Models\WaitlistEntry;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Waitlist\WaitlistTestHelpers;
use Tests\TestCase;

/**
 * Task 4 of the waitlist (E3) plan: the portal waitlist endpoints
 * (app/Http/Controllers/Api/Portal/WaitlistController.php,
 * app/Support/Portal/WaitlistPresenter.php) and the slots endpoint's
 * `taken` list. Every endpoint acts for the selected profile
 * (`X-Patient-Id`); another profile's or clinic's entry is a 404.
 *
 * Clock frozen at 2026-10-01 10:15 Asia/Kolkata (in UTC, see
 * WaitlistTestHelpers); the doctor works 09:00-12:00 in 30-minute slots.
 */
class PortalWaitlistTest extends TestCase
{
    use RefreshDatabase;
    use WaitlistTestHelpers;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpWaitlist();
        $this->doctor->update(['specialization' => 'General Medicine']);
    }

    private function joinPayload(string $start = '09:00', ?string $date = null): array
    {
        return [
            'doctor_id' => $this->doctor->id,
            'appointment_date' => $date ?? $this->tomorrow,
            'start_time' => $start,
        ];
    }

    // --- POST waitlist ------------------------------------------------------

    public function test_join_returns_201_with_the_entry(): void
    {
        $this->appointment($this->consentedPatient(), $this->tomorrow, '09:00');
        $patient = $this->consentedPatient();

        $response = $this->portalPost('/api/portal/waitlist', $this->portalToken($patient), $patient->id, $this->joinPayload());

        $response->assertCreated()->assertJsonPath('success', true);
        $entry = WaitlistEntry::sole();
        $this->assertSame([
            'id' => $entry->id,
            'status' => 'waiting',
            'doctor' => ['id' => $this->doctor->id, 'name' => 'Dr Asha Rao', 'specialization' => 'General Medicine'],
            'date' => $this->tomorrow,
            'start_time' => '09:00',
            'end_time' => '09:30',
            'hold_expires_at' => null,
            'position' => 1,
        ], $response->json('data'));
        $this->assertSame('portal', $entry->source);
        $this->assertSame($patient->id, $entry->patient_id);
    }

    public function test_join_duplicate_is_409(): void
    {
        $this->appointment($this->consentedPatient(), $this->tomorrow, '09:00');
        $patient = $this->consentedPatient();
        $token = $this->portalToken($patient);
        $this->portalPost('/api/portal/waitlist', $token, $patient->id, $this->joinPayload())->assertCreated();

        $response = $this->portalPost('/api/portal/waitlist', $token, $patient->id, $this->joinPayload());

        $response->assertStatus(409)
            ->assertJsonPath('success', false)
            ->assertJsonPath('message', 'Already on the waitlist for this time.');
        $this->assertSame(1, WaitlistEntry::count());
    }

    public function test_join_of_a_free_slot_is_422(): void
    {
        $patient = $this->consentedPatient();

        $this->portalPost('/api/portal/waitlist', $this->portalToken($patient), $patient->id, $this->joinPayload())
            ->assertStatus(422)
            ->assertJsonPath('success', false)
            ->assertJsonPath('message', 'This slot is free — book it directly.')
            ->assertJsonPath('errors.start_time.0', 'This slot is free — book it directly.');
    }

    public function test_join_over_the_limit_is_422(): void
    {
        $other = $this->consentedPatient();
        foreach (['09:00', '09:30', '10:00', '10:30'] as $start) {
            $this->appointment($other, $this->tomorrow, $start);
        }
        $patient = $this->consentedPatient();
        $token = $this->portalToken($patient);
        foreach (['09:00', '09:30', '10:00'] as $start) {
            $this->portalPost('/api/portal/waitlist', $token, $patient->id, $this->joinPayload($start))->assertCreated();
        }

        $this->portalPost('/api/portal/waitlist', $token, $patient->id, $this->joinPayload('10:30'))
            ->assertStatus(422)
            ->assertJsonPath('message', 'You can be on up to 3 waitlists at a time.');
    }

    public function test_join_when_waitlist_disabled_is_422(): void
    {
        ClinicSetting::create(['clinic_id' => $this->clinic->id, 'waitlist_enabled' => false]);
        $this->appointment($this->consentedPatient(), $this->tomorrow, '09:00');
        $patient = $this->consentedPatient();

        $this->portalPost('/api/portal/waitlist', $this->portalToken($patient), $patient->id, $this->joinPayload())
            ->assertStatus(422)
            ->assertJsonPath('message', 'Waitlist is not available at this clinic.');
    }

    public function test_join_when_online_booking_is_off_is_422(): void
    {
        ClinicSetting::create(['clinic_id' => $this->clinic->id, 'booking_enabled' => false]);
        $this->appointment($this->consentedPatient(), $this->tomorrow, '09:00');
        $patient = $this->consentedPatient();

        $this->portalPost('/api/portal/waitlist', $this->portalToken($patient), $patient->id, $this->joinPayload())
            ->assertStatus(422)
            ->assertJsonPath('message', "The clinic can't take online bookings right now. Please call the clinic.");
        $this->assertSame(0, WaitlistEntry::count());
    }

    public function test_join_outside_the_booking_window_is_422(): void
    {
        $patient = $this->consentedPatient();

        $this->portalPost('/api/portal/waitlist', $this->portalToken($patient), $patient->id,
            $this->joinPayload('09:00', $this->now->copy()->addDays(60)->toDateString()))
            ->assertStatus(422)
            ->assertJsonPath('message', "Choose a date within the clinic's booking window.");
    }

    public function test_join_validates_the_payload(): void
    {
        $patient = $this->consentedPatient();

        $this->portalPost('/api/portal/waitlist', $this->portalToken($patient), $patient->id, [])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['doctor_id', 'appointment_date', 'start_time']);
    }

    public function test_join_for_another_clinics_doctor_is_404(): void
    {
        $otherClinic = $this->makeClinic();
        $otherDoctor = $this->makeDoctorWithSchedule($otherClinic);
        $patient = $this->consentedPatient();

        $this->portalPost('/api/portal/waitlist', $this->portalToken($patient), $patient->id,
            ['doctor_id' => $otherDoctor->id] + $this->joinPayload())
            ->assertNotFound();
        $this->assertSame(0, WaitlistEntry::count());
    }

    public function test_join_while_acting_as_a_dependent_joins_for_the_dependent(): void
    {
        $this->appointment($this->consentedPatient(), $this->tomorrow, '09:00');
        $holder = $this->consentedPatient();
        $dependent = $this->consentedPatient(['managed_by_patient_id' => $holder->id]);

        $this->portalPost('/api/portal/waitlist', $this->portalToken($holder), $dependent->id, $this->joinPayload())
            ->assertCreated();

        $this->assertSame($dependent->id, WaitlistEntry::sole()->patient_id);
    }

    // --- GET waitlist / waitlist/{id} ----------------------------------------

    public function test_index_lists_active_entries_of_the_acting_profile_soonest_first(): void
    {
        $other = $this->consentedPatient();
        $dayAfter = $this->now->copy()->addDays(2)->toDateString();
        $this->appointment($other, $this->tomorrow, '09:00');
        $this->appointment($other, $this->tomorrow, '11:00');
        $this->appointment($other, $dayAfter, '09:00');

        $patient = $this->consentedPatient();
        $ahead = $this->consentedPatient();
        $finished = $this->join($patient, $this->tomorrow, '09:00');
        $finished->update(['status' => 'removed']);
        $this->join($ahead, $this->tomorrow, '11:00');
        $later = $this->join($patient, $dayAfter, '09:00');
        $mid = $this->join($patient, $this->tomorrow, '11:00');
        $soonest = $this->offeredEntry($patient, $this->tomorrow, '10:00');
        $this->join($this->consentedPatient(), $this->tomorrow, '09:00');

        $response = $this->portalGet('/api/portal/waitlist', $this->portalToken($patient), $patient->id);

        $response->assertOk();
        $this->assertSame([$soonest->id, $mid->id, $later->id], array_column($response->json('data'), 'id'));
        $this->assertSame(['offered', 'waiting', 'waiting'], array_column($response->json('data'), 'status'));
        $this->assertSame([null, 2, 1], array_column($response->json('data'), 'position'));
        $this->assertSame($soonest->hold_expires_at->toIso8601String(), $response->json('data.0.hold_expires_at'));
    }

    public function test_index_does_not_include_the_account_holders_entries_when_acting_as_dependent(): void
    {
        $this->appointment($this->consentedPatient(), $this->tomorrow, '09:00');
        $holder = $this->consentedPatient();
        $dependent = $this->consentedPatient(['managed_by_patient_id' => $holder->id]);
        $this->join($holder, $this->tomorrow, '09:00');
        $token = $this->portalToken($holder);

        $this->assertCount(0, $this->portalGet('/api/portal/waitlist', $token, $dependent->id)->json('data'));
        $this->assertCount(1, $this->portalGet('/api/portal/waitlist', $token, $holder->id)->json('data'));
    }

    public function test_show_returns_the_entry_with_doctor_modes_including_finished_entries(): void
    {
        $patient = $this->consentedPatient();
        $entry = $this->offeredEntry($patient, $this->tomorrow, '09:00');
        $token = $this->portalToken($patient);

        $response = $this->portalGet("/api/portal/waitlist/{$entry->id}", $token, $patient->id);

        $response->assertOk()
            ->assertJsonPath('data.id', $entry->id)
            ->assertJsonPath('data.status', 'offered')
            ->assertJsonPath('data.position', null)
            ->assertJsonPath('data.doctor.consultation_modes', ['in_person'])
            ->assertJsonPath('data.booked_appointment_id', null)
            ->assertJsonPath('data.hold_expires_at', $entry->hold_expires_at->toIso8601String())
            ->assertJsonPath('data.clinic.name', $this->clinic->name);

        // Staff booked over the hold: the offer page must still load to say so.
        $entry->update(['status' => 'expired']);
        $this->portalGet("/api/portal/waitlist/{$entry->id}", $token, $patient->id)
            ->assertOk()
            ->assertJsonPath('data.status', 'expired');
    }

    public function test_show_of_another_profiles_entry_is_404(): void
    {
        $holder = $this->consentedPatient();
        $dependent = $this->consentedPatient(['managed_by_patient_id' => $holder->id]);
        $entry = $this->offeredEntry($dependent, $this->tomorrow, '09:00');
        $stranger = $this->consentedPatient();
        $token = $this->portalToken($holder);

        // Acting as the holder, the dependent's entry isn't the acting profile's.
        $this->portalGet("/api/portal/waitlist/{$entry->id}", $token, $holder->id)->assertNotFound();
        $this->portalGet("/api/portal/waitlist/{$entry->id}", $token, $dependent->id)->assertOk();
        $this->portalGet("/api/portal/waitlist/{$entry->id}", $this->portalToken($stranger), $stranger->id)->assertNotFound();
    }

    public function test_entry_of_another_clinic_is_404(): void
    {
        $otherClinic = $this->makeClinic();
        $patient = $this->consentedPatient();
        $outsider = $this->consentedPatient([], $otherClinic);
        $entry = WaitlistEntry::create([
            'clinic_id' => $otherClinic->id,
            'patient_id' => $outsider->id,
            'doctor_id' => $this->makeDoctorWithSchedule($otherClinic)->id,
            'appointment_date' => $this->tomorrow,
            'start_time' => '09:00:00',
            'status' => 'waiting',
            'source' => 'portal',
        ]);
        $token = $this->portalToken($patient);

        $this->portalGet("/api/portal/waitlist/{$entry->id}", $token, $patient->id)->assertNotFound();
        $this->portalDelete("/api/portal/waitlist/{$entry->id}", $token, $patient->id)->assertNotFound();
        $this->portalPost("/api/portal/waitlist/{$entry->id}/decline", $token, $patient->id)->assertNotFound();
        $this->portalPost("/api/portal/waitlist/{$entry->id}/book", $token, $patient->id, ['visit_type' => 'new', 'consultation_mode' => 'in_person'])->assertNotFound();
        $this->assertSame('waiting', $entry->fresh()->status);
    }

    // --- DELETE waitlist/{id} ---------------------------------------------------

    public function test_leave_removes_the_entry(): void
    {
        $this->appointment($this->consentedPatient(), $this->tomorrow, '09:00');
        $patient = $this->consentedPatient();
        $entry = $this->join($patient, $this->tomorrow, '09:00');

        $this->portalDelete("/api/portal/waitlist/{$entry->id}", $this->portalToken($patient), $patient->id)
            ->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.status', 'removed');

        $this->assertSame('removed', $entry->fresh()->status);
    }

    public function test_leave_an_offer_offers_the_next_in_line(): void
    {
        $booked = $this->appointment($this->consentedPatient(), $this->tomorrow, '09:00');
        $first = $this->join($patient = $this->consentedPatient(), $this->tomorrow, '09:00');
        $second = $this->join($this->consentedPatient(), $this->tomorrow, '09:00');
        $booked->update(['status' => 'cancelled']);
        $this->service()->slotFreed($this->clinic->id, $this->doctor->id, $this->tomorrow, '09:00');
        $this->assertSame('offered', $first->fresh()->status);

        $this->portalDelete("/api/portal/waitlist/{$first->id}", $this->portalToken($patient), $patient->id)->assertOk();

        $this->assertSame('removed', $first->fresh()->status);
        $this->assertSame('offered', $second->fresh()->status);
    }

    public function test_leave_another_profiles_entry_is_404(): void
    {
        $this->appointment($this->consentedPatient(), $this->tomorrow, '09:00');
        $entry = $this->join($this->consentedPatient(), $this->tomorrow, '09:00');
        $stranger = $this->consentedPatient();

        $this->portalDelete("/api/portal/waitlist/{$entry->id}", $this->portalToken($stranger), $stranger->id)->assertNotFound();
        $this->assertSame('waiting', $entry->fresh()->status);
    }

    // --- POST waitlist/{id}/book ----------------------------------------------

    public function test_book_from_offer_returns_201_appointment_item(): void
    {
        $patient = $this->consentedPatient();
        $entry = $this->offeredEntry($patient, $this->tomorrow, '09:00');

        $response = $this->portalPost("/api/portal/waitlist/{$entry->id}/book", $this->portalToken($patient), $patient->id, [
            'visit_type' => 'followup',
            'consultation_mode' => 'in_person',
            'reason' => 'Cough',
        ]);

        $response->assertCreated()
            ->assertJsonPath('data.status', 'pending')
            ->assertJsonPath('data.booking_channel', 'portal')
            ->assertJsonPath('data.visit_type', 'followup')
            ->assertJsonPath('data.date', $this->tomorrow)
            ->assertJsonPath('data.doctor.id', $this->doctor->id);
        $appointment = Appointment::sole();
        $this->assertSame($response->json('data.id'), $appointment->id);
        $this->assertSame('Cough', $appointment->notes);
        $this->assertSame('booked', $entry->fresh()->status);
        $this->assertSame($appointment->id, $entry->fresh()->booked_appointment_id);
    }

    public function test_book_after_expiry_is_422(): void
    {
        $patient = $this->consentedPatient();
        $entry = $this->offeredEntry($patient, $this->tomorrow, '09:00');
        $this->travel(31)->minutes();

        $this->portalPost("/api/portal/waitlist/{$entry->id}/book", $this->portalToken($patient), $patient->id, [
            'visit_type' => 'new',
            'consultation_mode' => 'in_person',
        ])->assertStatus(422)
            ->assertJsonPath('success', false)
            ->assertJsonPath('message', 'This offer has expired.');
        $this->assertSame(0, Appointment::count());
    }

    public function test_book_when_another_visit_overlaps_the_hold_is_409(): void
    {
        $patient = $this->consentedPatient();
        $entry = $this->offeredEntry($patient, $this->tomorrow, '09:00');
        $this->appointment($this->consentedPatient(), $this->tomorrow, '09:00');

        $this->portalPost("/api/portal/waitlist/{$entry->id}/book", $this->portalToken($patient), $patient->id, [
            'visit_type' => 'new',
            'consultation_mode' => 'in_person',
        ])->assertStatus(409)
            ->assertJsonPath('message', 'That slot was just taken. Please pick another.');
        $this->assertSame(1, Appointment::count());
    }

    public function test_book_validates_visit_type_and_mode(): void
    {
        $patient = $this->consentedPatient();
        $entry = $this->offeredEntry($patient, $this->tomorrow, '09:00');

        $this->portalPost("/api/portal/waitlist/{$entry->id}/book", $this->portalToken($patient), $patient->id, [
            'visit_type' => 'urgent',
            'consultation_mode' => 'teleport',
        ])->assertStatus(422)->assertJsonValidationErrors(['visit_type', 'consultation_mode']);
    }

    public function test_book_another_profiles_offer_is_404(): void
    {
        $entry = $this->offeredEntry($this->consentedPatient(), $this->tomorrow, '09:00');
        $stranger = $this->consentedPatient();

        $this->portalPost("/api/portal/waitlist/{$entry->id}/book", $this->portalToken($stranger), $stranger->id, [
            'visit_type' => 'new',
            'consultation_mode' => 'in_person',
        ])->assertNotFound();
        $this->assertSame(0, Appointment::count());
    }

    // --- POST waitlist/{id}/decline -------------------------------------------

    public function test_decline_marks_declined_and_offers_next(): void
    {
        $patient = $this->consentedPatient();
        $this->appointment($this->consentedPatient(), $this->tomorrow, '09:00')->update(['status' => 'cancelled']);
        $entry = $this->offeredEntry($patient, $this->tomorrow, '09:00');
        $next = WaitlistEntry::create([
            'clinic_id' => $this->clinic->id,
            'patient_id' => $this->consentedPatient()->id,
            'doctor_id' => $this->doctor->id,
            'appointment_date' => $this->tomorrow,
            'start_time' => '09:00:00',
            'end_time' => '09:30:00',
            'status' => 'waiting',
            'source' => 'portal',
        ]);

        $this->portalPost("/api/portal/waitlist/{$entry->id}/decline", $this->portalToken($patient), $patient->id)
            ->assertOk()
            ->assertJsonPath('data.status', 'declined');

        $this->assertSame('declined', $entry->fresh()->status);
        $this->assertSame('offered', $next->fresh()->status);
    }

    public function test_decline_of_a_waiting_entry_is_422(): void
    {
        $this->appointment($this->consentedPatient(), $this->tomorrow, '09:00');
        $patient = $this->consentedPatient();
        $entry = $this->join($patient, $this->tomorrow, '09:00');

        $this->portalPost("/api/portal/waitlist/{$entry->id}/decline", $this->portalToken($patient), $patient->id)
            ->assertStatus(422)
            ->assertJsonPath('message', 'This offer has expired.');
    }

    // --- consent ---------------------------------------------------------------

    public function test_waitlist_endpoints_require_consent(): void
    {
        $patient = $this->makePatient($this->clinic, ['phone' => '9000011111']);

        $this->portalGet('/api/portal/waitlist', $this->portalToken($patient), $patient->id)->assertStatus(428);
    }

    // --- GET doctors/{id}/slots ----------------------------------------------

    public function test_slots_returns_taken_booked_and_held_for_others(): void
    {
        $other = $this->consentedPatient();
        $this->appointment($other, $this->tomorrow, '09:00');
        $this->offeredEntry($other, $this->tomorrow, '09:30');
        $patient = $this->consentedPatient();
        $this->appointment($patient, $this->tomorrow, '11:30');
        $this->appointment($other, $this->tomorrow, '11:00');
        $this->join($patient, $this->tomorrow, '11:00');

        $response = $this->portalGet("/api/portal/doctors/{$this->doctor->id}/slots?date={$this->tomorrow}", $this->portalToken($patient), $patient->id);

        $response->assertOk();
        $this->assertSame(['10:00', '10:30'], array_column($response->json('data.slots'), 'start_time'));
        $this->assertSame([
            ['start_time' => '09:00', 'end_time' => '09:30'],
            ['start_time' => '09:30', 'end_time' => '10:00'],
        ], $response->json('data.taken'));
    }

    public function test_slots_show_the_held_slot_to_the_held_patient(): void
    {
        $patient = $this->consentedPatient();
        $this->offeredEntry($patient, $this->tomorrow, '09:30');
        $other = $this->consentedPatient();

        $mine = $this->portalGet("/api/portal/doctors/{$this->doctor->id}/slots?date={$this->tomorrow}", $this->portalToken($patient), $patient->id);
        $theirs = $this->portalGet("/api/portal/doctors/{$this->doctor->id}/slots?date={$this->tomorrow}", $this->portalToken($other), $other->id);

        $this->assertContains('09:30', array_column($mine->json('data.slots'), 'start_time'));
        $this->assertSame([], $mine->json('data.taken'));
        $this->assertNotContains('09:30', array_column($theirs->json('data.slots'), 'start_time'));
        $this->assertSame(['09:30'], array_column($theirs->json('data.taken'), 'start_time'));
    }

    public function test_slots_taken_is_empty_when_waitlist_disabled(): void
    {
        ClinicSetting::create(['clinic_id' => $this->clinic->id, 'waitlist_enabled' => false]);
        $this->appointment($this->consentedPatient(), $this->tomorrow, '09:00');
        $patient = $this->consentedPatient();

        $this->portalGet("/api/portal/doctors/{$this->doctor->id}/slots?date={$this->tomorrow}", $this->portalToken($patient), $patient->id)
            ->assertOk()
            ->assertJsonPath('data.taken', []);
    }
}
