<?php

namespace App\Services\Billing;

use App\Models\Payment;
use Illuminate\Support\Facades\Log;

/**
 * The patient-invoice half of the Razorpay webhook. Subscription events keep
 * going to RazorpayWebhookHandler; this one only sees events whose payment
 * entity belongs to an invoice order (see handles()).
 *
 * Only `payment.captured` settles. `payment.failed` is deliberately ignored:
 * Razorpay reuses one order across retries, so marking the pending row failed
 * on a first declined attempt would leave a later successful capture with
 * nothing to settle.
 */
class PatientPaymentWebhookHandler
{
    public function __construct(private readonly PatientPaymentService $payments) {}

    /** True when this event's payment entity belongs to a patient invoice order. */
    public function handles(array $payload): bool
    {
        // A subscription entity settles it: that event is the clinic's own billing,
        // whatever its notes say. Stealing it here would silently drop the charge.
        if (isset($payload['subscription'])) {
            return false;
        }

        $entity = $payload['payment']['entity'] ?? null;
        if (! is_array($entity)) {
            return false;
        }

        $notes = is_array($entity['notes'] ?? null) ? $entity['notes'] : [];
        if (filled($notes['invoice_id'] ?? null) && ! filled($notes['subscription_id'] ?? null)) {
            return true;
        }

        $orderId = $entity['order_id'] ?? null;

        return is_scalar($orderId) && filled($orderId)
            && Payment::query()->where('razorpay_order_id', (string) $orderId)->exists();
    }

    public function handle(string $event, array $payload): void
    {
        $entity = $payload['payment']['entity'] ?? [];

        if ($event !== 'payment.captured' || ! is_array($entity)) {
            Log::info('Ignoring a patient-payment Razorpay event', ['event' => $event, 'payment_id' => $entity['id'] ?? null]);

            return;
        }

        $this->payments->settleFromWebhook($entity);
    }
}
