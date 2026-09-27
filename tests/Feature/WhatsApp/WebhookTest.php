<?php

namespace Tests\Feature\WhatsApp;

use App\Models\Appointment;
use App\Models\Clinic;
use App\Models\Doctor;
use App\Models\Patient;
use App\Models\ReminderLog;
use App\Models\WhatsappMessage;
use App\Services\WhatsApp\FakeWhatsAppGateway;
use App\Services\WhatsApp\MetaWhatsAppGateway;
use App\Services\WhatsApp\WhatsAppGateway;
use App\Support\PlatformSettings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * GET /api/webhooks/whatsapp — Meta's subscription handshake.
 * POST /api/webhooks/whatsapp — delivery-status updates, signature-verified
 * via the bound WhatsAppGateway, mirrored onto whatsapp_messages and (when
 * linked) reminder_logs. See docs/superpowers/specs/2026-09-27-whatsapp-notifications-design.md §4.
 */
class WebhookTest extends TestCase
{
    use RefreshDatabase;

    private FakeWhatsAppGateway $fake;

    private Clinic $clinic;

    private Appointment $appointment;

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

        $doctor = Doctor::create([
            'clinic_id' => $this->clinic->id,
            'full_name' => 'Dr Asha Rao',
        ]);

        $patient = Patient::create([
            'clinic_id' => $this->clinic->id,
            'uuid' => (string) Str::uuid(),
            'first_name' => 'Ravi',
            'last_name' => 'Kumar',
            'phone' => '9876543210',
        ]);

