<?php

namespace Tests\Feature\Waitlist;

use App\Enums\AppointmentStatus;
use App\Models\Appointment;
use App\Models\PatientLoginLink;
use App\Models\WaitlistEntry;
use App\Services\AppointmentService;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Task 3 of the waitlist (E3) plan: booking from an offer, declining it,
 * and the `waitlist:process` expiry command (lapsed holds, past slots,
 * holds staff booked over). See app/Services/Waitlist/WaitlistService.php
 * and app/Console/Commands/ProcessWaitlist.php.
 */
class WaitlistOfferTest extends TestCase
{
    use RefreshDatabase;
    use WaitlistTestHelpers;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpWaitlist();
    }

    /**
     * Tomorrow 09:00 is booked, $count patients join in order, then the
     * booking is cancelled so the first is offered the slot.
     *
     * @return array<int, WaitlistEntry>
     */
    private function offeredQueue(int $count = 2, string $date = '', string $start = '09:00', string $source = 'portal'): array
    {
        $date = $date !== '' ? $date : $this->tomorrow;
        $appointment = $this->appointment($this->consentedPatient(), $date, $start);
        $entries = [];
        for ($i = 0; $i < $count; $i++) {
            $entries[] = $this->join($this->consentedPatient(), $date, $start, $source);
        }

        app(AppointmentService::class)->changeStatus($appointment, AppointmentStatus::CANCELLED);
        $this->assertSame('offered', $entries[0]->fresh()->status);

        return array_map(fn (WaitlistEntry $e) => $e->fresh(), $entries);
    }

    private function bookData(): array
    {
        return ['visit_type' => 'followup', 'consultation_mode' => 'in_person', 'reason' => 'Cough'];
    }

    // --- book --------------------------------------------------------------

    public function test_book_from_offer_creates_pending_portal_appointment(): void
    {
        [$first, $second] = $this->offeredQueue();

        $appointment = $this->service()->book($first, $this->bookData());

        $this->assertTrue($appointment->exists);
        $this->assertSame('pending', $appointment->status);
        $this->assertSame('portal', $appointment->booking_channel);
        $this->assertSame($first->patient_id, $appointment->patient_id);
        $this->assertSame($this->doctor->id, $appointment->doctor_id);
        $this->assertSame($this->tomorrow, $appointment->appointment_date->toDateString());
        $this->assertSame('09:00', substr((string) $appointment->start_time, 0, 5));
        $this->assertSame('followup', $appointment->visit_type);
        $this->assertSame('Cough', $appointment->notes);

        $first->refresh();
        $this->assertSame('booked', $first->status);
        $this->assertSame($appointment->id, $first->booked_appointment_id);
        $this->assertNotNull($first->loginLink->consumed_at);

        // Nobody else is offered the now-booked slot.
        $this->assertSame('waiting', $second->fresh()->status);
        $this->assertSame(1, $this->waitlistMessages()->count());
    }

    public function test_book_after_hold_expiry_is_422(): void
    {
        [$first] = $this->offeredQueue(1);

        $this->travel(31)->minutes();

        $this->assertValidationMessage('This offer has expired.',
            fn () => $this->service()->book($first->fresh(), $this->bookData()));
        $this->assertSame(1, Appointment::count());
        $this->assertSame('offered', $first->fresh()->status);
    }

    public function test_book_of_an_entry_that_is_not_offered_is_422(): void
    {
        [, $second] = $this->offeredQueue();

        $this->assertValidationMessage('This offer has expired.',
            fn () => $this->service()->book($second, $this->bookData()));
    }

    public function test_offered_patient_can_book_held_slot_via_normal_booking(): void
    {
        [$first, $second] = $this->offeredQueue();
        $patient = $first->patient;

        $response = $this->portalPost('/api/portal/appointments', $this->portalToken($patient), $patient->id, [
            'doctor_id' => $this->doctor->id,
            'appointment_date' => $this->tomorrow,
            'start_time' => '09:00',
        ]);

        $response->assertCreated();
        $appointment = Appointment::where('patient_id', $patient->id)->sole();
        $this->assertSame('pending', $appointment->status);

        $first->refresh();
        $this->assertSame('booked', $first->status);
        $this->assertSame($appointment->id, $first->booked_appointment_id);
        $this->assertSame('waiting', $second->fresh()->status);
    }

    // --- decline -----------------------------------------------------------

    public function test_decline_marks_declined_and_offers_next(): void
    {
        [$first, $second] = $this->offeredQueue();

        $this->service()->decline($first);

        $this->assertSame('declined', $first->fresh()->status);
        $this->assertSame('offered', $second->fresh()->status);
        $this->assertSame(2, $this->waitlistMessages()->count());
    }

    public function test_decline_of_an_entry_that_is_not_offered_is_422(): void
    {
        [, $second] = $this->offeredQueue();

        $this->assertValidationMessage('This offer has expired.', fn () => $this->service()->decline($second));
        $this->assertSame('waiting', $second->fresh()->status);
    }

    // --- process / waitlist:process ----------------------------------------

    public function test_command_expires_lapsed_hold_and_offers_next(): void
    {
        [$first, $second, $third] = $this->offeredQueue(3);
        $this->travel(30)->minutes();

        $this->artisan('waitlist:process')->assertSuccessful();

        $this->assertSame('expired', $first->fresh()->status);
        $this->assertSame('offered', $second->fresh()->status);
        $this->assertSame('waiting', $third->fresh()->status);
        $this->assertSame(2, $this->waitlistMessages()->count());
        $this->assertSame($second->patient_id, $this->waitlistMessages()->latest('id')->first()->patient_id);
    }

    public function test_process_expires_entries_for_slots_that_have_started(): void
    {
        $today = $this->now->toDateString();
        $other = $this->consentedPatient();
        $this->appointment($other, $today, '10:30');
        $this->appointment($other, $this->tomorrow, '09:00');
        $pastWaiting = $this->join($this->consentedPatient(), $today, '10:30', 'staff');
        $pastOffered = $this->offeredEntry($this->consentedPatient(), $today, '10:30', 15);
        $future = $this->join($this->consentedPatient(), $this->tomorrow, '09:00');

        $this->travelTo($this->now->copy()->setTime(10, 30)->utc());

        $result = $this->service()->process();

        $this->assertSame(['expired_holds' => 0, 'expired_past' => 2, 'offered' => 0], $result);
        $this->assertSame('expired', $pastWaiting->fresh()->status);
        $this->assertSame('expired', $pastOffered->fresh()->status);
        $this->assertSame('waiting', $future->fresh()->status);
        $this->assertSame(0, $this->waitlistMessages()->count());
    }

    public function test_process_twice_changes_nothing_more(): void
    {
        [$first, $second, $third] = $this->offeredQueue(3);
        $this->travel(30)->minutes();

        $this->assertSame(['expired_holds' => 1, 'expired_past' => 0, 'offered' => 1], $this->service()->process());
        $this->assertSame(['expired_holds' => 0, 'expired_past' => 0, 'offered' => 0], $this->service()->process());

        $this->artisan('waitlist:process')->assertSuccessful();

        $this->assertSame('expired', $first->fresh()->status);
        $this->assertSame('offered', $second->fresh()->status);
        $this->assertSame('waiting', $third->fresh()->status);
        $this->assertSame(2, $this->waitlistMessages()->count());
    }

    public function test_process_with_nothing_to_do(): void
    {
        $this->assertSame(['expired_holds' => 0, 'expired_past' => 0, 'offered' => 0], $this->service()->process());
    }

    public function test_command_is_scheduled_every_minute(): void
    {
        Artisan::call('schedule:list');
        $this->assertStringContainsString('waitlist:process', Artisan::output());

        $event = collect(app(Schedule::class)->events())
            ->first(fn ($e) => str_contains((string) $e->command, 'waitlist:process'));
        $this->assertNotNull($event);
        $this->assertSame('* * * * *', $event->expression);
        $this->assertTrue($event->withoutOverlapping);
    }

    // --- staff booking over a hold ------------------------------------------

    public function test_staff_booking_over_a_hold_requeues_the_offer_without_offering_the_next(): void
    {
        // Message and re-queue details: WaitlistHeldSlotTakenTest.
        [$first, $second] = $this->offeredQueue();

        Sanctum::actingAs($this->receptionist());
        $this->postJson('/api/clinic/appointments', [
            'doctor_id' => $this->doctor->id,
            'patient_id' => $this->consentedPatient()->id,
            'appointment_date' => $this->tomorrow,
            'start_time' => '09:00',
            'end_time' => '09:30',
            'visit_type' => 'new',
            'booking_channel' => 'walk_in',
        ])->assertCreated();

        $this->assertSame('waiting', $first->fresh()->status);
        $this->assertSame('waiting', $second->fresh()->status);
        $this->assertNull($this->service()->heldFor($this->clinic->id, $this->doctor->id, $this->tomorrow, '09:00'));
        $this->assertSame(1, $this->waitlistMessages()->count());

        // The expiry command leaves the occupied slot alone too.
        $this->travel(31)->minutes();
        $this->assertSame(['expired_holds' => 0, 'expired_past' => 0, 'offered' => 0], $this->service()->process());
        $this->assertSame('waiting', $first->fresh()->status);
        $this->assertSame('waiting', $second->fresh()->status);
    }

    public function test_a_waitlist_failure_does_not_abort_the_booking(): void
    {
        // WaitlistService is final, so stand in an object whose slotTaken()
        // throws; the staff create path only calls slotTaken() on it.
        $this->app->instance(\App\Services\Waitlist\WaitlistService::class, new class
        {
            public function slotTaken(Appointment $appointment): void
            {
                throw new \RuntimeException('waitlist down');
            }
        });

        Sanctum::actingAs($this->receptionist());
        $this->postJson('/api/clinic/appointments', [
            'doctor_id' => $this->doctor->id,
            'patient_id' => $this->consentedPatient()->id,
            'appointment_date' => $this->tomorrow,
            'start_time' => '09:00',
            'end_time' => '09:30',
            'visit_type' => 'new',
            'booking_channel' => 'walk_in',
        ])->assertCreated();

        $this->assertSame(1, Appointment::query()->where('doctor_id', $this->doctor->id)->count());
    }

    public function test_staff_booking_the_offered_patient_marks_the_entry_booked(): void
    {
        [$first, $second] = $this->offeredQueue();

        Sanctum::actingAs($this->receptionist());
        $this->postJson('/api/clinic/appointments', [
            'doctor_id' => $this->doctor->id,
            'patient_id' => $first->patient_id,
            'appointment_date' => $this->tomorrow,
            'start_time' => '09:00',
            'end_time' => '09:30',
            'visit_type' => 'new',
            'booking_channel' => 'walk_in',
        ])->assertCreated();

        $first->refresh();
        $this->assertSame('booked', $first->status);
        $this->assertSame(Appointment::where('patient_id', $first->patient_id)->sole()->id, $first->booked_appointment_id);
        $this->assertSame('waiting', $second->fresh()->status);
    }

    public function test_process_expires_a_live_hold_on_a_slot_occupied_by_someone_else(): void
    {
        // E.g. an appointment written by a path that doesn't go through
        // AppointmentService::create(): the command still clears the hold.
        [$first, $second] = $this->offeredQueue();
        $this->appointment($this->consentedPatient(), $this->tomorrow, '09:00');

        $this->assertSame(['expired_holds' => 1, 'expired_past' => 0, 'offered' => 0], $this->service()->process());

        $this->assertSame('expired', $first->fresh()->status);
        $this->assertSame('waiting', $second->fresh()->status);
        $this->assertSame(1, $this->waitlistMessages()->count());
    }

    public function test_cancelling_the_staff_booking_re_offers_the_requeued_entry_first(): void
    {
        [$first, $second] = $this->offeredQueue();
        $staffBooked = app(AppointmentService::class)->create([
            'clinic_id' => $this->clinic->id,
            'doctor_id' => $this->doctor->id,
            'patient_id' => $this->consentedPatient()->id,
            'appointment_date' => $this->tomorrow,
            'start_time' => '09:00:00',
            'end_time' => '09:30:00',
            'visit_type' => 'new',
            'booking_channel' => 'walk_in',
            'status' => 'confirmed',
        ]);
        $this->assertSame('waiting', $first->fresh()->status);

        app(AppointmentService::class)->changeStatus($staffBooked, AppointmentStatus::CANCELLED);

        $this->assertSame('offered', $first->fresh()->status);
        $this->assertSame('waiting', $second->fresh()->status);
        $this->assertSame(1, PatientLoginLink::where('id', $first->fresh()->login_link_id)->whereNull('consumed_at')->count());
    }
}
