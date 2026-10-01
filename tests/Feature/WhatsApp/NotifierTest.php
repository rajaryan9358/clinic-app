<?php

namespace Tests\Feature\WhatsApp;

use App\Jobs\SendWhatsAppTemplate;
use App\Models\Appointment;
use App\Models\AppointmentPrescription;
use App\Models\Clinic;
use App\Models\Doctor;
use App\Models\Patient;
use App\Models\ReminderLog;
use App\Models\WaitlistEntry;
use App\Models\WhatsappMessage;
use App\Services\WhatsApp\FakeWhatsAppGateway;
use App\Services\WhatsApp\PatientNotifier;
use App\Services\WhatsApp\WhatsAppGateway;
use App\Support\PlatformSettings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use RuntimeException;
use Tests\TestCase;

class NotifierTest extends TestCase
{
    use RefreshDatabase;

    private FakeWhatsAppGateway $fake;

    private PatientNotifier $notifier;

    private Clinic $clinic;

    private Doctor $doctor;

    private Patient $patient;

    private Appointment $appointment;

    protected function setUp(): void
    {
        parent::setUp();

        $this->fake = new FakeWhatsAppGateway;
        $this->app->instance(WhatsAppGateway::class, $this->fake);
        $this->notifier = $this->app->make(PatientNotifier::class);

        $this->clinic = Clinic::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Sunrise Clinic',
            'slug' => 'sunrise-clinic',
            'status' => 'active',
        ]);

        $this->doctor = Doctor::create([
            'clinic_id' => $this->clinic->id,
            'full_name' => 'Dr Asha Rao',
        ]);

        $this->patient = Patient::create([
            'clinic_id' => $this->clinic->id,
            'uuid' => (string) Str::uuid(),
            'first_name' => 'Ravi',
            'last_name' => 'Kumar',
            'phone' => '9876543210',
        ]);

        $this->appointment = Appointment::create([
            'clinic_id' => $this->clinic->id,
            'uuid' => (string) Str::uuid(),
            'patient_id' => $this->patient->id,
            'doctor_id' => $this->doctor->id,
            'appointment_date' => '2026-09-29',
            'start_time' => '10:30:00',
            'end_time' => '10:45:00',
            'visit_type' => 'new',
            'booking_channel' => 'walk_in',
            'status' => 'confirmed',
        ]);
    }

    public function test_booking_confirmed_sends_expected_template_and_updates_row(): void
    {
        $row = $this->notifier->bookingConfirmed($this->appointment);

        $this->assertSame($this->clinic->id, $row->clinic_id);
        $this->assertSame($this->patient->id, $row->patient_id);
        $this->assertSame($this->appointment->id, $row->appointment_id);
        $this->assertSame('outgoing', $row->direction);
        $this->assertSame('template', $row->message_type);
        $this->assertSame('booking_confirmed', $row->notification_type);
        $this->assertSame('booking_confirmed', $row->template_name);
        $this->assertSame('919876543210', $row->to_phone);
        $this->assertStringContainsString('Sunrise Clinic', (string) $row->content_text);

        $row->refresh();
        $this->assertSame('sent', $row->delivery_status);
        $this->assertSame('wamid.fake.1', $row->provider_message_id);

        $this->assertCount(1, $this->fake->sent);
        $sent = $this->fake->sent[0];
        $this->assertSame('booking_confirmed', $sent['template']);

        $body = $this->bodyComponent($sent['components']);
        $this->assertSame(
            ['Ravi Kumar', 'Sunrise Clinic', 'Dr Asha Rao', 'Tue, 29 Sep 2026', '10:30 AM'],
            array_map(fn ($p) => $p['text'], $body['parameters']),
        );
    }

    public function test_appointment_updated_cancelled_status_line(): void
    {
        $row = $this->notifier->appointmentUpdated($this->appointment, 'cancelled');
        $body = $this->bodyComponent($this->fake->sent[array_key_last($this->fake->sent)]['components']);
        $params = array_map(fn ($p) => $p['text'], $body['parameters']);

        $this->assertStringContainsString('has been cancelled', $params[2]);
        $row->refresh();
        $this->assertSame('sent', $row->delivery_status);
    }

    public function test_appointment_updated_rescheduled_status_line(): void
    {
        $this->notifier->appointmentUpdated($this->appointment, 'rescheduled');
        $body = $this->bodyComponent($this->fake->sent[array_key_last($this->fake->sent)]['components']);
        $params = array_map(fn ($p) => $p['text'], $body['parameters']);

        $this->assertStringContainsString('has been rescheduled to', $params[2]);
    }

    public function test_prescription_ready_includes_signed_header_link_and_body_params(): void
    {
        $rx = AppointmentPrescription::create([
            'clinic_id' => $this->clinic->id,
            'appointment_id' => $this->appointment->id,
            'data' => ['notes' => 'Take rest'],
            'status' => 'final',
        ]);

        $row = $this->notifier->prescriptionReady($rx);
        $row->refresh();

        $this->assertSame('sent', $row->delivery_status);

        $sent = $this->fake->sent[array_key_last($this->fake->sent)];
        $header = $this->componentOfType($sent['components'], 'header');
        $document = $header['parameters'][0]['document'];

        $this->assertStringContainsString('/api/public/prescriptions/', $document['link']);
        $this->assertStringContainsString('signature=', $document['link']);
        $this->assertSame('prescription-'.$this->appointment->id.'.pdf', $document['filename']);

        $body = $this->bodyComponent($sent['components']);
        $this->assertSame(
            ['Ravi Kumar', 'Sunrise Clinic', 'Dr Asha Rao'],
            array_map(fn ($p) => $p['text'], $body['parameters']),
        );
    }

    public function test_login_otp_includes_body_param_and_url_button(): void
    {
        $this->notifier->loginOtp('+91 98765 43210', '482913');

        $sent = $this->fake->sent[array_key_last($this->fake->sent)];
        $body = $this->bodyComponent($sent['components']);
        $this->assertSame(['482913'], array_map(fn ($p) => $p['text'], $body['parameters']));

        $button = $this->componentOfType($sent['components'], 'button');
        $this->assertSame('url', $button['sub_type']);
        $this->assertSame('0', $button['index']);
        $this->assertSame('482913', $button['parameters'][0]['text']);
    }

    public function test_portal_link_includes_body_params_and_url_button_with_token(): void
    {
        $row = $this->notifier->portalLink($this->patient, 'abc123token');

        $this->assertSame($this->clinic->id, $row->clinic_id);
        $this->assertSame($this->patient->id, $row->patient_id);
        $this->assertNull($row->appointment_id);
        $this->assertSame('portal_link', $row->notification_type);
        $this->assertSame('portal_link', $row->template_name);
        $this->assertStringContainsString('Sunrise Clinic', (string) $row->content_text);
        $this->assertStringContainsString('/portal/login/abc123token', (string) $row->content_text);

        $row->refresh();
        $this->assertSame('sent', $row->delivery_status);

        $sent = $this->fake->sent[array_key_last($this->fake->sent)];
        $this->assertSame('portal_link', $sent['template']);

        $body = $this->bodyComponent($sent['components']);
        $this->assertSame(
            ['Ravi Kumar', 'Sunrise Clinic'],
            array_map(fn ($p) => $p['text'], $body['parameters']),
        );

        $button = $this->componentOfType($sent['components'], 'button');
        $this->assertSame('url', $button['sub_type']);
        $this->assertSame('0', $button['index']);
        $this->assertSame('abc123token', $button['parameters'][0]['text']);
    }

    public function test_waitlist_offer_sends_expected_template_and_url_button(): void
    {
        $entry = WaitlistEntry::create([
            'clinic_id' => $this->clinic->id,
            'patient_id' => $this->patient->id,
            'doctor_id' => $this->doctor->id,
            'appointment_date' => '2026-09-29',
            'start_time' => '10:30:00',
            'end_time' => '10:45:00',
            'status' => 'offered',
            'source' => 'portal',
            'offered_at' => '2026-09-29 09:00:00',
            'hold_expires_at' => '2026-09-29 09:30:00',
        ]);

        $row = $this->notifier->waitlistOffer($entry, 'waitlist-token-123');

        $this->assertSame($this->clinic->id, $row->clinic_id);
        $this->assertSame($this->patient->id, $row->patient_id);
        $this->assertNull($row->appointment_id);
        $this->assertSame('waitlist_slot_open', $row->notification_type);
        $this->assertSame('waitlist_slot_open', $row->template_name);
        $this->assertSame('919876543210', $row->to_phone);

        $row->refresh();
        $this->assertSame('sent', $row->delivery_status);

        $sent = $this->fake->sent[array_key_last($this->fake->sent)];
        $this->assertSame('waitlist_slot_open', $sent['template']);

        $body = $this->bodyComponent($sent['components']);
        $this->assertSame(
            ['Ravi Kumar', 'Sunrise Clinic', 'Dr Asha Rao', 'Tue, 29 Sep 2026', '10:30 AM', '30'],
            array_map(fn ($p) => $p['text'], $body['parameters']),
        );

        $button = $this->componentOfType($sent['components'], 'button');
        $this->assertSame('url', $button['sub_type']);
        $this->assertSame('0', $button['index']);
        $this->assertSame('waitlist-token-123', $button['parameters'][0]['text']);
    }

    public function test_waitlist_offer_for_a_dependent_goes_to_the_holders_phone(): void
    {
        $holder = Patient::create([
            'clinic_id' => $this->clinic->id,
            'uuid' => (string) Str::uuid(),
            'first_name' => 'Asha',
            'last_name' => 'Kumar',
            'phone' => '9123456789',
        ]);

        $dependent = Patient::create([
            'clinic_id' => $this->clinic->id,
            'uuid' => (string) Str::uuid(),
            'first_name' => 'Baby',
            'last_name' => 'Kumar',
            'phone' => '9123456789',
            'managed_by_patient_id' => $holder->id,
        ]);

        $entry = WaitlistEntry::create([
            'clinic_id' => $this->clinic->id,
            'patient_id' => $dependent->id,
            'doctor_id' => $this->doctor->id,
            'appointment_date' => '2026-09-29',
            'start_time' => '10:30:00',
            'end_time' => '10:45:00',
            'status' => 'offered',
            'source' => 'portal',
            'offered_at' => '2026-09-29 09:00:00',
            'hold_expires_at' => '2026-09-29 09:30:00',
        ]);

        $row = $this->notifier->waitlistOffer($entry, 'tok');

        // The row is attributed to the waitlisted (dependent) patient...
        $this->assertSame($dependent->id, $row->patient_id);
        // ...but the WhatsApp itself is sent to the account holder's phone.
        $this->assertSame('919123456789', $row->to_phone);

        $sent = $this->fake->sent[array_key_last($this->fake->sent)];
        $body = $this->bodyComponent($sent['components']);
        $this->assertSame('Baby Kumar', $body['parameters'][0]['text']);
    }

    /**
     * Meta rejects template text parameters containing newlines/tabs or
     * runs of more than 4 consecutive spaces. buildComponents() must
     * collapse any run of whitespace to a single space and trim the ends
     * before handing text params to the gateway.
     */
    public function test_body_params_with_irregular_whitespace_are_sanitised(): void
    {
        // Bypass the Patient model's full_name recompute-on-save so the
        // messy value survives untouched until the notifier reads it.
        Patient::where('id', $this->patient->id)->update(['full_name' => "Ravi\n  Kumar\t "]);
        $this->appointment->unsetRelation('patient');

        $this->notifier->bookingConfirmed($this->appointment);

        $sent = $this->fake->sent[array_key_last($this->fake->sent)];
        $body = $this->bodyComponent($sent['components']);
        $params = array_map(fn ($p) => $p['text'], $body['parameters']);

        $this->assertSame('Ravi Kumar', $params[0]);
    }

    /**
     * A missing/blank doctor name must not reach Meta as an empty text
     * parameter (Meta rejects empty params) — it falls back to '-'.
     */
    public function test_blank_doctor_name_falls_back_to_dash(): void
    {
        Doctor::where('id', $this->doctor->id)->update(['full_name' => '   ']);
        $this->appointment->unsetRelation('doctor');

        $this->notifier->bookingConfirmed($this->appointment);

        $sent = $this->fake->sent[array_key_last($this->fake->sent)];
        $body = $this->bodyComponent($sent['components']);
        $params = array_map(fn ($p) => $p['text'], $body['parameters']);

        $this->assertSame('-', $params[2]);
    }

    /**
     * The document header's signed link and the OTP body/button code are
     * not "names/status lines" and must pass through unaltered.
     */
    public function test_header_link_and_otp_code_are_not_sanitised(): void
    {
        $rx = AppointmentPrescription::create([
            'clinic_id' => $this->clinic->id,
            'appointment_id' => $this->appointment->id,
            'data' => ['notes' => 'Take rest'],
            'status' => 'final',
        ]);

        $this->notifier->prescriptionReady($rx);
        $sent = $this->fake->sent[array_key_last($this->fake->sent)];
        $header = $this->componentOfType($sent['components'], 'header');
        $this->assertStringContainsString('signature=', $header['parameters'][0]['document']['link']);

        // Irregular whitespace would be collapsed by the body-param
        // sanitiser; the OTP path opts out, so it must survive untouched.
        $this->notifier->loginOtp('9876543210', "482913\t");
        $sent = $this->fake->sent[array_key_last($this->fake->sent)];
        $body = $this->bodyComponent($sent['components']);
        $this->assertSame("482913\t", $body['parameters'][0]['text']);
    }

    public function test_disabled_template_skips_without_sending(): void
    {
        PlatformSettings::set('whatsapp_templates', [
            'booking_confirmed' => ['name' => 'booking_confirmed', 'language' => 'en', 'enabled' => false],
        ]);

        $row = $this->notifier->bookingConfirmed($this->appointment);

        $this->assertSame('skipped', $row->delivery_status);
        $this->assertSame('template disabled', $row->error_message);
        $this->assertCount(0, $this->fake->sent);
    }

    public function test_missing_phone_number_skips_without_sending(): void
    {
        // patients.phone is NOT NULL; an empty string is the "no phone on file" case
        // and PhoneNumber::normalise() treats it the same as null.
        $this->patient->phone = '';
        $this->patient->save();
        $this->appointment->unsetRelation('patient');

        $row = $this->notifier->bookingConfirmed($this->appointment);

        $this->assertSame('skipped', $row->delivery_status);
        $this->assertSame('no phone number', $row->error_message);
        $this->assertCount(0, $this->fake->sent);
    }

    public function test_too_short_phone_number_skips_without_sending(): void
    {
        $this->patient->phone = '123';
        $this->patient->save();
        $this->appointment->unsetRelation('patient');

        $row = $this->notifier->bookingConfirmed($this->appointment);

        $this->assertSame('skipped', $row->delivery_status);
        $this->assertSame('no phone number', $row->error_message);
        $this->assertCount(0, $this->fake->sent);
    }

    public function test_unconfigured_gateway_is_decided_by_the_job_not_the_notifier(): void
    {
        $this->fake->configured = false;

        $row = $this->notifier->bookingConfirmed($this->appointment);
        $row->refresh();

        $this->assertSame('skipped', $row->delivery_status);
        $this->assertSame('WhatsApp not configured', $row->error_message);
        $this->assertCount(0, $this->fake->sent);
    }

    public function test_job_handle_rethrows_and_failed_marks_row_and_reminder_log(): void
    {
        $reminderLog = ReminderLog::create([
            'clinic_id' => $this->clinic->id,
            'appointment_id' => $this->appointment->id,
            'patient_id' => $this->patient->id,
            'channel' => 'whatsapp',
            'reminder_type' => '24h_before',
            'scheduled_for' => now(),
            'delivery_status' => 'pending',
        ]);

        $row = WhatsappMessage::create([
            'clinic_id' => $this->clinic->id,
            'patient_id' => $this->patient->id,
            'appointment_id' => $this->appointment->id,
            'direction' => 'outgoing',
            'message_type' => 'template',
            'notification_type' => 'appointment_reminder',
            'template_name' => 'appointment_reminder',
            'to_phone' => '919876543210',
            'content_text' => 'Reminder',
            'delivery_status' => 'queued',
            'payload_json' => [
                'template' => 'appointment_reminder',
                'language' => 'en',
                'components' => [],
                'reminder_log_id' => $reminderLog->id,
            ],
        ]);

        $job = new SendWhatsAppTemplate($row->id);
        $this->fake->throw = new RuntimeException('boom');

        $thrown = null;
        try {
            $job->handle($this->fake);
        } catch (\Throwable $e) {
            $thrown = $e;
        }

        $this->assertInstanceOf(RuntimeException::class, $thrown);
        $this->assertSame('boom', $thrown->getMessage());

        $row->refresh();
        $this->assertSame('queued', $row->delivery_status, 'handle() must not itself mark the row failed; that is failed()\'s job.');

        $job->failed(new RuntimeException('boom'));

        $row->refresh();
        $this->assertSame('failed', $row->delivery_status);
        $this->assertSame('boom', $row->error_message);

        $reminderLog->refresh();
        $this->assertSame('failed', $reminderLog->delivery_status);
        $this->assertSame('boom', $reminderLog->failure_reason);
    }

    public function test_signed_prescription_pdf_url_is_valid_then_expires(): void
    {
        $rx = AppointmentPrescription::create([
            'clinic_id' => $this->clinic->id,
            'appointment_id' => $this->appointment->id,
            'data' => ['notes' => 'Take rest'],
            'status' => 'final',
        ]);

        $this->notifier->prescriptionReady($rx);
        $sent = $this->fake->sent[array_key_last($this->fake->sent)];
        $header = $this->componentOfType($sent['components'], 'header');
        $url = $header['parameters'][0]['document']['link'];

        $this->get($url)->assertOk()->assertHeader('Content-Type', 'application/pdf');

        $path = (string) parse_url($url, PHP_URL_PATH);
        $this->get($path)->assertForbidden();

        $this->travel(8)->days();
        $this->get($url)->assertForbidden();
    }

    /** @param array<int, array<string, mixed>> $components */
    private function bodyComponent(array $components): array
    {
        return $this->componentOfType($components, 'body');
    }

    /** @param array<int, array<string, mixed>> $components */
    private function componentOfType(array $components, string $type): array
    {
        foreach ($components as $component) {
            if ($component['type'] === $type) {
                return $component;
            }
        }

        $this->fail("No component of type [{$type}] found.");
    }
}
