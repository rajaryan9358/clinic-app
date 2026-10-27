<?php

namespace Tests\Feature\Appointments;

use App\Models\Appointment;
use App\Models\ReminderLog;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/** POST /api/clinic/appointments/{id}/reschedule */
class AppointmentRescheduleTest extends TestCase
{
    use AppointmentTestHelpers;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpAppointments();
    }

    private function reschedule(Appointment $appointment, array $payload)
    {
        return $this->postJson("/api/clinic/appointments/{$appointment->id}/reschedule", $payload);
    }

    private function hhmm(?string $time): ?string
    {
        return $time === null ? null : substr($time, 0, 5);
    }

    #[Test]
    public function moves_the_appointment_and_writes_a_reschedule_log(): void
    {
        $user = $this->actingAsStaff();
        $appointment = $this->makeAppointment();

        $this->reschedule($appointment, [
            'appointment_date' => '2026-10-03',
            'start_time' => '11:00',
            'end_time' => '11:30',
            'reason' => 'Doctor delayed',
        ])->assertOk()->assertJsonPath('success', true);

        $fresh = $appointment->fresh();
        $this->assertSame('2026-10-03', $fresh->appointment_date->toDateString());
        $this->assertSame('11:00', $this->hhmm($fresh->start_time));
        $this->assertSame('11:30', $this->hhmm($fresh->end_time));
        $this->assertSame('confirmed', $fresh->status, 'staff reschedule keeps the status');

        $this->assertDatabaseHas('appointment_reschedule_logs', [
            'old_appointment_id' => $appointment->id,
            'new_appointment_id' => $appointment->id,
            'old_appointment_date' => $this->tomorrow,
            'old_start_time' => '10:00:00',
            'new_appointment_date' => '2026-10-03',
            'changed_by_user_id' => $user->id,
            'reason' => 'Doctor delayed',
        ]);
        $this->assertDatabaseHas('whatsapp_messages', [
            'appointment_id' => $appointment->id,
            'notification_type' => 'appointment_updated',
        ]);
    }

    #[Test]
    public function drops_stale_appointment_reminder_logs(): void
    {
        $this->actingAsStaff();
        $appointment = $this->makeAppointment();
        ReminderLog::create([
            'clinic_id' => $this->clinic->id,
            'appointment_id' => $appointment->id,
            'patient_id' => $appointment->patient_id,
            'reminder_type' => 'appointment_reminder',
            'channel' => 'whatsapp',
            'scheduled_for' => now(),
        ]);

        $this->reschedule($appointment, ['appointment_date' => '2026-10-03', 'start_time' => '11:00', 'end_time' => '11:30'])
            ->assertOk();

        $this->assertSame(0, ReminderLog::where('appointment_id', $appointment->id)->count());
    }

    #[Test]
    public function rejects_an_overlapping_slot(): void
    {
        $this->actingAsStaff();
        $this->makeAppointment(['start_time' => '11:00:00', 'end_time' => '11:30:00']);
        $appointment = $this->makeAppointment(['start_time' => '09:00:00', 'end_time' => '09:30:00']);

        $this->reschedule($appointment, ['appointment_date' => $this->tomorrow, 'start_time' => '11:15', 'end_time' => '11:45'])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['start_time' => 'Selected slot is already booked.']);

        $this->assertSame('09:00', $this->hhmm($appointment->fresh()->start_time));
        $this->assertDatabaseCount('appointment_reschedule_logs', 0);
    }

    #[Test]
    public function allows_a_back_to_back_slot(): void
    {
        $this->actingAsStaff();
        $this->makeAppointment(['start_time' => '11:00:00', 'end_time' => '11:30:00']);
        $appointment = $this->makeAppointment(['start_time' => '09:00:00', 'end_time' => '09:30:00']);

        $this->reschedule($appointment, ['appointment_date' => $this->tomorrow, 'start_time' => '10:30', 'end_time' => '11:00'])
            ->assertOk();
        $this->reschedule($appointment, ['appointment_date' => $this->tomorrow, 'start_time' => '11:30', 'end_time' => '12:00'])
            ->assertOk();
    }

    public static function nonBlockingStatuses(): array
    {
        return [['cancelled'], ['rescheduled']];
    }

    #[Test]
    #[DataProvider('nonBlockingStatuses')]
    public function cancelled_or_rescheduled_appointments_do_not_block_the_slot(string $status): void
    {
        $this->actingAsStaff();
        $this->makeAppointment(['start_time' => '11:00:00', 'end_time' => '11:30:00', 'status' => $status]);
        $appointment = $this->makeAppointment(['start_time' => '09:00:00', 'end_time' => '09:30:00']);

        $this->reschedule($appointment, ['appointment_date' => $this->tomorrow, 'start_time' => '11:00', 'end_time' => '11:30'])
            ->assertOk();
    }

    #[Test]
    public function another_doctors_appointment_does_not_block_the_slot(): void
    {
        $this->actingAsStaff();
        $otherDoc = $this->makeDoctor($this->clinic, 'Dr Two');
        $this->makeAppointment(['doctor_id' => $otherDoc->id, 'start_time' => '11:00:00', 'end_time' => '11:30:00']);
        $appointment = $this->makeAppointment(['start_time' => '09:00:00', 'end_time' => '09:30:00']);

        $this->reschedule($appointment, ['appointment_date' => $this->tomorrow, 'start_time' => '11:00', 'end_time' => '11:30'])
            ->assertOk();
    }

    #[Test]
    public function shifting_within_its_own_slot_is_not_a_self_conflict(): void
    {
        $this->actingAsStaff();
        $appointment = $this->makeAppointment(['start_time' => '10:00:00', 'end_time' => '10:30:00']);

        $this->reschedule($appointment, ['appointment_date' => $this->tomorrow, 'start_time' => '10:15', 'end_time' => '10:45'])
            ->assertOk();
    }

    public static function unmovableStatuses(): array
    {
        return [['cancelled'], ['completed'], ['no_show'], ['rescheduled'], ['in_consultation']];
    }

    #[Test]
    #[DataProvider('unmovableStatuses')]
    public function cannot_reschedule_an_appointment_past_check_in_or_terminal(string $status): void
    {
        $this->actingAsStaff();
        $appointment = $this->makeAppointment(['status' => $status]);

        $this->reschedule($appointment, ['appointment_date' => '2026-10-03', 'start_time' => '11:00', 'end_time' => '11:30'])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['status' => 'Only pending, confirmed or checked-in appointments can be moved.']);

        $fresh = $appointment->fresh();
        $this->assertSame($this->tomorrow, $fresh->appointment_date->toDateString());
        $this->assertSame($status, $fresh->status);
    }

    public static function movableStatuses(): array
    {
        return [['pending'], ['confirmed'], ['checked_in']];
    }

    #[Test]
    #[DataProvider('movableStatuses')]
    public function pending_confirmed_and_checked_in_appointments_can_be_rescheduled(string $status): void
    {
        $this->actingAsStaff();
        $appointment = $this->makeAppointment(['status' => $status]);

        $this->reschedule($appointment, ['appointment_date' => '2026-10-03', 'start_time' => '11:00', 'end_time' => '11:30'])
            ->assertOk()
            ->assertJsonPath('data.start_time', fn ($t) => str_starts_with((string) $t, '11:00'));

        $this->assertSame('2026-10-03', $appointment->fresh()->appointment_date->toDateString());
    }

    #[Test]
    public function reschedule_checks_status_on_the_current_row_not_the_callers_copy(): void
    {
        $this->actingAsStaff();
        $stale = $this->makeAppointment();
        Appointment::whereKey($stale->id)->update(['status' => 'completed']);

        try {
            app(\App\Services\AppointmentService::class)->reschedule($stale, ['appointment_date' => '2026-10-03', 'start_time' => '11:00', 'end_time' => '11:30']);
            $this->fail('Expected a validation error for a completed appointment.');
        } catch (\Illuminate\Validation\ValidationException $e) {
            $this->assertArrayHasKey('status', $e->errors());
        }

        $this->assertSame($this->tomorrow, $stale->fresh()->appointment_date->toDateString());
    }

    /**
     * Staff reschedule (like staff create) has no past-date guard. Pinned
     * as current behaviour; flagged in the report as possibly unintended.
     */
    #[Test]
    public function staff_can_reschedule_into_the_past(): void
    {
        $this->actingAsStaff();
        $appointment = $this->makeAppointment();

        $this->reschedule($appointment, ['appointment_date' => $this->yesterday, 'start_time' => '09:00', 'end_time' => '09:30'])
            ->assertOk();
    }

    #[Test]
    public function requires_date_and_start_time(): void
    {
        $this->actingAsStaff();
        $appointment = $this->makeAppointment();

        $this->reschedule($appointment, [])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['appointment_date', 'start_time']);
    }

    /**
     * Omitting end_time keeps the appointment's length (11:00-11:30 here),
     * so the conflict check runs on the real range.
     */
    #[Test]
    public function rescheduling_without_end_time_does_not_keep_the_stale_end_or_double_book(): void
    {
        $this->actingAsStaff();
        $this->makeAppointment(['start_time' => '11:00:00', 'end_time' => '11:30:00']);
        $appointment = $this->makeAppointment(['start_time' => '10:00:00', 'end_time' => '10:30:00']);

        $this->reschedule($appointment, ['appointment_date' => $this->tomorrow, 'start_time' => '11:00'])
            ->assertStatus(422);
    }

    #[Test]
    public function requires_appointments_edit_permission(): void
    {
        \Laravel\Sanctum\Sanctum::actingAs($this->staffWith(['appointments.view']));
        $appointment = $this->makeAppointment();

        $this->reschedule($appointment, ['appointment_date' => '2026-10-03', 'start_time' => '11:00'])
            ->assertForbidden();
    }

    #[Test]
    public function rescheduling_without_end_time_keeps_the_appointment_length(): void
    {
        $this->actingAsStaff();
        $appointment = $this->makeAppointment(['start_time' => '10:00:00', 'end_time' => '10:20:00']);

        $this->reschedule($appointment, ['appointment_date' => $this->tomorrow, 'start_time' => '11:00'])->assertOk();

        $this->assertSame('11:20', $this->hhmm($appointment->fresh()->end_time));
    }

    #[Test]
    public function rejects_end_time_before_start_time(): void
    {
        $this->actingAsStaff();
        $appointment = $this->makeAppointment();

        $this->reschedule($appointment, ['appointment_date' => $this->tomorrow, 'start_time' => '11:00', 'end_time' => '10:30'])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['end_time']);
    }
}
