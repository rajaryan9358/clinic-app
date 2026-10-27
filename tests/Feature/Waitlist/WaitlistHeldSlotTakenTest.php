<?php

namespace Tests\Feature\Waitlist;

use App\Enums\AppointmentStatus;
use App\Models\Appointment;
use App\Models\ClinicSetting;
use App\Models\PatientLoginLink;
use App\Models\WaitlistEntry;
use App\Models\WhatsappMessage;
use App\Services\AppointmentService;
use App\Services\WhatsApp\PatientNotifier;
use App\Services\WhatsApp\PhoneNumber;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * Staff booking (or rescheduling) onto a slot that is live-held for a
 * waitlisted patient: the holder goes back to `waiting` in their original
 * place and gets the `waitlist_slot_taken` WhatsApp after commit. See
 * WaitlistService::slotTaken() and PatientNotifier::waitlistSlotTaken().
 */
class WaitlistHeldSlotTakenTest extends TestCase
{
    use RefreshDatabase;
    use WaitlistTestHelpers;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpWaitlist();
    }

    /**
     * Tomorrow 09:00 is booked, two patients join, then the booking is
     * cancelled so the first holds the slot with a real login link.
     *
     * @return array{0: WaitlistEntry, 1: WaitlistEntry}
     */
    private function heldQueue(): array
    {
        $appointment = $this->appointment($this->consentedPatient(), $this->tomorrow, '09:00');
        $first = $this->join($this->consentedPatient(), $this->tomorrow, '09:00');
        $second = $this->join($this->consentedPatient(), $this->tomorrow, '09:00');

        app(AppointmentService::class)->changeStatus($appointment, AppointmentStatus::CANCELLED);

        $first->refresh();
        $this->assertSame('offered', $first->status);
        $this->assertNotNull($first->login_link_id);

        return [$first, $second->fresh()];
    }

    private function staffBook(?int $patientId = null): TestResponse
    {
        Sanctum::actingAs($this->receptionist());

        return $this->postJson('/api/clinic/appointments', [
            'doctor_id' => $this->doctor->id,
            'patient_id' => $patientId ?? $this->consentedPatient()->id,
            'appointment_date' => $this->tomorrow,
            'start_time' => '09:00',
            'end_time' => '09:30',
            'visit_type' => 'new',
            'booking_channel' => 'walk_in',
        ]);
    }

    private function takenMessages(): Builder
    {
        return WhatsappMessage::where('notification_type', 'waitlist_slot_taken');
    }

    private function assertRequeued(WaitlistEntry $before): void
    {
        $after = $before->fresh();
        $this->assertSame('waiting', $after->status);
        $this->assertNull($after->offered_at);
        $this->assertNull($after->hold_expires_at);
        $this->assertNull($after->login_link_id);
        $this->assertEquals($before->created_at, $after->created_at);
        $this->assertNotNull(PatientLoginLink::find($before->login_link_id)->consumed_at);
    }

    #[Test]
    public function staff_booking_over_a_live_hold_requeues_the_holder_and_messages_them_once(): void
    {
        [$first, $second] = $this->heldQueue();

        $this->staffBook()->assertCreated();

        $this->assertRequeued($first);
        $this->assertSame('waiting', $second->fresh()->status);
        $this->assertNull($this->service()->heldFor($this->clinic->id, $this->doctor->id, $this->tomorrow, '09:00'));
        $this->assertSame([$first->id => 1, $second->id => 2], $this->service()->positions([$first->fresh(), $second->fresh()]));

        $message = $this->takenMessages()->sole();
        $this->assertSame($first->patient_id, $message->patient_id);
        $this->assertSame(PhoneNumber::normalise($first->patient->phone), $message->to_phone);
        $this->assertSame('waitlist_slot_taken', $message->template_name);
        $this->assertSame('sent', $message->fresh()->delivery_status);
        $this->assertCount(1, array_filter($this->fake->sent, fn ($s) => $s['template'] === 'waitlist_slot_taken'));
        // No new offer went out for the just-taken slot.
        $this->assertSame(1, $this->waitlistMessages()->count());

        // The expiry sweep leaves the occupied slot's queue alone.
        $this->travel(31)->minutes();
        $this->assertSame(['expired_holds' => 0, 'expired_past' => 0, 'offered' => 0], $this->service()->process());
        $this->assertSame('waiting', $first->fresh()->status);
    }

    #[Test]
    public function the_requeued_holder_keeps_first_place_when_the_slot_frees_again(): void
    {
        [$first, $second] = $this->heldQueue();
        $this->staffBook()->assertCreated();

        $staffBooked = Appointment::query()->where('status', '!=', 'cancelled')->whereDate('appointment_date', $this->tomorrow)->sole();
        app(AppointmentService::class)->changeStatus($staffBooked, AppointmentStatus::CANCELLED);

        $this->assertSame('offered', $first->fresh()->status);
        $this->assertSame('waiting', $second->fresh()->status);
        $this->assertSame(2, $this->waitlistMessages()->where('patient_id', $first->patient_id)->count());
    }

    #[Test]
    public function staff_booking_over_a_lapsed_offer_expires_it_and_sends_nothing(): void
    {
        [$first, $second] = $this->heldQueue();
        $this->travel(31)->minutes();

        $this->staffBook()->assertCreated();

        $this->assertSame('expired', $first->fresh()->status);
        $this->assertSame('waiting', $second->fresh()->status);
        $this->assertSame(0, $this->takenMessages()->count());
    }

    #[Test]
    public function the_holder_booking_their_own_offer_sends_nothing(): void
    {
        [$first, $second] = $this->heldQueue();

        $this->service()->book($first, ['visit_type' => 'new']);

        $this->assertSame('booked', $first->fresh()->status);
        $this->assertSame('waiting', $second->fresh()->status);
        $this->assertSame(0, $this->takenMessages()->count());
    }

    #[Test]
    public function staff_booking_the_holder_themselves_sends_nothing(): void
    {
        [$first] = $this->heldQueue();

        $this->staffBook($first->patient_id)->assertCreated();

        $this->assertSame('booked', $first->fresh()->status);
        $this->assertSame(0, $this->takenMessages()->count());
    }

    /** @return array<string, array{string}> */
    public static function reschedulePaths(): array
    {
        return ['reschedule' => ['reschedule'], 'updateDetails' => ['updateDetails']];
    }

    #[Test]
    #[DataProvider('reschedulePaths')]
    public function rescheduling_onto_a_held_slot_behaves_like_a_booking(string $method): void
    {
        $moving = $this->appointment($this->consentedPatient(), $this->tomorrow, '11:00');
        [$first, $second] = $this->heldQueue();

        $slot = ['appointment_date' => $this->tomorrow, 'start_time' => '09:00:00', 'end_time' => '09:30:00'];
        $service = app(AppointmentService::class);
        $method === 'reschedule' ? $service->reschedule($moving, $slot) : $service->updateDetails($moving, $slot);

        $this->assertSame('09:00:00', $moving->fresh()->start_time);
        $this->assertRequeued($first);
        $this->assertSame('waiting', $second->fresh()->status);
        $this->assertSame($first->patient_id, $this->takenMessages()->sole()->patient_id);
    }

    #[Test]
    public function a_notifier_failure_does_not_fail_the_booking(): void
    {
        [$first] = $this->heldQueue();
        $this->app->instance(PatientNotifier::class, new class extends PatientNotifier
        {
            public function waitlistSlotTaken(WaitlistEntry $entry): WhatsappMessage
            {
                throw new \RuntimeException('whatsapp down');
            }
        });

        $this->staffBook()->assertCreated();

        $this->assertSame(1, Appointment::query()->where('status', '!=', 'cancelled')->whereDate('appointment_date', $this->tomorrow)->count());
        $this->assertRequeued($first);
        $this->assertSame(0, $this->takenMessages()->count());
    }

    /** @return array<string, array{array<string, bool>}> */
    public static function disabledSettings(): array
    {
        return [
            'waitlist disabled' => [['waitlist_enabled' => false]],
            'portal disabled' => [['portal_enabled' => false]],
        ];
    }

    #[Test]
    #[DataProvider('disabledSettings')]
    public function nothing_is_sent_while_the_waitlist_or_portal_is_disabled(array $settings): void
    {
        [$first] = $this->heldQueue();
        ClinicSetting::updateOrCreate(['clinic_id' => $this->clinic->id], $settings);

        $this->staffBook()->assertCreated();

        $this->assertRequeued($first);
        $this->assertSame(0, $this->takenMessages()->count());
    }

    #[Test]
    public function nothing_is_sent_to_a_holder_who_opted_out_of_whatsapp(): void
    {
        [$first] = $this->heldQueue();
        $first->patient->forceFill(['whatsapp_opt_in' => false])->save();

        $this->staffBook()->assertCreated();

        $this->assertRequeued($first);
        $this->assertSame(0, $this->takenMessages()->count());
    }
}
