<?php

namespace Tests\Feature\WhatsApp;

use App\Models\Appointment;
use App\Models\Clinic;
use App\Models\ClinicSetting;
use App\Models\Doctor;
use App\Models\Patient;
use App\Models\ReminderLog;
use App\Services\WhatsApp\FakeWhatsAppGateway;
use App\Services\WhatsApp\WhatsAppGateway;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * `whatsapp:send-reminders` (app/Console/Commands/SendWhatsAppReminders.php):
 * sends one WhatsApp reminder per upcoming appointment, `reminder_hours_before`
 * hours ahead of its start, is idempotent (a reminder_logs row marks an
 * appointment as already handled, whether the send succeeded or was
 * skipped), and reads appointment_date/start_time as clinic wall-clock
 * (Asia/Kolkata) rather than naive UTC.
 */
class ReminderTest extends TestCase
{
    use RefreshDatabase;

    private FakeWhatsAppGateway $fake;

    private Clinic $clinic;

    private Doctor $doctor;

    protected function setUp(): void
    {
        parent::setUp();

        $this->fake = new FakeWhatsAppGateway;
        $this->app->instance(WhatsAppGateway::class, $this->fake);

        $this->clinic = Clinic::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Sunrise Clinic',
            'slug' => 'sunrise-clinic-'.Str::random(6),
            'status' => 'active',
        ]);

        $this->doctor = Doctor::create([
            'clinic_id' => $this->clinic->id,
            'full_name' => 'Dr Asha Rao',
        ]);
    }

    private function patient(string $name, string $phone = '9876543210'): Patient
    {
        return Patient::create([
            'clinic_id' => $this->clinic->id,
            'uuid' => (string) Str::uuid(),
            'first_name' => $name,
            'full_name' => $name,
            'phone' => $phone,
        ]);
    }

    private function appointment(Patient $patient, string $date, string $startTime, string $status = 'confirmed'): Appointment
    {
        return Appointment::create([
            'clinic_id' => $this->clinic->id,
            'uuid' => (string) Str::uuid(),
            'patient_id' => $patient->id,
            'doctor_id' => $this->doctor->id,
            'appointment_date' => $date,
            'start_time' => $startTime,
            'visit_type' => 'new',
            'booking_channel' => 'walk_in',
            'status' => $status,
        ]);
    }

    public function test_reminder_is_sent_once_and_skips_cancelled(): void
    {
        ClinicSetting::create(['clinic_id' => $this->clinic->id, 'reminder_hours_before' => 24]);

        $this->travelTo(Carbon::parse('2026-09-28 10:00', 'Asia/Kolkata'));

        $patient = $this->patient('Ravi Kumar');
        $noPhonePatient = $this->patient('No Phone Patient', '');

        // A: due (23h away).
        $a = $this->appointment($patient, '2026-09-29', '09:00:00');
        // B: not yet due (26h away).
        $b = $this->appointment($patient, '2026-09-29', '12:00:00');
        // C: due timing, but cancelled -> excluded by status filter.
        $c = $this->appointment($patient, '2026-09-28', '18:00:00', 'cancelled');
        // D: past -> skip.
        $d = $this->appointment($patient, '2026-09-28', '09:00:00');
        // E: due, but patient has no phone -> notifier skips, log mirrors 'skipped'.
        $e = $this->appointment($noPhonePatient, '2026-09-29', '09:00:00');

        $this->artisan('whatsapp:send-reminders')->assertSuccessful();

        $this->assertCount(1, $this->fake->sent);

        $logA = ReminderLog::where('appointment_id', $a->id)->first();
        $this->assertNotNull($logA);
        $this->assertSame('whatsapp', $logA->channel);
        $this->assertSame('appointment_reminder', $logA->reminder_type);
        $this->assertSame('sent', $logA->delivery_status);
        $this->assertNotNull($logA->provider_message_id);

        $logE = ReminderLog::where('appointment_id', $e->id)->first();
        $this->assertNotNull($logE);
        $this->assertSame('skipped', $logE->delivery_status);
        $this->assertSame('no phone number', $logE->failure_reason);

        $this->assertNull(ReminderLog::where('appointment_id', $b->id)->first());
        $this->assertNull(ReminderLog::where('appointment_id', $c->id)->first());
        $this->assertNull(ReminderLog::where('appointment_id', $d->id)->first());

        $this->assertSame(2, ReminderLog::count());

        // Run again: A and E are already logged, B still isn't due -> nothing new.
        $this->artisan('whatsapp:send-reminders')->assertSuccessful();

        $this->assertCount(1, $this->fake->sent);
        $this->assertSame(2, ReminderLog::count());

        // Travel forward 3h: B (2026-09-29 12:00 IST) is now 23h away -> due.
        $this->travelTo(Carbon::parse('2026-09-28 13:00', 'Asia/Kolkata'));

        $this->artisan('whatsapp:send-reminders')->assertSuccessful();

        $this->assertCount(2, $this->fake->sent);
        $this->assertSame(3, ReminderLog::count());

        $logB = ReminderLog::where('appointment_id', $b->id)->first();
        $this->assertNotNull($logB);
        $this->assertSame('sent', $logB->delivery_status);

        // Running again still sends nothing new.
        $this->artisan('whatsapp:send-reminders')->assertSuccessful();
        $this->assertCount(2, $this->fake->sent);
        $this->assertSame(3, ReminderLog::count());
    }

    public function test_reminder_hours_before_zero_disables_reminders(): void
    {
        ClinicSetting::create(['clinic_id' => $this->clinic->id, 'reminder_hours_before' => 0]);

        $this->travelTo(Carbon::parse('2026-09-28 10:00', 'Asia/Kolkata'));

        $patient = $this->patient('Ravi Kumar');
        $this->appointment($patient, '2026-09-29', '09:00:00');

        $this->artisan('whatsapp:send-reminders')->assertSuccessful();

        $this->assertCount(0, $this->fake->sent);
        $this->assertSame(0, ReminderLog::count());
    }

    public function test_clinic_without_settings_row_defaults_to_24_hours(): void
    {
        // No ClinicSetting row at all for $this->clinic.
        $this->travelTo(Carbon::parse('2026-09-28 10:00', 'Asia/Kolkata'));

        $patient = $this->patient('Ravi Kumar');
        $appointment = $this->appointment($patient, '2026-09-29', '09:00:00');

        $this->artisan('whatsapp:send-reminders')->assertSuccessful();

        $this->assertCount(1, $this->fake->sent);
        $this->assertSame('sent', ReminderLog::where('appointment_id', $appointment->id)->first()?->delivery_status);
    }

    /**
     * appointment_date/start_time are clinic wall-clock (Asia/Kolkata) values
     * with no timezone column, while app.timezone (and thus now()) is UTC.
     * "Now" = 2026-09-28 10:00 IST = 2026-09-28 04:30 UTC; the appointment's
     * wall-clock start of 2026-09-29 05:30 IST is 2026-09-29 00:00 UTC, only
     * 19.5h away (due within the 24h window). A naive reading that parsed
     * "2026-09-29 05:30:00" as if it were already UTC would land on
     * 2026-09-29 05:30 UTC — 25h away — and wrongly call it not-yet-due.
     * This test only passes if the command converts via Asia/Kolkata before
     * comparing against now().
     */
    public function test_timezone_conversion_determines_due_status(): void
    {
        ClinicSetting::create(['clinic_id' => $this->clinic->id, 'reminder_hours_before' => 24]);

        $this->travelTo(Carbon::parse('2026-09-28 10:00', 'Asia/Kolkata'));

        $patient = $this->patient('Ravi Kumar');
        $appointment = $this->appointment($patient, '2026-09-29', '05:30:00');

        $this->artisan('whatsapp:send-reminders')->assertSuccessful();

        $this->assertCount(1, $this->fake->sent);

        $log = ReminderLog::where('appointment_id', $appointment->id)->first();
        $this->assertNotNull($log);
        $this->assertSame('sent', $log->delivery_status);
    }

    /**
     * The notifier's own skip paths (no phone / template disabled) never
     * dispatch SendWhatsAppTemplate, so the command itself mirrors those.
     * But when the phone/template checks pass and the row is queued, the
     * job still runs (synchronously, given QUEUE_CONNECTION=sync in tests)
     * and can itself decide to skip because the gateway isn't configured
     * (App\Jobs\SendWhatsAppTemplate::handle) — this exercises that the
     * job's not-configured branch mirrors 'skipped' onto the same log.
     */
    public function test_gateway_not_configured_marks_log_skipped(): void
    {
        $this->fake->configured = false;

        ClinicSetting::create(['clinic_id' => $this->clinic->id, 'reminder_hours_before' => 24]);

        $this->travelTo(Carbon::parse('2026-09-28 10:00', 'Asia/Kolkata'));

        $patient = $this->patient('Ravi Kumar');
        $appointment = $this->appointment($patient, '2026-09-29', '09:00:00');

        $this->artisan('whatsapp:send-reminders')->assertSuccessful();

        $this->assertCount(0, $this->fake->sent);

        $log = ReminderLog::where('appointment_id', $appointment->id)->first();
        $this->assertNotNull($log);
        $this->assertSame('skipped', $log->delivery_status);
        $this->assertSame('WhatsApp not configured', $log->failure_reason);

        // Idempotent: a second run does not re-attempt it.
        $this->artisan('whatsapp:send-reminders')->assertSuccessful();
        $this->assertSame(1, ReminderLog::count());
    }
}
