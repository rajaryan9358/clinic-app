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

    /**
     * A one-off order for a patient invoice. The amount is in paise, and the
     * notes carry invoice_id and clinic_id so a webhook can be traced back.
     *
     * @return array{id: string}
     */
    public function createOrder(int $amountInPaise, string $receipt, array $notes): array;

    public function verifyOrderSignature(string $orderId, string $paymentId, string $signature): bool;
}