        $this->appointment = Appointment::create([
            'clinic_id' => $this->clinic->id,
            'uuid' => (string) Str::uuid(),
            'patient_id' => $patient->id,
            'doctor_id' => $doctor->id,
            'appointment_date' => '2026-09-29',
            'start_time' => '10:30:00',
            'end_time' => '10:45:00',
            'visit_type' => 'new',
            'booking_channel' => 'walk_in',
            'status' => 'confirmed',
        ]);
    }

    private function statusPayload(array $status): array
    {
        return [
            'entry' => [
                ['changes' => [
                    ['value' => ['statuses' => [$status]]],
                ]],
            ],
        ];
    }

    private function postWebhook(array $payload): TestResponse
    {
        $body = json_encode($payload);

        return $this->call('POST', '/api/webhooks/whatsapp', [], [], [], [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_X_HUB_SIGNATURE_256' => 'sha256=irrelevant',
        ], $body);
    }

    private function makeMessage(array $overrides = []): WhatsappMessage
    {
        return WhatsappMessage::create(array_merge([
            'clinic_id' => $this->clinic->id,
            'patient_id' => $this->appointment->patient_id,
            'appointment_id' => $this->appointment->id,
            'direction' => 'outgoing',
            'message_type' => 'template',
            'template_name' => 'appointment_reminder',
            'notification_type' => 'appointment_reminder',
            'provider_message_id' => 'wamid.1',
            'to_phone' => '919876543210',
            'delivery_status' => 'sent',
        ], $overrides));
    }

    // --- Handshake ---------------------------------------------------

    public function test_handshake_returns_challenge_when_token_matches(): void
    {
        PlatformSettings::set('whatsapp_webhook_verify_token', 'verify-me');

        $res = $this->get('/api/webhooks/whatsapp?hub_mode=subscribe&hub_verify_token=verify-me&hub_challenge=123');

        $res->assertOk();
        $this->assertSame('123', $res->getContent());
        $this->assertStringContainsString('text/plain', $res->headers->get('Content-Type'));
    }

    public function test_handshake_rejects_wrong_token(): void
    {
        PlatformSettings::set('whatsapp_webhook_verify_token', 'verify-me');

        $res = $this->get('/api/webhooks/whatsapp?hub_mode=subscribe&hub_verify_token=wrong&hub_challenge=123');

        $res->assertStatus(403);
    }

    public function test_handshake_rejects_when_no_token_configured(): void
    {
        $res = $this->get('/api/webhooks/whatsapp?hub_mode=subscribe&hub_verify_token=anything&hub_challenge=123');

        $res->assertStatus(403);
    }

    // --- Signature verification ---------------------------------------

    public function test_post_with_invalid_signature_is_401(): void
    {
        $this->fake->signatureValid = false;

        $res = $this->postWebhook($this->statusPayload(['id' => 'wamid.1', 'status' => 'delivered']));

        $res->assertStatus(401);
    }

    public function test_post_with_no_app_secret_and_real_gateway_is_401(): void
    {
        // bind() drops the fake instance registered in setUp() and rebinds the
        // interface to the real gateway, which rejects when no app secret is set.
        $this->app->bind(WhatsAppGateway::class, MetaWhatsAppGateway::class);

        $res = $this->postWebhook($this->statusPayload(['id' => 'wamid.1', 'status' => 'delivered']));

        $res->assertStatus(401);
    }

    // --- Status progression ---------------------------------------------

    public function test_status_moves_forward_only(): void
    {
        $message = $this->makeMessage();

        $this->postWebhook($this->statusPayload(['id' => 'wamid.1', 'status' => 'delivered']))->assertOk();
        $this->assertSame('delivered', $message->refresh()->delivery_status);

        $this->postWebhook($this->statusPayload(['id' => 'wamid.1', 'status' => 'read']))->assertOk();
        $this->assertSame('read', $message->refresh()->delivery_status);

        $this->postWebhook($this->statusPayload(['id' => 'wamid.1', 'status' => 'delivered']))->assertOk();
        $this->assertSame('read', $message->refresh()->delivery_status);
    }

    public function test_failed_on_sent_row_records_error_message(): void
    {
        $message = $this->makeMessage();

        $res = $this->postWebhook($this->statusPayload([
            'id' => 'wamid.1',
            'status' => 'failed',
            'errors' => [['title' => 'Recipient opted out']],
        ]));

        $res->assertOk();
        $message->refresh();
        $this->assertSame('failed', $message->delivery_status);
        $this->assertSame('Recipient opted out', $message->error_message);
    }

    public function test_failed_after_read_stays_read(): void
    {
        $message = $this->makeMessage(['delivery_status' => 'read']);

        $this->postWebhook($this->statusPayload([
            'id' => 'wamid.1',
            'status' => 'failed',
            'errors' => [['title' => 'Recipient opted out']],
        ]))->assertOk();

        $this->assertSame('read', $message->refresh()->delivery_status);
    }

    public function test_linked_reminder_log_mirrors_each_status_change(): void
    {
        $log = ReminderLog::create([
            'clinic_id' => $this->clinic->id,
            'appointment_id' => $this->appointment->id,
            'patient_id' => $this->appointment->patient_id,
            'channel' => 'whatsapp',
            'reminder_type' => 'appointment_reminder',
            'delivery_status' => 'sent',
            'provider_message_id' => 'wamid.1',
        ]);

        $message = $this->makeMessage(['payload_json' => ['reminder_log_id' => $log->id]]);

        $this->postWebhook($this->statusPayload(['id' => 'wamid.1', 'status' => 'delivered']))->assertOk();
        $this->assertSame('delivered', $log->refresh()->delivery_status);
        $this->assertSame('delivered', $message->refresh()->delivery_status);

        $this->postWebhook($this->statusPayload(['id' => 'wamid.1', 'status' => 'read']))->assertOk();
        $this->assertSame('read', $log->refresh()->delivery_status);
    }

    public function test_failed_row_is_terminal_and_does_not_revert_on_delivered(): void
    {
        $log = ReminderLog::create([
            'clinic_id' => $this->clinic->id,
            'appointment_id' => $this->appointment->id,
            'patient_id' => $this->appointment->patient_id,
            'channel' => 'whatsapp',
            'reminder_type' => 'appointment_reminder',
            'delivery_status' => 'failed',
            'provider_message_id' => 'wamid.1',
            'failure_reason' => 'Recipient opted out',
        ]);

        $message = $this->makeMessage([
            'delivery_status' => 'failed',
            'error_message' => 'Recipient opted out',
            'payload_json' => ['reminder_log_id' => $log->id],
        ]);

        $this->postWebhook($this->statusPayload(['id' => 'wamid.1', 'status' => 'delivered']))->assertOk();

        $this->assertSame('failed', $message->refresh()->delivery_status);
        $this->assertSame('Recipient opted out', $message->error_message);
        $this->assertSame('failed', $log->refresh()->delivery_status);
    }

    public function test_malformed_statuses_payloads_are_ignored_with_200(): void
    {
        $message = $this->makeMessage();

        $malformedPayloads = [
            ['entry' => [['changes' => [['value' => ['statuses' => 'bad']]]]]],
            ['entry' => [['changes' => [['value' => ['statuses' => ['bad']]]]]]],
            ['entry' => [['changes' => [['value' => 'bad']]]]],
            ['entry' => [['changes' => 'bad']]],
            ['entry' => 'bad'],
            ['entry' => [['changes' => [['value' => ['statuses' => [['id' => 'wamid.1']]]]]]]],
            ['entry' => [['changes' => [['value' => ['statuses' => [['status' => 'delivered']]]]]]]],
        ];

        foreach ($malformedPayloads as $payload) {
            $this->postWebhook($payload)->assertOk();
        }

        $this->assertSame('sent', $message->refresh()->delivery_status);
    }

    public function test_unknown_provider_id_is_ignored_with_200(): void
    {
        $this->makeMessage();

        $res = $this->postWebhook($this->statusPayload(['id' => 'wamid.does-not-exist', 'status' => 'delivered']));

        $res->assertOk();
        $this->assertSame('sent', WhatsappMessage::where('provider_message_id', 'wamid.1')->first()->delivery_status);
    }

    public function test_inbound_messages_payload_is_ignored_with_200(): void
    {
        $this->makeMessage();

        $res = $this->postWebhook([
            'entry' => [
                ['changes' => [
                    ['value' => ['messages' => [['id' => 'wamid.in.1', 'from' => '919876543210', 'type' => 'text']]]],
                ]],
            ],
        ]);

        $res->assertOk();
        $this->assertSame('sent', WhatsappMessage::where('provider_message_id', 'wamid.1')->first()->delivery_status);
    }
}
