<?php

namespace App\Services\Billing;

use App\Support\PlatformSettings;
use Razorpay\Api\Api;
use RuntimeException;

class RazorpayApiGateway implements RazorpayGateway
{
    public function isConfigured(): bool
    {
        return filled(PlatformSettings::get('razorpay_key_id')) && filled(PlatformSettings::get('razorpay_key_secret'));
    }

    public function keyId(): ?string
    {
        return PlatformSettings::get('razorpay_key_id') ?: null;
    }

    private function api(): Api
    {
        if (! $this->isConfigured()) {
            throw new RuntimeException('Razorpay is not configured.');
        }

        return new Api((string) PlatformSettings::get('razorpay_key_id'), (string) PlatformSettings::get('razorpay_key_secret'));
    }

    public function createPlan(string $period, int $amount, string $name): string
    {
        $plan = $this->api()->plan->create([
            'period' => $period,
            'interval' => 1,
            'item' => ['name' => $name, 'amount' => $amount, 'currency' => 'INR'],
        ]);

        return (string) $plan['id'];
    }

    public function createSubscription(string $razorpayPlanId, int $totalCount, ?int $startAt, array $notes): array
    {
        $payload = ['plan_id' => $razorpayPlanId, 'total_count' => $totalCount, 'customer_notify' => 1, 'notes' => $notes];
        if ($startAt) {
            $payload['start_at'] = $startAt;
        }
        $sub = $this->api()->subscription->create($payload);

        return ['id' => (string) $sub['id'], 'status' => (string) $sub['status']];
    }

    public function cancelSubscription(string $subscriptionId, bool $atCycleEnd): void
    {
        $this->api()->subscription->fetch($subscriptionId)->cancel(['cancel_at_cycle_end' => $atCycleEnd ? 1 : 0]);
    }

    public function verifyPaymentSignature(string $paymentId, string $subscriptionId, string $signature): bool
    {
        $secret = (string) PlatformSettings::get('razorpay_key_secret', '');
        if ($secret === '') {
            return false;
        }

        return hash_equals(hash_hmac('sha256', $paymentId.'|'.$subscriptionId, $secret), $signature);
    }

    public function verifyWebhookSignature(string $body, string $signature): bool
    {
        $secret = (string) PlatformSettings::get('razorpay_webhook_secret', '');
        if ($secret === '' || $signature === '') {
            return false;
        }

        return hash_equals(hash_hmac('sha256', $body, $secret), $signature);
    }
}
