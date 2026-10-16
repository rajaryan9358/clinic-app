<?php

namespace App\Services\Billing;

use App\Models\ClinicSetting;
use App\Models\Invoice;
use App\Models\Payment;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\ConflictHttpException;

/**
 * One-off Razorpay orders for patient invoices.
 *
 * The money moves at Razorpay; our job is to mirror it exactly once. A
 * `pending` payment row is written when the order is raised and only becomes
 * `success` when a signature-verified confirm, or a `payment.captured`
 * webhook, settles it. A pending row is not money: InvoiceService::amountPaid()
 * counts successful rows only.
 *
 * Idempotency rests on three things, in this order:
 *   1. the invoice row is locked for the whole of a settle, so two settles of
 *      the same invoice cannot interleave their amountPaid() reads;
 *   2. a settle resolves by `razorpay_payment_id` first and stops if that id
 *      is already recorded — both paths hand the banked row back untouched,
 *      and only a capture banked against a *different* invoice is a 409;
 *   3. `payments.razorpay_payment_id` is UNIQUE, which is the last line of
 *      defence if 1 and 2 are ever bypassed.
 *
 * `razorpay_order_id`, `razorpay_payment_id`, `refunded_at` and
 * `refund_reason` are deliberately not fillable, so they are written with
 * forceFill().
 */
final class PatientPaymentService
{
    private const UNAVAILABLE = 'Online payment is not available at this clinic.';

    private const ALREADY_RECORDED = 'This payment has already been recorded.';

    public function __construct(
        private readonly RazorpayGateway $gateway,
        private readonly InvoiceService $invoices,
    ) {}

    /**
     * Raise (or reuse) a Razorpay order for everything still owed on an invoice.
     *
     * @return array{order_id:string, amount:float, currency:string, key_id:string, invoice_number:string}
     */
    public function startOrder(Invoice $invoice): array
    {
        $clinicId = (int) $invoice->clinic_id;

        if (! ClinicSetting::billingFor($clinicId)['online_payment_enabled'] || ! $this->gateway->isConfigured()) {
            throw ValidationException::withMessages(['online_payment' => self::UNAVAILABLE]);
        }

        return DB::transaction(function () use ($invoice, $clinicId) {
            $fresh = Invoice::where('id', $invoice->id)->where('clinic_id', $clinicId)->lockForUpdate()->firstOrFail();

            if ($fresh->status === 'draft') {
                throw ValidationException::withMessages(['invoice' => 'Issue the invoice before taking a payment.']);
            }
            if ($fresh->status === 'cancelled') {
                throw ValidationException::withMessages(['invoice' => 'A cancelled invoice cannot take a payment.']);
            }

            $outstanding = $this->outstanding($fresh);
            if ($outstanding <= 0) {
                throw ValidationException::withMessages(['invoice' => 'This invoice is already paid.']);
            }

            // Reuse only an order raised for exactly what is owed now. A stale
            // pending row is left alone rather than cancelled: it is the only
            // thing that can resolve a webhook for the order it belongs to.
            $pending = $this->pendingRows($fresh)
                ->get()
                ->first(fn (Payment $p) => round((float) $p->amount, 2) === $outstanding);

            if (! $pending) {
                $order = $this->gateway->createOrder(
                    (int) round($outstanding * 100),
                    (string) ($fresh->invoice_number ?: 'INV-'.$fresh->id),
                    ['invoice_id' => (string) $fresh->id, 'clinic_id' => (string) $clinicId],
                );

                $pending = Payment::create([
                    'clinic_id' => $clinicId,
                    'invoice_id' => $fresh->id,
                    'appointment_id' => $fresh->appointment_id,
                    'patient_id' => $fresh->patient_id,
                    'amount' => $outstanding,
                    'payment_method' => 'online',
                    'paid_at' => now(),
                    'status' => 'pending',
                ]);
                $pending->forceFill(['razorpay_order_id' => (string) $order['id']])->save();
            }

            return [
                'order_id' => (string) $pending->razorpay_order_id,
                'amount' => round((float) $pending->amount, 2),
                'currency' => 'INR',
                'key_id' => (string) $this->gateway->keyId(),
                'invoice_number' => (string) $fresh->invoice_number,
            ];
        });
    }

    /**
     * Settle from the browser, after Razorpay checkout hands back a signature.
     *
     * The clinic's online_payment_enabled switch is deliberately not re-checked
     * here: the money has already moved, and refusing to record it would strand it.
     */
    public function confirm(Invoice $invoice, string $orderId, string $paymentId, string $signature): Payment
    {
        if ($paymentId === '' || $orderId === '') {
            throw ValidationException::withMessages(['payment' => 'This payment could not be verified.']);
        }

        if (! $this->gateway->verifyOrderSignature($orderId, $paymentId, $signature)) {
            throw ValidationException::withMessages(['payment' => 'This payment could not be verified.']);
        }

        return DB::transaction(function () use ($invoice, $orderId, $paymentId) {
            $fresh = Invoice::where('id', $invoice->id)->where('clinic_id', $invoice->clinic_id)->lockForUpdate()->firstOrFail();

            // Not clinic-scoped on purpose: razorpay_payment_id is unique across
            // the table, so an id recorded anywhere is already banked.
            $existing = Payment::query()->where('razorpay_payment_id', $paymentId)->first();
            if ($existing) {
                // The webhook normally beats the browser back. When the banked row
                // is this invoice's, hand it over: the patient has paid, and a 409
                // here would turn the ordinary race into an error the UI must undo.
                if ((int) $existing->invoice_id === (int) $fresh->id && (int) $existing->clinic_id === (int) $fresh->clinic_id) {
                    return $existing;
                }

                // A genuine conflict: this capture belongs to a different invoice.
                Log::warning('Razorpay payment confirmed against the wrong invoice', [
                    'payment_id' => $paymentId, 'banked_invoice_id' => $existing->invoice_id, 'confirmed_invoice_id' => $fresh->id,
                ]);

                throw new ConflictHttpException(self::ALREADY_RECORDED);
            }

            // The amount is the one we raised the order for; it is read off our own
            // row, never off the caller, and the signature ties the caller to that
            // order. It is banked even when it now exceeds the outstanding (see settle()).
            $pending = $this->pendingRows($fresh)->where('razorpay_order_id', $orderId)->lockForUpdate()->first();
            if (! $pending) {
                throw ValidationException::withMessages(['payment' => 'That payment order is not open on this invoice.']);
            }

            return $this->settle($fresh, $pending, $paymentId);
        });
    }

