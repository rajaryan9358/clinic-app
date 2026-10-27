<?php

namespace Tests\Feature\Appointments;

use App\Models\Appointment;
use App\Models\AppointmentStatusLog;
use App\Models\User;
use App\Models\WaitlistEntry;
use App\Models\WhatsappMessage;
use App\Services\AppointmentService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * POST /api/{clinic,super-admin}/appointments/{id}/undo-status
 * (AppointmentService::undoStatus). The clock is frozen at 2026-10-01
 * 10:00 IST, so "today" is the same date in UTC and clinic time.
 */
class AppointmentUndoTest extends TestCase
{
    use AppointmentTestHelpers;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpAppointments();
        $this->travelTo(Carbon::parse('2026-10-01 10:00:00', 'Asia/Kolkata')->utc());
    }

    private function undo(Appointment $appointment, string $prefix = 'clinic'): TestResponse
    {
        return $this->postJson("/api/{$prefix}/appointments/{$appointment->id}/undo-status");
    }

    /** An appointment in $status whose last log row moved it there from $from (null: no log). */
    private function appointmentIn(string $status, ?string $from, array $overrides = []): Appointment
    {
        $appointment = $this->makeAppointment(array_merge([
            'status' => $status,
            'cancelled_at' => $status === 'cancelled' ? now() : null,
            'cancellation_reason' => $status === 'cancelled' ? 'Clash' : null,
            'completed_at' => $status === 'completed' ? now() : null,
        ], $overrides));

        if ($from !== null) {
            AppointmentStatusLog::create([
                'clinic_id' => $appointment->clinic_id,
                'appointment_id' => $appointment->id,
                'old_status' => $from,
                'new_status' => $status,
                'source' => 'staff',
                'created_at' => now(),
            ]);
        }

        return $appointment;
    }

    private function bookingConfirmations(Appointment $appointment): int
    {
        return WhatsappMessage::where('appointment_id', $appointment->id)
            ->where('notification_type', 'booking_confirmed')
            ->count();
    }

    private function superAdmin(): User
    {
        $user = User::create([
            'uuid' => (string) Str::uuid(), 'full_name' => 'Super',
            'email' => 'super-'.Str::random(6).'@x.test', 'password' => 'x', 'role' => 'super_admin', 'status' => 'active',
        ]);
        $user->assignRole('super_admin');

        return $user;
    }

    public static function previousStatuses(): array
    {
        return [
            'cancelled from pending' => ['cancelled', 'pending', 'pending'],
            'cancelled from confirmed' => ['cancelled', 'confirmed', 'confirmed'],
            'cancelled from checked in' => ['cancelled', 'checked_in', 'checked_in'],
            'no-show from pending' => ['no_show', 'pending', 'pending'],
            'no-show from checked in' => ['no_show', 'checked_in', 'checked_in'],
            'completed from checked in' => ['completed', 'checked_in', 'checked_in'],
            'completed from in consultation' => ['completed', 'in_consultation', 'in_consultation'],
        ];
    }

    #[Test]
    #[DataProvider('previousStatuses')]
    public function undo_returns_to_the_status_before_the_last_change(string $status, string $from, string $expected): void
    {
        $this->actingAsStaff();
        $appointment = $this->appointmentIn($status, $from);

        $this->undo($appointment)
            ->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.status', $expected);

        $this->assertSame($expected, $appointment->fresh()->status);
    }

    public static function fallbacks(): array
    {
        return [
            'cancelled, no log' => ['cancelled', null, 'confirmed'],
            'no-show, no log' => ['no_show', null, 'confirmed'],
            'completed, no log' => ['completed', null, 'in_consultation'],
            'completed from an impossible status' => ['completed', 'confirmed', 'in_consultation'],
            'cancelled from an unknown status' => ['cancelled', 'bogus', 'confirmed'],
            'cancelled from in consultation (not a cancel source)' => ['cancelled', 'in_consultation', 'confirmed'],
        ];
    }

    #[Test]
    #[DataProvider('fallbacks')]
    public function undo_falls_back_when_the_previous_status_is_missing_or_invalid(string $status, ?string $from, string $expected): void
    {
        $this->actingAsStaff();
        $appointment = $this->appointmentIn($status, $from);

        $this->undo($appointment)->assertOk()->assertJsonPath('data.status', $expected);
    }

    #[Test]
    public function undo_uses_the_latest_change_into_the_current_status(): void
    {
        $this->actingAsStaff();
        $appointment = $this->appointmentIn('cancelled', 'pending');
        AppointmentStatusLog::create([
            'clinic_id' => $appointment->clinic_id, 'appointment_id' => $appointment->id,
            'old_status' => 'cancelled', 'new_status' => 'pending', 'source' => 'staff', 'created_at' => now(),
        ]);
        AppointmentStatusLog::create([
            'clinic_id' => $appointment->clinic_id, 'appointment_id' => $appointment->id,
            'old_status' => 'checked_in', 'new_status' => 'cancelled', 'source' => 'staff', 'created_at' => now(),
        ]);

        $this->undo($appointment)->assertOk()->assertJsonPath('data.status', 'checked_in');
    }

    #[Test]
    public function undoing_a_cancel_clears_the_cancellation_and_resends_the_confirmation(): void
    {
        $this->actingAsStaff();
        $appointment = $this->makeAppointment(['status' => 'confirmed']);
        $this->postJson("/api/clinic/appointments/{$appointment->id}/lifecycle", ['status' => 'cancelled', 'reason' => 'Clash'])->assertOk();
        $this->assertSame(0, $this->bookingConfirmations($appointment));
        $sentBefore = count($this->fake->sent);

        $this->undo($appointment)->assertOk()->assertJsonPath('data.status', 'confirmed');

        $fresh = $appointment->fresh();
        $this->assertNull($fresh->cancelled_at);
        $this->assertNull($fresh->cancellation_reason);
        $this->assertSame(1, $this->bookingConfirmations($appointment));
        $this->assertCount($sentBefore + 1, $this->fake->sent);
    }

    #[Test]
    public function undoing_a_no_show_or_completion_sends_no_message(): void
    {
        $this->actingAsStaff();
        $noShow = $this->appointmentIn('no_show', 'confirmed', ['appointment_date' => $this->today, 'start_time' => '09:00:00', 'end_time' => '09:30:00']);
        $completed = $this->appointmentIn('completed', 'in_consultation', ['appointment_date' => $this->today, 'start_time' => '09:30:00', 'end_time' => '10:00:00']);

        $this->undo($noShow)->assertOk()->assertJsonPath('data.status', 'confirmed');
        $this->undo($completed)->assertOk()->assertJsonPath('data.status', 'in_consultation');

        $this->assertNull($completed->fresh()->completed_at);
        $this->assertSame(0, WhatsappMessage::count());
        $this->assertSame([], $this->fake->sent);
    }

    #[Test]
    public function undoing_a_cancel_is_refused_when_another_appointment_took_the_slot(): void
    {
        $this->actingAsStaff();
        $appointment = $this->appointmentIn('cancelled', 'confirmed');
        $other = $this->makeAppointment([
            'patient_id' => $this->makePatient(null, ['first_name' => 'Meera', 'last_name' => 'Shah', 'full_name' => 'Meera Shah'])->id,
            'start_time' => '10:15:00',
            'end_time' => '10:45:00',
        ]);

        $this->undo($appointment)
            ->assertStatus(422)
            ->assertJsonPath('message', "Cannot undo: the slot is now taken by Meera Shah's appointment at 10:15 (#{$other->id}).");

        $this->assertSame('cancelled', $appointment->fresh()->status);
        $this->assertSame(0, $this->bookingConfirmations($appointment));
    }

    #[Test]
    public function an_adjacent_or_cancelled_appointment_does_not_block_the_undo(): void
    {
        $this->actingAsStaff();
        $appointment = $this->appointmentIn('cancelled', 'confirmed');
        $this->makeAppointment(['start_time' => '10:30:00', 'end_time' => '11:00:00']);
        $this->makeAppointment(['status' => 'cancelled']);

        $this->undo($appointment)->assertOk()->assertJsonPath('data.status', 'confirmed');
    }

    #[Test]
    public function undoing_a_no_show_checks_the_slot_too(): void
    {
        $this->actingAsStaff();
        $appointment = $this->appointmentIn('no_show', 'confirmed');
        $this->makeAppointment();

        $this->undo($appointment)->assertStatus(422);
        $this->assertSame('no_show', $appointment->fresh()->status);
    }

    private function holdOn(Appointment $appointment, Carbon $expiresAt): WaitlistEntry
    {
        return WaitlistEntry::create([
            'clinic_id' => $this->clinic->id,
            'patient_id' => $this->makePatient()->id,
            'doctor_id' => $this->doctor->id,
            'appointment_date' => $appointment->appointment_date->toDateString(),
            'start_time' => '10:00:00',
            'end_time' => '10:30:00',
            'status' => 'offered',
            'source' => 'portal',
            'offered_at' => now()->subMinutes(5),
            'hold_expires_at' => $expiresAt,
        ]);
    }

    #[Test]
    public function a_live_waitlist_hold_blocks_undoing_a_cancel(): void
    {
        $this->actingAsStaff();
        $appointment = $this->appointmentIn('cancelled', 'confirmed');
        // 10:25 IST.
        $hold = $this->holdOn($appointment, now()->addMinutes(25));

        $this->undo($appointment)
            ->assertStatus(422)
            ->assertJsonPath('message', 'This slot is currently offered to a waitlist patient until 10:25.');

        $this->assertSame('cancelled', $appointment->fresh()->status);
        $this->assertSame('offered', $hold->fresh()->status);
    }

    #[Test]
    public function a_lapsed_waitlist_hold_does_not_block_and_is_expired(): void
    {
        $this->actingAsStaff();
        $appointment = $this->appointmentIn('cancelled', 'confirmed');
        $hold = $this->holdOn($appointment, now()->subMinute());

        $this->undo($appointment)->assertOk()->assertJsonPath('data.status', 'confirmed');

        $this->assertSame('expired', $hold->fresh()->status);
    }

    #[Test]
    public function undo_is_allowed_on_the_appointment_day(): void
    {
        $this->actingAsStaff();
        $appointment = $this->appointmentIn('cancelled', 'confirmed', ['appointment_date' => $this->today, 'start_time' => '09:00:00', 'end_time' => '09:30:00']);

        $this->undo($appointment)->assertOk();
    }

    #[Test]
    public function undo_is_refused_after_the_appointment_day(): void
    {
        $this->actingAsStaff();
        $appointment = $this->appointmentIn('completed', 'in_consultation', ['appointment_date' => $this->yesterday]);

        $this->undo($appointment)
            ->assertStatus(422)
            ->assertJsonPath('message', 'Can only undo on or before the appointment day.');
        $this->assertSame('completed', $appointment->fresh()->status);
    }

    #[Test]
    public function the_window_uses_the_clinic_day_not_utc(): void
    {
        // 2026-10-02 01:00 IST is still 2026-10-01 in UTC.
        $this->travelTo(Carbon::parse('2026-10-02 01:00:00', 'Asia/Kolkata')->utc());
        $this->actingAsStaff();
        $appointment = $this->appointmentIn('completed', 'in_consultation', ['appointment_date' => '2026-10-01']);

        $this->undo($appointment)->assertStatus(422);
    }

    public static function nonUndoable(): array
    {
        return [['pending'], ['confirmed'], ['checked_in'], ['in_consultation'], ['rescheduled']];
    }

    #[Test]
    #[DataProvider('nonUndoable')]
    public function a_status_that_is_not_undoable_is_rejected(string $status): void
    {
        $this->actingAsStaff();
        $appointment = $this->makeAppointment(['status' => $status]);

        $this->undo($appointment)->assertStatus(422);
        $this->assertSame($status, $appointment->fresh()->status);
    }

    #[Test]
    public function undoing_a_cancel_needs_the_cancel_permission(): void
    {
        Sanctum::actingAs($this->staffWith(['appointments.view', 'appointments.check_in']));
        $appointment = $this->appointmentIn('cancelled', 'confirmed');

        $this->undo($appointment)
            ->assertForbidden()
            ->assertJsonPath('message', "You don't have permission to cancel appointments.");
        $this->assertSame('cancelled', $appointment->fresh()->status);
    }

    public static function checkInStatuses(): array
    {
        return [['no_show'], ['completed']];
    }

    #[Test]
    #[DataProvider('checkInStatuses')]
    public function undoing_a_no_show_or_completion_needs_the_check_in_permission(string $status): void
    {
        $appointment = $this->appointmentIn($status, null);

        Sanctum::actingAs($this->staffWith(['appointments.view', 'appointments.cancel']));
        $this->undo($appointment)->assertForbidden();
        $this->assertSame($status, $appointment->fresh()->status);

        Sanctum::actingAs($this->staffWith(['appointments.view', 'appointments.check_in']));
        $this->undo($appointment)->assertOk();
    }

    #[Test]
    public function the_route_needs_appointments_view(): void
    {
        Sanctum::actingAs($this->staffWith(['appointments.cancel', 'appointments.check_in']));
        $appointment = $this->appointmentIn('cancelled', 'confirmed');

        $this->undo($appointment)->assertForbidden();
    }

    #[Test]
    public function doctor_cannot_undo_another_doctors_appointment(): void
    {
        $doctorUser = $this->staff('doctor');
        $this->doctor->update(['user_id' => $doctorUser->id]);
        $otherDoc = $this->makeDoctor($this->clinic, 'Dr Two');
        $theirs = $this->appointmentIn('completed', 'in_consultation', ['doctor_id' => $otherDoc->id]);
        $mine = $this->appointmentIn('completed', 'in_consultation');
        Sanctum::actingAs($doctorUser);

        $this->undo($theirs)->assertNotFound();
        $this->undo($mine)->assertOk()->assertJsonPath('data.status', 'in_consultation');
    }

    #[Test]
    public function another_clinics_appointment_is_not_found(): void
    {
        $this->actingAsStaff();
        $theirs = $this->appointmentIn('cancelled', 'confirmed', ['clinic_id' => $this->otherClinic->id]);

        $this->undo($theirs)->assertNotFound();
        $this->assertSame('cancelled', $theirs->fresh()->status);
    }

    #[Test]
    public function the_undo_is_logged_with_the_actor_and_marked_as_an_undo(): void
    {
        $user = $this->actingAsStaff();
        $appointment = $this->appointmentIn('cancelled', 'pending');

        $this->undo($appointment)->assertOk();

        $log = AppointmentStatusLog::where('appointment_id', $appointment->id)->orderByDesc('id')->first();
        $this->assertSame('cancelled', $log->old_status);
        $this->assertSame('pending', $log->new_status);
        $this->assertSame($user->id, (int) $log->changed_by_user_id);
        $this->assertSame('staff', $log->source);
        $this->assertStringStartsWith(AppointmentService::UNDO_REASON_PREFIX, $log->reason);
    }

    #[Test]
    public function a_completion_undo_leaves_the_lifecycle_able_to_complete_again(): void
    {
        $this->actingAsStaff();
        $appointment = $this->appointmentIn('completed', 'in_consultation', ['appointment_date' => $this->today, 'start_time' => '09:00:00', 'end_time' => '09:30:00']);

        $this->undo($appointment)->assertOk();
        $this->postJson("/api/clinic/appointments/{$appointment->id}/lifecycle", ['status' => 'completed'])
            ->assertOk()
            ->assertJsonPath('data.status', 'completed');
        $this->assertNotNull($appointment->fresh()->completed_at);
    }

    #[Test]
    public function appointments_carry_a_can_undo_status_flag_for_the_ui(): void
    {
        $this->actingAsStaff();
        $open = $this->appointmentIn('cancelled', 'confirmed');
        $past = $this->appointmentIn('completed', 'in_consultation', ['appointment_date' => $this->yesterday]);
        $live = $this->makeAppointment(['start_time' => '11:00:00', 'end_time' => '11:30:00']);

        $this->getJson("/api/clinic/appointments/{$open->id}")->assertOk()->assertJsonPath('data.can_undo_status', true);
        $this->getJson("/api/clinic/appointments/{$open->id}/detail")->assertOk()->assertJsonPath('data.appointment.can_undo_status', true);
        $this->getJson("/api/clinic/appointments/{$past->id}")->assertOk()->assertJsonPath('data.can_undo_status', false);
        $this->getJson("/api/clinic/appointments/{$live->id}")->assertOk()->assertJsonPath('data.can_undo_status', false);
    }

    #[Test]
    public function the_super_admin_route_works(): void
    {
        $admin = $this->superAdmin();
        Sanctum::actingAs($admin);
        $appointment = $this->appointmentIn('cancelled', 'confirmed', ['clinic_id' => $this->otherClinic->id]);

        $this->undo($appointment, 'super-admin')->assertOk()->assertJsonPath('data.status', 'confirmed');

        $this->assertSame(1, $this->bookingConfirmations($appointment));
        $log = AppointmentStatusLog::where('appointment_id', $appointment->id)->orderByDesc('id')->first();
        $this->assertSame($admin->id, (int) $log->changed_by_user_id);
    }

    #[Test]
    public function the_super_admin_route_applies_the_same_rules(): void
    {
        Sanctum::actingAs($this->superAdmin());
        $appointment = $this->appointmentIn('cancelled', 'confirmed', ['appointment_date' => $this->yesterday]);

        $this->undo($appointment, 'super-admin')->assertStatus(422);
    }
}
