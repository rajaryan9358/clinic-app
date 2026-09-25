<?php

namespace Tests\Feature\Billing;

use App\Models\SystemSetting;
use App\Support\PlatformSettings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PlatformSettingsTest extends TestCase
{
    use RefreshDatabase;

    public function test_round_trips_scalar_values_and_defaults(): void
    {
        $this->assertSame(3, PlatformSettings::get('subscription_grace_days', 3));
        PlatformSettings::set('subscription_grace_days', 5);
        PlatformSettings::set('razorpay_key_id', 'rzp_test_abc');
        $this->assertSame(5, PlatformSettings::get('subscription_grace_days', 3));
        $this->assertSame('rzp_test_abc', PlatformSettings::get('razorpay_key_id'));
        // stored encrypted
        $this->assertStringNotContainsString('rzp_test_abc', (string) \DB::table('system_settings')->where('key', 'razorpay_key_id')->value('value'));
    }
}
