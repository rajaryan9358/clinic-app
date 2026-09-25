<?php

namespace App\Services\Billing;

interface RazorpayGateway
{
    public function isConfigured(): bool;

    public function keyId(): ?string;

    public function createPlan(string $period, int $amount, string $name): string;

    public function createSubscription(string $razorpayPlanId, int $totalCount, ?int $startAt, array $notes): array;

    public function cancelSubscription(string $subscriptionId, bool $atCycleEnd): void;

    public function verifyPaymentSignature(string $paymentId, string $subscriptionId, string $signature): bool;

    public function verifyWebhookSignature(string $body, string $signature): bool;
}