    /**
     * Settle from a `payment.captured` webhook. An order we do not know, or a
     * capture for an amount the order was not raised for, returns null without
     * touching anything; a replay returns the already-banked row.
     *
     * @param  array<string, mixed>  $paymentEntity  the Razorpay payment entity (amount in paise)
     */
    public function settleFromWebhook(array $paymentEntity): ?Payment
    {
        $paymentId = (string) ($paymentEntity['id'] ?? '');
        $orderId = (string) ($paymentEntity['order_id'] ?? '');
        $clinicId = (int) ($paymentEntity['notes']['clinic_id'] ?? 0);

        if ($paymentId === '' || $orderId === '') {
            Log::info('Razorpay payment webhook without an order', ['payment_id' => $paymentId]);

            return null;
        }

        $row = Payment::query()
            ->where('razorpay_order_id', $orderId)
            ->when($clinicId > 0, fn ($q) => $q->forClinic($clinicId))
            ->orderByDesc('id')
            ->first();

        if (! $row) {
            Log::info('Razorpay webhook for an unknown payment order', [
                'order_id' => $orderId, 'payment_id' => $paymentId, 'clinic_id' => $clinicId ?: null,
            ]);

            return null;
        }

        return DB::transaction(function () use ($row, $paymentEntity, $paymentId) {
            $invoice = Invoice::where('id', $row->invoice_id)->where('clinic_id', $row->clinic_id)->lockForUpdate()->first();
            if (! $invoice) {
                Log::warning('Razorpay webhook for a payment with no invoice', ['payment_row_id' => $row->id, 'payment_id' => $paymentId]);

                return null;
            }

            // A replay: this capture is already banked, so there is nothing to do.
            $existing = Payment::query()->where('razorpay_payment_id', $paymentId)->first();
            if ($existing) {
                return $existing;
            }

            $pending = Payment::where('id', $row->id)->where('clinic_id', $row->clinic_id)->lockForUpdate()->first();
            if (! $pending || $pending->status !== 'pending' || $pending->razorpay_payment_id !== null) {
                Log::warning('Razorpay capture for a payment row that is no longer pending', [
                    'payment_row_id' => $row->id, 'payment_id' => $paymentId, 'status' => $pending?->status,
                ]);

                return null;
            }

            // Anti-tamper: the capture must be for exactly what the order was
            // raised for, so a ₹1 order can never settle a ₹2,000 invoice.
            $amount = round((float) $pending->amount, 2);
            $capturedPaise = isset($paymentEntity['amount']) ? (int) $paymentEntity['amount'] : null;
            if ($capturedPaise !== null && $capturedPaise !== (int) round($amount * 100)) {
                Log::warning('Razorpay captured an amount the order was not raised for', [
                    'payment_row_id' => $pending->id, 'payment_id' => $paymentId,
                    'captured_paise' => $capturedPaise, 'expected_paise' => (int) round($amount * 100),
                ]);

                return null;
            }

            return $this->settle($invoice, $pending, $paymentId);
        });
    }

    /**
     * Flip a locked pending row to success and recompute the invoice and its appointment.
     *
     * A capture is banked even when it is now worth more than the invoice owes
     * (staff took cash at the counter after the order was raised): the money has
     * already moved at Razorpay, and not recording it would leave the books
     * disagreeing with reality. The excess shows up as a negative balance for
     * staff to refund. This is why `amountPaid() > total_amount` is reachable for
     * online captures, and only for them — InvoiceService::recordPayment() keeps
     * its over-outstanding guard, because staff can adjust before taking cash.
     */
    private function settle(Invoice $invoice, Payment $pending, string $paymentId): Payment
    {
        $amount = round((float) $pending->amount, 2);
        if ($amount > $this->outstanding($invoice)) {
            Log::warning('Online capture is larger than the invoice outstanding; banking it leaves a negative balance', [
                'invoice_id' => $invoice->id, 'payment_id' => $paymentId,
                'amount' => $amount, 'outstanding' => $this->outstanding($invoice),
            ]);
        }

        $pending->forceFill([
            'razorpay_payment_id' => $paymentId,
            'status' => 'success',
            'paid_at' => now(),
        ])->save();

        $this->invoices->syncState($invoice);

        return $pending;
    }

    /** Online orders still waiting on a capture. Clinic-scoped; never counted as money. */
    private function pendingRows(Invoice $invoice): Builder
    {
        return Payment::query()
            ->forClinic((int) $invoice->clinic_id)
            ->where('invoice_id', $invoice->id)
            ->where('payment_method', 'online')
            ->where('status', 'pending')
            ->whereNull('razorpay_payment_id')
            ->whereNotNull('razorpay_order_id')
            ->orderByDesc('id');
    }

    /** Call with the invoice row locked: total less everything already banked. */
    private function outstanding(Invoice $invoice): float
    {
        return round((float) $invoice->total_amount - $this->invoices->amountPaid($invoice), 2);
    }
}
