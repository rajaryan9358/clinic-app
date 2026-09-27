<?php

namespace Tests\Feature\Portal;

use App\Models\LoginOtp;
use App\Services\WhatsApp\FakeWhatsAppGateway;
use App\Services\WhatsApp\WhatsAppGateway;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * Task 2 of the patient-portal plan: WhatsApp one-time-code login
 * (POST /api/portal/auth/request-code, /api/portal/auth/verify) and
 * clinic switching (POST /api/portal/auth/switch-clinic).
 * See app/Services/Portal/PortalOtpService.php.
 */
class PortalOtpTest extends TestCase
{
    use PortalTestHelpers, RefreshDatabase;

    private FakeWhatsAppGateway $fake;

    protected function setUp(): void
    {
        parent::setUp();

        $this->fake = new FakeWhatsAppGateway;
        $this->app->instance(WhatsAppGateway::class, $this->fake);
    }

    private function otpFor(string $phone): ?LoginOtp
    {
        return LoginOtp::where('phone_or_email', $phone)->where('purpose', 'login')->latest('id')->first();
    }

    public function test_request_code_sends_whatsapp_and_stores_hash(): void
    {
        Carbon::setTestNow('2026-01-01 10:00:00');

        $clinic = $this->makeClinic();
        $this->makePatient($clinic, ['phone' => '9876543210']);

        $response = $this->postJson('/api/portal/auth/request-code', ['phone' => '9876543210']);

        $response->assertOk();
        $this->assertSame('If this number is registered, a code has been sent.', $response->json('message'));

        $this->assertCount(1, $this->fake->sent);

        $row = $this->otpFor('919876543210');
        $this->assertNotNull($row);
        $this->assertSame('login', $row->purpose);
        $this->assertMatchesRegularExpression('/^\d{6}$/', $this->lastSentCode());
        $this->assertSame(hash('sha256', $this->lastSentCode()), $row->otp_code);
        $this->assertTrue($row->expires_at->equalTo(Carbon::parse('2026-01-01 10:10:00')));

        Carbon::setTestNow();
    }

    private function lastSentCode(): string
    {
        $components = $this->fake->sent[array_key_last($this->fake->sent)]['components'];

        foreach ($components as $component) {
            if (($component['type'] ?? null) === 'body') {
                return (string) $component['parameters'][0]['text'];
            }
        }

        $this->fail('No body component found in sent WhatsApp message.');
    }

    public function test_request_code_for_unknown_phone_gives_same_reply_and_sends_nothing(): void
    {
        $response = $this->postJson('/api/portal/auth/request-code', ['phone' => '9000000000']);

        $response->assertOk();
        $this->assertSame('If this number is registered, a code has been sent.', $response->json('message'));
        $this->assertCount(0, $this->fake->sent);
        $this->assertNull($this->otpFor('919000000000'));
    }

    public function test_request_code_for_dependent_only_phone_sends_nothing(): void
    {
        $clinic = $this->makeClinic();
        $account = $this->makePatient($clinic, ['phone' => '9111111111']);
        $this->makePatient($clinic, [
            'phone' => '9222222222',
            'managed_by_patient_id' => $account->id,
        ]);

        $response = $this->postJson('/api/portal/auth/request-code', ['phone' => '9222222222']);

        $response->assertOk();
        $this->assertCount(0, $this->fake->sent);
        $this->assertNull($this->otpFor('919222222222'));
    }

    public function test_request_code_for_portal_disabled_clinic_sends_nothing(): void
    {
        $clinic = $this->makeClinic(['portal_enabled' => false]);
        $this->makePatient($clinic, ['phone' => '9333333333']);

        $response = $this->postJson('/api/portal/auth/request-code', ['phone' => '9333333333']);

        $response->assertOk();
        $this->assertCount(0, $this->fake->sent);
        $this->assertNull($this->otpFor('919333333333'));
    }

    public function test_request_code_matches_differently_formatted_phone(): void
    {
        $clinic = $this->makeClinic();
        $this->makePatient($clinic, ['phone' => '9876543210']);

        $this->postJson('/api/portal/auth/request-code', ['phone' => '+91 98765 43210'])->assertOk();
        $this->assertCount(1, $this->fake->sent);

        Carbon::setTestNow(now()->addSeconds(61));
        $this->postJson('/api/portal/auth/request-code', ['phone' => '098765-43210'])->assertOk();
        $this->assertCount(2, $this->fake->sent);
        Carbon::setTestNow();
    }

