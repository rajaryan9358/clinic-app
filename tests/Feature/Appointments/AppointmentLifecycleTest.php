<?php

namespace Tests\Feature\Appointments;

use App\Models\Appointment;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * POST /api/clinic/appointments/{id}/lifecycle. Slot times are clinic-local
 * (Asia/Kolkata), so the clock is frozen at 2026-10-01 10:00 IST; "due"
 * appointments start today at 09:00 so both the check-in (>= start-15m)
 * and no-show (>= start+15m) windows are open.
 */
class AppointmentLifecycleTest extends TestCase
{
    use AppointmentTestHelpers;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpAppointments();
        $this->travelTo(Carbon::parse('2026-10-01 10:00:00', 'Asia/Kolkata')->utc());
    }

    private function dueAppointment(string $status = 'confirmed'): Appointment
    {
        return $this->makeAppointment([
            'appointment_date' => $this->today,
            'start_time' => '09:00:00',
            'end_time' => '09:30:00',
            'status' => $status,
        ]);
    }

    private function lifecycle(Appointment $appointment, string $status, array $extra = [])
    {
        return $this->postJson("/api/clinic/appointments/{$appointment->id}/lifecycle", ['status' => $status] + $extra);
    }

    #[Test]
    public function walks_the_happy_path_pending_to_completed_recording_timestamps_and_logs(): void
    {
        $user = $this->actingAsStaff();
        $appointment = $this->dueAppointment('pending');

        foreach (['confirmed', 'checked_in', 'in_consultation', 'completed'] as $status) {
            $this->lifecycle($appointment, $status)
                ->assertOk()
                ->assertJsonPath('success', true)
                ->assertJsonPath('data.status', $status);
        }

        $fresh = $appointment->fresh();
        $this->assertSame('completed', $fresh->status);
        $this->assertNotNull($fresh->confirmed_at);
        $this->assertNotNull($fresh->checked_in_at);
        $this->assertNotNull($fresh->completed_at);
        $this->assertNull($fresh->cancelled_at);

        $logs = $fresh->statusLogs()->orderBy('id')->get(['old_status', 'new_status', 'changed_by_user_id', 'source']);
        $this->assertSame(
            [['pending', 'confirmed'], ['confirmed', 'checked_in'], ['checked_in', 'in_consultation'], ['in_consultation', 'completed']],
            $logs->map(fn ($l) => [$l->old_status, $l->new_status])->all()
        );
        $this->assertTrue($logs->every(fn ($l) => (int) $l->changed_by_user_id === $user->id && $l->source === 'staff'));
    }

    public static function cancellableStatuses(): array
    {
        return [['pending'], ['confirmed'], ['checked_in']];
    }

    #[Test]
    #[DataProvider('cancellableStatuses')]
    public function cancel_records_reason_timestamp_and_notifies_patient(string $from): void
    {
        $this->actingAsStaff();
        $appointment = $this->dueAppointment($from);

        $this->lifecycle($appointment, 'cancelled', ['reason' => 'Patient called'])
            ->assertOk()
            ->assertJsonPath('data.status', 'cancelled')
            ->assertJsonPath('data.cancellation_reason', 'Patient called');

        $this->assertNotNull($appointment->fresh()->cancelled_at);
        $this->assertDatabaseHas('appointment_status_logs', [
            'appointment_id' => $appointment->id,
            'old_status' => $from,
            'new_status' => 'cancelled',
            'reason' => 'Patient called',
        ]);
        $this->assertDatabaseHas('whatsapp_messages', [
            'appointment_id' => $appointment->id,
            'notification_type' => 'appointment_updated',
        ]);
    }

    #[Test]
    public function no_show_is_allowed_after_fifteen_minutes_past_start(): void
    {
        $this->actingAsStaff();
        $appointment = $this->dueAppointment();

        $this->lifecycle($appointment, 'no_show')->assertOk()->assertJsonPath('data.status', 'no_show');
    }

    #[Test]
    public function no_show_is_rejected_before_fifteen_minutes_past_start(): void
    {
        $this->actingAsStaff();
        $appointment = $this->makeAppointment(['appointment_date' => $this->today, 'start_time' => '09:50:00']);

        $this->lifecycle($appointment, 'no_show')
            ->assertStatus(422)
            ->assertJsonValidationErrors(['status' => 'No-show is allowed only after 15 minutes past the appointment time.']);
        $this->assertSame('confirmed', $appointment->fresh()->status);
    }

    #[Test]
    public function check_in_is_allowed_from_fifteen_minutes_before_start(): void
    {
        $this->actingAsStaff();
        $appointment = $this->makeAppointment(['appointment_date' => $this->today, 'start_time' => '10:15:00']);

        $this->lifecycle($appointment, 'checked_in')->assertOk();
    }

    #[Test]
    public function check_in_is_rejected_earlier_than_fifteen_minutes_before_start(): void
    {
        $this->actingAsStaff();
        $appointment = $this->makeAppointment(['appointment_date' => $this->today, 'start_time' => '10:16:00']);

        $this->lifecycle($appointment, 'checked_in')
            ->assertStatus(422)
            ->assertJsonValidationErrors(['status' => 'Check-in is allowed from 15 minutes before the appointment.']);
        $this->assertNull($appointment->fresh()->checked_in_at);
    }

    #[Test]
    public function clinic_admin_can_force_an_early_check_in(): void
    {
        $this->actingAsStaff('clinic_admin');
        $appointment = $this->makeAppointment(['start_time' => '11:00:00']); // tomorrow

        $this->lifecycle($appointment, 'checked_in', ['force' => true])
            ->assertOk()
            ->assertJsonPath('data.status', 'checked_in');
    }

    #[Test]
    public function force_is_ignored_for_non_admin_staff(): void
    {
        $this->actingAsStaff('receptionist');
        $appointment = $this->makeAppointment(['start_time' => '11:00:00']); // tomorrow

        $this->lifecycle($appointment, 'checked_in', ['force' => true])->assertStatus(422);
        $this->assertSame('confirmed', $appointment->fresh()->status);
    }

    /**
     * Appointment times are clinic-local (config app.clinic_timezone,
     * Asia/Kolkata), as WaitlistService and PortalBookingPolicy interpret
     * them: a patient arriving on time for a 10:00 IST slot can check in.
     */
    #[Test]
    public function check_in_window_uses_the_clinic_timezone(): void
    {
        $this->travelTo(Carbon::parse('2026-10-01 10:00:00', 'Asia/Kolkata')->utc());
        $this->actingAsStaff();
        $appointment = $this->makeAppointment(['appointment_date' => $this->today, 'start_time' => '10:00:00']);

        $this->lifecycle($appointment, 'checked_in')->assertOk();
    }

    #[Test]
    public function missing_status_is_a_validation_error(): void
    {
        $this->actingAsStaff();
        $appointment = $this->dueAppointment();

        $this->postJson("/api/clinic/appointments/{$appointment->id}/lifecycle", [])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['status']);
    }

    #[Test]
    public function unknown_status_is_a_validation_error_not_a_server_error(): void
    {
        $this->actingAsStaff();
        $appointment = $this->dueAppointment();

        $this->lifecycle($appointment, 'teleported')->assertStatus(422);
    }

    public static function disallowedTransitions(): array
    {
        return [
            'completed back to checked_in' => ['completed', 'checked_in'],
            'completed to cancelled' => ['completed', 'cancelled'],
            'cancelled to in_consultation' => ['cancelled', 'in_consultation'],
            'no_show to completed' => ['no_show', 'completed'],
            'pending straight to completed' => ['pending', 'completed'],
            'lifecycle to rescheduled' => ['confirmed', 'rescheduled'],
        ];
    }

    /**
     * Terminal states can't be reopened, steps can't be skipped, and
     * 'rescheduled' is only reachable via the reschedule endpoint. Force
     * (clinic admin) bypasses timing windows, not transitions.
     */
    #[Test]
    #[DataProvider('disallowedTransitions')]
    public function rejects_invalid_status_transitions(string $from, string $to): void
    {
        $this->actingAsStaff('clinic_admin');
        $appointment = $this->dueAppointment($from);

        $this->lifecycle($appointment, $to)->assertStatus(422);
        $this->assertSame($from, $appointment->fresh()->status);
    }

    #[Test]
    public function cancel_requires_the_cancel_permission(): void
    {
        // Assistant default role: appointments view/create/edit + check_in, no cancel.
        Sanctum::actingAs($this->staffWith(['appointments.view', 'appointments.edit', 'appointments.check_in']));
        $appointment = $this->dueAppointment();

        $this->lifecycle($appointment, 'cancelled')
            ->assertForbidden()
            ->assertJsonPath('message', "You don't have permission to cancel appointments.");
        $this->assertSame('confirmed', $appointment->fresh()->status);
    }

    #[Test]
    public function non_cancel_transitions_require_the_check_in_permission(): void
    {
        Sanctum::actingAs($this->staffWith(['appointments.view', 'appointments.edit', 'appointments.cancel']));
        $appointment = $this->dueAppointment();

        $this->lifecycle($appointment, 'checked_in')
            ->assertForbidden()
            ->assertJsonPath('message', "You don't have permission to check in appointments.");

        $this->lifecycle($appointment, 'cancelled')->assertOk();
    }

    #[Test]
    public function lifecycle_requires_view_permission(): void
    {
        Sanctum::actingAs($this->staffWith(['appointments.check_in', 'appointments.cancel']));
        $appointment = $this->dueAppointment();

        $this->lifecycle($appointment, 'checked_in')->assertForbidden();
    }

    #[Test]
    public function unknown_appointment_returns_404(): void
    {
        $this->actingAsStaff();

        $this->postJson('/api/clinic/appointments/999999/lifecycle', ['status' => 'checked_in'])->assertNotFound();
    }

    /**
     * The generic CRUD status route (POST /appointments/{id}/status) runs
     * the lifecycle path: same permission checks, rules, logs and hooks.
     */
    #[Test]
    public function generic_status_route_does_not_bypass_lifecycle_rules(): void
    {
        // Edit but no cancel permission.
        Sanctum::actingAs($this->staffWith(['appointments.view', 'appointments.edit']));
        $appointment = $this->dueAppointment();

        $this->postJson("/api/clinic/appointments/{$appointment->id}/status", ['status' => 'cancelled'])
            ->assertForbidden();
        $this->assertSame('confirmed', $appointment->fresh()->status);
    }

    #[Test]
    public function generic_status_route_cancels_through_the_lifecycle(): void
    {
        Sanctum::actingAs($this->staffWith(['appointments.view', 'appointments.edit', 'appointments.cancel']));
        $appointment = $this->dueAppointment();

        $this->postJson("/api/clinic/appointments/{$appointment->id}/status", ['status' => 'cancelled', 'reason' => 'Clash'])
            ->assertOk()
            ->assertJsonPath('data.status', 'cancelled');

        $this->assertNotNull($appointment->fresh()->cancelled_at);
        $this->assertDatabaseHas('appointment_status_logs', [
            'appointment_id' => $appointment->id,
            'old_status' => 'confirmed',
            'new_status' => 'cancelled',
            'reason' => 'Clash',
        ]);
    }

    #[Test]
    public function repeating_the_current_status_is_a_no_op(): void
    {
        $this->actingAsStaff();
        $appointment = $this->dueAppointment();

        $this->lifecycle($appointment, 'confirmed')->assertOk()->assertJsonPath('data.status', 'confirmed');
        $this->assertSame(0, $appointment->statusLogs()->count());
    }

    #[Test]
    public function force_does_not_bypass_transition_rules(): void
    {
        $this->actingAsStaff('clinic_admin');
        $appointment = $this->dueAppointment('completed');

        $this->lifecycle($appointment, 'checked_in', ['force' => true])->assertStatus(422);
        $this->assertSame('completed', $appointment->fresh()->status);
    }

    #[Test]
    public function transition_is_checked_against_the_current_row_not_the_callers_copy(): void
    {
        $stale = $this->dueAppointment('confirmed');
        Appointment::whereKey($stale->id)->update(['status' => 'cancelled']);

        try {
            app(\App\Services\AppointmentService::class)->changeStatus($stale, \App\Enums\AppointmentStatus::CHECKED_IN);
            $this->fail('Expected cancelled -> checked_in to be rejected.');
        } catch (\Illuminate\Validation\ValidationException $e) {
            $this->assertArrayHasKey('status', $e->errors());
        }

        $this->assertSame('cancelled', $stale->fresh()->status);
        $this->assertSame(0, $stale->statusLogs()->count());
    }

    #[Test]
    public function lifecycle_response_returns_the_updated_record(): void
    {
        $this->actingAsStaff();
        $appointment = $this->dueAppointment('confirmed');

        $this->lifecycle($appointment, 'checked_in')
            ->assertOk()
            ->assertJsonPath('data.id', $appointment->id)
            ->assertJsonPath('data.status', 'checked_in')
            ->assertJsonPath('data.checked_in_at', fn ($v) => $v !== null);
    }
}
