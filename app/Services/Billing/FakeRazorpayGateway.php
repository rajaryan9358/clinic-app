<?php

namespace App\Services\Billing;

class FakeRazorpayGateway implements RazorpayGateway
{
    public bool $configured = true;

    public bool $signatureValid = true;

    public array $createdPlans = [];

    public array $createdSubscriptions = [];

    public array $cancelled = [];

    public function isConfigured(): bool
    {
        return $this->configured;
    }

    public function keyId(): ?string
    {
        return $this->configured ? 'rzp_test_fake' : null;
    }

    public function createPlan(string $period, int $amount, string $name): string
    {
        $this->createdPlans[] = compact('period', 'amount', 'name');

        return 'plan_fake_'.count($this->createdPlans);
    }

    public function createSubscription(string $razorpayPlanId, int $totalCount, ?int $startAt, array $notes): array
    {
        $this->createdSubscriptions[] = compact('razorpayPlanId', 'totalCount', 'startAt', 'notes');

        return ['id' => 'sub_fake_'.count($this->createdSubscriptions), 'status' => 'created'];
    }

    public function cancelSubscription(string $subscriptionId, bool $atCycleEnd): void
    {
        $this->cancelled[] = compact('subscriptionId', 'atCycleEnd');
    }

    public function verifyPaymentSignature(string $paymentId, string $subscriptionId, string $signature): bool
    {
        return $this->signatureValid;
    }

    public function verifyWebhookSignature(string $body, string $signature): bool
    {
        return $this->signatureValid;
    }
}
