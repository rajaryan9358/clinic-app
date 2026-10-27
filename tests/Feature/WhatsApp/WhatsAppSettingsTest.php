<?php

namespace Tests\Feature\WhatsApp;

use App\Models\User;
use App\Services\WhatsApp\FakeWhatsAppGateway;
use App\Services\WhatsApp\WhatsAppGateway;
use App\Support\PlatformSettings;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class WhatsAppSettingsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
    }

    private function superAdmin(): User
    {
        $user = User::create([
            'uuid' => (string) Str::uuid(),
            'full_name' => 'Super Admin',
            'email' => Str::random(8).'@x.test',
            'password' => 'x',
            'role' => 'super_admin',
            'status' => 'active',
        ]);
        $user->assignRole('super_admin');

        return $user;
    }

    private function basePayload(): array
    {
        return [
            'whatsapp_phone_number_id' => '1234567890',
            'whatsapp_waba_id' => '9876543210',
            'whatsapp_graph_version' => 'v21.0',
            'whatsapp_access_token' => 'secret-token',
            'whatsapp_app_secret' => 'secret-app-secret',
            'whatsapp_webhook_verify_token' => 'secret-verify-token',
            'whatsapp_templates' => [
                'booking_confirmed' => ['name' => 'appt_confirm_v2', 'language' => 'en_US', 'enabled' => false],
            ],
        ];
    }

    public function test_super_admin_saves_and_fetches_whatsapp_settings_without_leaking_secrets(): void
    {
        Sanctum::actingAs($this->superAdmin());

        $this->postJson('/api/super-admin/settings/system', $this->basePayload())->assertOk();

        $res = $this->getJson('/api/super-admin/settings/system')->assertOk();

        $res->assertJsonPath('data.whatsapp_phone_number_id', '1234567890');
        $res->assertJsonPath('data.whatsapp_waba_id', '9876543210');
        $res->assertJsonPath('data.whatsapp_graph_version', 'v21.0');
        $res->assertJsonPath('data.whatsapp_access_token_set', true);
        $res->assertJsonPath('data.whatsapp_app_secret_set', true);
        $res->assertJsonPath('data.whatsapp_webhook_verify_token_set', true);
        $this->assertStringEndsWith('/api/webhooks/whatsapp', $res->json('data.whatsapp_webhook_url'));

        $templates = $res->json('data.whatsapp_templates');
        $this->assertSame('appt_confirm_v2', $templates['booking_confirmed']['name']);
        $this->assertSame('en_US', $templates['booking_confirmed']['language']);
        $this->assertFalse($templates['booking_confirmed']['enabled']);
        foreach (['booking_confirmed', 'appointment_reminder', 'appointment_updated', 'prescription_ready', 'login_otp', 'portal_link', 'waitlist_slot_open', 'waitlist_slot_taken'] as $type) {
            $this->assertArrayHasKey($type, $templates);
        }

        $body = $res->getContent();
        $this->assertStringNotContainsString('secret-token', $body);
        $this->assertStringNotContainsString('secret-app-secret', $body);
        $this->assertStringNotContainsString('secret-verify-token', $body);
    }

    public function test_blank_secret_on_later_post_keeps_the_stored_value(): void
    {
        Sanctum::actingAs($this->superAdmin());

        $this->postJson('/api/super-admin/settings/system', $this->basePayload())->assertOk();

        $this->postJson('/api/super-admin/settings/system', [
            'whatsapp_phone_number_id' => '1234567890',
            'whatsapp_access_token' => '',
            'whatsapp_app_secret' => '',
            'whatsapp_webhook_verify_token' => '',
        ])->assertOk();

        $res = $this->getJson('/api/super-admin/settings/system')->assertOk();
        $res->assertJsonPath('data.whatsapp_access_token_set', true);
        $res->assertJsonPath('data.whatsapp_app_secret_set', true);
        $res->assertJsonPath('data.whatsapp_webhook_verify_token_set', true);
    }

    public function test_blanking_phone_number_id_and_waba_id_clears_them_and_disables_the_gateway(): void
    {
        Sanctum::actingAs($this->superAdmin());

        $this->postJson('/api/super-admin/settings/system', $this->basePayload())->assertOk();

        $this->postJson('/api/super-admin/settings/system', [
            'whatsapp_phone_number_id' => '',
            'whatsapp_waba_id' => '',
        ])->assertOk();

        $res = $this->getJson('/api/super-admin/settings/system')->assertOk();
        $res->assertJsonPath('data.whatsapp_phone_number_id', '');
        $res->assertJsonPath('data.whatsapp_waba_id', '');

        // Secrets are untouched by this request (still "leave blank to keep").
        $res->assertJsonPath('data.whatsapp_access_token_set', true);

        $this->assertFalse((new \App\Services\WhatsApp\MetaWhatsAppGateway())->isConfigured());
    }

    public function test_unknown_template_type_returns_422(): void
    {
        Sanctum::actingAs($this->superAdmin());

        $this->postJson('/api/super-admin/settings/system', [
            'whatsapp_templates' => [
                'not_a_real_type' => ['name' => 'foo', 'language' => 'en', 'enabled' => true],
            ],
        ])->assertStatus(422);
    }

    public function test_invalid_template_type_alongside_a_valid_token_persists_nothing(): void
    {
        Sanctum::actingAs($this->superAdmin());

        $this->postJson('/api/super-admin/settings/system', [
            'whatsapp_access_token' => 'should-not-be-saved',
            'whatsapp_templates' => [
                'not_a_real_type' => ['name' => 'foo', 'language' => 'en', 'enabled' => true],
            ],
        ])->assertStatus(422);

        $this->assertNull(PlatformSettings::get('whatsapp_access_token'));
    }

    public function test_test_connection_endpoint_reports_ok_when_fake_gateway_is_configured(): void
    {
        $fake = new FakeWhatsAppGateway();
        $fake->configured = true;
        $this->app->instance(WhatsAppGateway::class, $fake);

        Sanctum::actingAs($this->superAdmin());

        $this->postJson('/api/super-admin/settings/whatsapp/test')
            ->assertOk()
            ->assertJsonPath('data.ok', true);
    }

    public function test_test_connection_endpoint_reports_not_configured(): void
    {
        $fake = new FakeWhatsAppGateway();
        $fake->configured = false;
        $this->app->instance(WhatsAppGateway::class, $fake);

        Sanctum::actingAs($this->superAdmin());

        $this->postJson('/api/super-admin/settings/whatsapp/test')
            ->assertOk()
            ->assertJsonPath('data.ok', false)
            ->assertJsonPath('data.message', 'WhatsApp is not configured.');
    }

    public function test_removed_whatsapp_account_and_template_routes_are_gone(): void
    {
        Sanctum::actingAs($this->superAdmin());

        $this->getJson('/api/clinic/whatsapp/accounts')->assertStatus(404);
        $this->getJson('/api/super-admin/whatsapp/templates')->assertStatus(404);
    }
}
