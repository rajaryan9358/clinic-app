<?php

namespace Tests\Feature\Billing;

use App\Models\User;
use App\Support\PlatformSettings;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class PaymentSettingsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolesAndPermissionsSeeder::class);
        $u = User::create(['uuid' => (string) Str::uuid(), 'full_name' => 'SA', 'email' => 'sa@x.test', 'password' => 'x', 'role' => 'super_admin', 'status' => 'active']);
        $u->assignRole('super_admin');
        Sanctum::actingAs($u);
    }

    public function test_saves_keys_and_never_returns_secrets(): void
    {
        $this->postJson('/api/super-admin/settings/system', [
            'razorpay_key_id' => 'rzp_test_abc', 'razorpay_key_secret' => 'sek', 'razorpay_webhook_secret' => 'wh',
            'razorpay_mode' => 'test', 'subscription_grace_days' => 5, 'trial_days' => 10,
        ])->assertOk();

        $res = $this->getJson('/api/super-admin/settings/system')->assertOk();
        $res->assertJsonPath('data.razorpay_key_id', 'rzp_test_abc')
            ->assertJsonPath('data.razorpay_key_secret_set', true)
            ->assertJsonPath('data.razorpay_webhook_secret_set', true)
            ->assertJsonPath('data.subscription_grace_days', 5)
            ->assertJsonPath('data.trial_days', 10);
        $this->assertStringNotContainsString('sek', $res->getContent());
        $this->assertStringEndsWith('/api/webhooks/razorpay', $res->json('data.webhook_url'));
    }

    public function test_blank_secret_keeps_existing(): void
    {
        PlatformSettings::set('razorpay_key_secret', 'keep-me');
        $this->postJson('/api/super-admin/settings/system', ['razorpay_key_secret' => ''])->assertOk();
        $this->assertSame('keep-me', PlatformSettings::get('razorpay_key_secret'));
    }

    public function test_rejects_bad_mode_and_grace(): void
    {
        $this->postJson('/api/super-admin/settings/system', ['razorpay_mode' => 'prod'])->assertStatus(422);
        $this->postJson('/api/super-admin/settings/system', ['subscription_grace_days' => 90])->assertStatus(422);
    }
}