    public function test_request_code_throttles_per_phone(): void
    {
        $clinic = $this->makeClinic();
        $this->makePatient($clinic, ['phone' => '9876543210']);

        Carbon::setTestNow('2026-01-01 10:00:00');

        $this->postJson('/api/portal/auth/request-code', ['phone' => '9876543210'])->assertOk();
        $this->assertCount(1, $this->fake->sent);

        // Second request within 60s is throttled.
        $response = $this->postJson('/api/portal/auth/request-code', ['phone' => '9876543210']);
        $response->assertStatus(429);
        $this->assertSame('Too many code requests. Try again later.', $response->json('message'));
        $this->assertCount(1, $this->fake->sent);

        // After 61s it is allowed again.
        Carbon::setTestNow(now()->addSeconds(61));
        $this->postJson('/api/portal/auth/request-code', ['phone' => '9876543210'])->assertOk();
        $this->assertCount(2, $this->fake->sent);

        Carbon::setTestNow(now()->addSeconds(61));
        $this->postJson('/api/portal/auth/request-code', ['phone' => '9876543210'])->assertOk();
        $this->assertCount(3, $this->fake->sent);

        Carbon::setTestNow(now()->addSeconds(61));
        $this->postJson('/api/portal/auth/request-code', ['phone' => '9876543210'])->assertOk();
        $this->assertCount(4, $this->fake->sent);

        Carbon::setTestNow(now()->addSeconds(61));
        $this->postJson('/api/portal/auth/request-code', ['phone' => '9876543210'])->assertOk();
        $this->assertCount(5, $this->fake->sent);

        // 6th request within the hour is throttled even though 60s have passed.
        Carbon::setTestNow(now()->addSeconds(61));
        $response = $this->postJson('/api/portal/auth/request-code', ['phone' => '9876543210']);
        $response->assertStatus(429);
        $this->assertSame('Too many code requests. Try again later.', $response->json('message'));
        $this->assertCount(5, $this->fake->sent);

        Carbon::setTestNow();
    }

    public function test_verify_logs_in_single_holder(): void
    {
        $clinic = $this->makeClinic();
        $account = $this->makePatient($clinic, ['phone' => '9876543210']);

        $this->postJson('/api/portal/auth/request-code', ['phone' => '9876543210'])->assertOk();
        $code = $this->lastSentCode();

        $response = $this->postJson('/api/portal/auth/verify', ['phone' => '9876543210', 'code' => $code]);
        $response->assertOk();
        $token = $response->json('data.token');
        $this->assertNotEmpty($token);
        $this->assertSame($account->id, $response->json('data.account.account.id'));

        $row = $this->otpFor('919876543210');
        $this->assertNotNull($row->verified_at);

        $me = $this->portalGet('/api/portal/auth/me', $token);
        $me->assertOk();
        $this->assertSame($account->id, $me->json('data.account.id'));

        // Reusing the same (now verified) code fails as expired.
        $again = $this->postJson('/api/portal/auth/verify', ['phone' => '9876543210', 'code' => $code]);
        $again->assertStatus(422);
        $this->assertSame('Code expired. Request a new code.', $again->json('message'));
    }

    public function test_verify_wrong_code_counts_attempts(): void
    {
        $clinic = $this->makeClinic();
        $account = $this->makePatient($clinic, ['phone' => '9876543210']);

        $this->postJson('/api/portal/auth/request-code', ['phone' => '9876543210'])->assertOk();
        $code = $this->lastSentCode();
        $wrong = $code === '111111' ? '222222' : '111111';

        for ($i = 0; $i < 4; $i++) {
            $response = $this->postJson('/api/portal/auth/verify', ['phone' => '9876543210', 'code' => $wrong]);
            $response->assertStatus(422);
            $this->assertSame('Incorrect code.', $response->json('message'));
        }

        // 5th wrong attempt tips over into "too many attempts".
        $response = $this->postJson('/api/portal/auth/verify', ['phone' => '9876543210', 'code' => $wrong]);
        $response->assertStatus(422);
        $this->assertSame('Too many attempts. Request a new code.', $response->json('message'));

        // Even the correct code is now rejected with the same message.
        $response = $this->postJson('/api/portal/auth/verify', ['phone' => '9876543210', 'code' => $code]);
        $response->assertStatus(422);
        $this->assertSame('Too many attempts. Request a new code.', $response->json('message'));

        $this->assertNotNull($account);
    }

    public function test_verify_expired_code(): void
    {
        $clinic = $this->makeClinic();
        $this->makePatient($clinic, ['phone' => '9876543210']);

        Carbon::setTestNow('2026-01-01 10:00:00');
        $this->postJson('/api/portal/auth/request-code', ['phone' => '9876543210'])->assertOk();
        $code = $this->lastSentCode();

        Carbon::setTestNow(now()->addMinutes(11));

        $response = $this->postJson('/api/portal/auth/verify', ['phone' => '9876543210', 'code' => $code]);
        $response->assertStatus(422);
        $this->assertSame('Code expired. Request a new code.', $response->json('message'));

        Carbon::setTestNow();
    }

