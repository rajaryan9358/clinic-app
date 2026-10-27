<?php

namespace Tests\Feature\Waitlist;

use App\Models\Appointment;
use App\Models\WaitlistEntry;
use App\Models\WhatsappMessage;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * Undoing a cancellation (POST /api/clinic/appointments/{id}/undo-status)
 * after the freed slot was offered to the waitlist.
 */
class WaitlistUndoCancelTest extends TestCase
{
    use RefreshDatabase;
    use WaitlistTestHelpers;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpWaitlist();
    }

    /** @return array{0: Appointment, 1: WaitlistEntry, 2: WaitlistEntry} */
    private function cancelledWithOffer(): array
    {
        $appointment = $this->appointment($this->consentedPatient(), $this->tomorrow, '09:00');
        $first = $this->join($this->consentedPatient(), $this->tomorrow, '09:00');
        $second = $this->join($this->consentedPatient(), $this->tomorrow, '09:00');

        Sanctum::actingAs($this->receptionist());
        $this->postJson("/api/clinic/appointments/{$appointment->id}/lifecycle", ['status' => 'cancelled'])->assertOk();

        $this->assertSame('offered', $first->fresh()->status);
        $this->assertSame('waiting', $second->fresh()->status);

        return [$appointment, $first, $second];
    }

    #[Test]
    public function after_the_offer_lapses_the_undo_retakes_the_slot_and_expires_the_offer(): void
    {
        [$appointment, $first, $second] = $this->cancelledWithOffer();

        $this->travel(31)->minutes();

        $this->postJson("/api/clinic/appointments/{$appointment->id}/undo-status")
            ->assertOk()
            ->assertJsonPath('data.status', 'confirmed');

        $this->assertSame('confirmed', $appointment->fresh()->status);
        $this->assertSame('expired', $first->fresh()->status);
        // The slot is taken again, so nobody further down the line is offered it.
        $this->assertSame('waiting', $second->fresh()->status);
        $this->assertSame(1, WhatsappMessage::where('appointment_id', $appointment->id)->where('notification_type', 'booking_confirmed')->count());
        $this->assertSame(0, WhatsappMessage::where('notification_type', 'waitlist_slot_taken')->count());
    }

    #[Test]
    public function while_the_offer_is_live_the_undo_is_refused(): void
    {
        [$appointment, $first, $second] = $this->cancelledWithOffer();

        $res = $this->postJson("/api/clinic/appointments/{$appointment->id}/undo-status")->assertStatus(422);
        $this->assertStringStartsWith('This slot is currently offered to a waitlist patient until ', $res->json('message'));

        $this->assertSame('cancelled', $appointment->fresh()->status);
        $this->assertSame('offered', $first->fresh()->status);
        $this->assertSame('waiting', $second->fresh()->status);
    }

    #[Test]
    public function the_cancelled_patients_own_hold_does_not_block_and_is_booked(): void
    {
        $patient = $this->consentedPatient();
        $appointment = $this->appointment($patient, $this->tomorrow, '09:00', ['status' => 'cancelled', 'cancelled_at' => now()]);
        $own = $this->offeredEntry($patient, $this->tomorrow, '09:00');

        Sanctum::actingAs($this->receptionist());
        $this->postJson("/api/clinic/appointments/{$appointment->id}/undo-status")->assertOk();

        $own->refresh();
        $this->assertSame('booked', $own->status);
        $this->assertSame($appointment->id, (int) $own->booked_appointment_id);
    }
}