    public function test_verify_multiple_holders_requires_selection_without_consuming(): void
    {
        $clinicA = $this->makeClinic();
        $clinicB = $this->makeClinic();

        $holderA = $this->makePatient($clinicA, ['phone' => '9876543210', 'full_name' => 'Holder A']);
        $holderB = $this->makePatient($clinicB, ['phone' => '9876543210', 'full_name' => 'Holder B']);

        $this->postJson('/api/portal/auth/request-code', ['phone' => '9876543210'])->assertOk();
        $code = $this->lastSentCode();

        $response = $this->postJson('/api/portal/auth/verify', ['phone' => '9876543210', 'code' => $code]);
        $response->assertOk();
        $this->assertTrue($response->json('data.needs_selection'));
        $choices = $response->json('data.choices');
        $this->assertCount(2, $choices);
        $patientIds = collect($choices)->pluck('patient_id')->all();
        $this->assertContains($holderA->id, $patientIds);
        $this->assertContains($holderB->id, $patientIds);

        $row = $this->otpFor('919876543210');
        $this->assertNull($row->verified_at);

        // Selecting a profile that isn't among the choices is rejected.
        $foreignClinic = $this->makeClinic();
        $stranger = $this->makePatient($foreignClinic, ['phone' => '9111111111']);
        $badChoice = $this->postJson('/api/portal/auth/verify', [
            'phone' => '9876543210', 'code' => $code, 'patient_id' => $stranger->id,
        ]);
        $badChoice->assertStatus(422);

        // Selecting a valid profile completes login.
        $response = $this->postJson('/api/portal/auth/verify', [
            'phone' => '9876543210', 'code' => $code, 'patient_id' => $holderB->id,
        ]);
        $response->assertOk();
        $this->assertSame($holderB->id, $response->json('data.account.account.id'));
        $this->assertNotEmpty($response->json('data.token'));

        $row->refresh();
        $this->assertNotNull($row->verified_at);
    }

    public function test_switch_clinic_issues_new_token_for_same_phone_holder(): void
    {
        $clinicA = $this->makeClinic();
        $clinicB = $this->makeClinic();

        $holderA = $this->makePatient($clinicA, ['phone' => '9876543210']);
        $holderB = $this->makePatient($clinicB, ['phone' => '9876543210']);

        $oldToken = $this->portalToken($holderA);

        $response = $this->portalPost('/api/portal/auth/switch-clinic', $oldToken, null, ['patient_id' => $holderB->id]);
        $response->assertOk();
        $newToken = $response->json('data.token');
        $this->assertNotEmpty($newToken);
        $this->assertSame($holderB->id, $response->json('data.account.account.id'));

        // The old token is now revoked.
        $old = $this->portalGet('/api/portal/auth/me', $oldToken);
        $old->assertStatus(401);

        // The new token works.
        $new = $this->portalGet('/api/portal/auth/me', $newToken);
        $new->assertOk();
        $this->assertSame($holderB->id, $new->json('data.account.id'));
    }

    public function test_switch_clinic_rejects_portal_disabled_target_or_different_phone(): void
    {
        $clinicA = $this->makeClinic();
        $disabledClinic = $this->makeClinic(['portal_enabled' => false]);
        $otherPhoneClinic = $this->makeClinic();

        $holderA = $this->makePatient($clinicA, ['phone' => '9876543210']);
        $disabledHolder = $this->makePatient($disabledClinic, ['phone' => '9876543210']);
        $differentPhoneHolder = $this->makePatient($otherPhoneClinic, ['phone' => '9111111111']);

        $token = $this->portalToken($holderA);

        $response = $this->portalPost('/api/portal/auth/switch-clinic', $token, null, ['patient_id' => $disabledHolder->id]);
        $response->assertStatus(422);

        app('auth')->forgetGuards();
        $response = $this->portalPost('/api/portal/auth/switch-clinic', $token, null, ['patient_id' => $differentPhoneHolder->id]);
        $response->assertStatus(422);
    }

    public function test_dependent_token_is_rejected_by_portal_guard(): void
    {
        $clinic = $this->makeClinic();
        $account = $this->makePatient($clinic, ['phone' => '9876543210']);
        $dependent = $this->makePatient($clinic, [
            'phone' => '9876543210',
            'managed_by_patient_id' => $account->id,
        ]);

        $dependentToken = $this->portalToken($dependent);

        $response = $this->portalGet('/api/portal/auth/me', $dependentToken);
        $response->assertStatus(401);
        $this->assertSame('Session expired. Please sign in again.', $response->json('message'));
    }
}
