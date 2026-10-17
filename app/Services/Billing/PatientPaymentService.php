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

        // Phase 1, under the invoice lock: what is owed, and is an order for
        // exactly that already open? The transaction closes before the gateway
        // call, so a slow Razorpay can never hold the invoice row.
        $reuse = DB::transaction(function () use ($invoice, $clinicId) {
            $fresh = $this->lockForPayment($invoice);
            $this->assertPayable($fresh);

            $outstanding = $this->outstanding($fresh);
            if ($outstanding <= 0) {
                throw ValidationException::withMessages(['invoice' => 'This invoice is already paid.']);
            }

            $open = $this->livePendingRows($fresh)
                ->get()
                ->first(fn (Payment $p) => round((float) $p->amount, 2) === $outstanding);

            return ['outstanding' => $outstanding, 'open' => $open, 'invoice' => $fresh];
        });

        if ($reuse['open']) {
            return $this->checkoutPayload($reuse['invoice'], $reuse['open']);
        }

        // Phase 2, no transaction open and no lock held: the HTTP call.
        $outstanding = $reuse['outstanding'];
        $order = $this->gateway->createOrder(
            (int) round($outstanding * 100),
            (string) ($reuse['invoice']->invoice_number ?: 'INV-'.$reuse['invoice']->id),
            ['invoice_id' => (string) $invoice->id, 'clinic_id' => (string) $clinicId],
        );

        // Phase 3, a short second transaction: re-lock, supersede whatever was
        // open, and record the order. The row is always written, even when the
        // invoice moved under us, so a capture on this order can still resolve
        // to it rather than arriving as money we cannot place.
        $written = DB::transaction(function () use ($invoice, $clinicId, $outstanding, $order) {
            $fresh = $this->lockForPayment($invoice);

            // At most one live order per invoice: the rest are superseded, but keep
            // their order ids so a late capture on them still resolves (and is banked).
            foreach ($this->livePendingRows($fresh)->get() as $stale) {
                $stale->forceFill([
                    'status' => 'failed',
                    'notes' => trim((string) $stale->notes."\nSuperseded by a newer payment order."),
                ])->save();
                Log::info('Superseded an open Razorpay order', [
                    'invoice_id' => $fresh->id, 'payment_row_id' => $stale->id, 'order_id' => $stale->razorpay_order_id,
                ]);
            }

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

            $drifted = ! in_array($fresh->status, ['issued', 'paid'], true) || $this->outstanding($fresh) !== $outstanding;

            return ['invoice' => $fresh, 'pending' => $pending, 'drifted' => $drifted];
        });

        if ($written['drifted']) {
            // The order is live at Razorpay for an amount that is no longer due.
            // Its row is committed (so a capture on it still lands), and the caller
            // retries, which supersedes it.
            Log::warning('Razorpay order raised for an amount that changed while it was being created', [
                'invoice_id' => $invoice->id, 'order_id' => $order['id'], 'raised_for' => $outstanding,
            ]);

            throw ValidationException::withMessages([
                'invoice' => 'The amount due changed while the payment was being set up. Please try again.',
            ]);
        }

        return $this->checkoutPayload($written['invoice'], $written['pending']);
    }

    /** @return array{order_id:string, amount:float, currency:string, key_id:string, invoice_number:string} */
    private function checkoutPayload(Invoice $invoice, Payment $pending): array
    {
        return [
            'order_id' => (string) $pending->razorpay_order_id,
            'amount' => round((float) $pending->amount, 2),
            'currency' => 'INR',
            'key_id' => (string) $this->gateway->keyId(),
            'invoice_number' => (string) $invoice->invoice_number,
        ];
    }

    private function lockForPayment(Invoice $invoice): Invoice
    {
        return Invoice::where('id', $invoice->id)->where('clinic_id', $invoice->clinic_id)->lockForUpdate()->firstOrFail();
    }

    private function assertPayable(Invoice $invoice): void
    {
        if ($invoice->status === 'draft') {
            throw ValidationException::withMessages(['invoice' => 'Issue the invoice before taking a payment.']);
        }
        if ($invoice->status === 'cancelled') {
            throw ValidationException::withMessages(['invoice' => 'A cancelled invoice cannot take a payment.']);
        }
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
                // is this invoice's and still stands, hand it over: the patient has
                // paid, and a 409 would turn the ordinary race into an error the UI
                // must undo. A refunded row is NOT a success - reporting it as one
                // would render a reopened invoice as paid - so it takes the conflict
                // path, which is true of it: that id is already recorded.
                if ($existing->status === 'success'
                    && (int) $existing->invoice_id === (int) $fresh->id
                    && (int) $existing->clinic_id === (int) $fresh->clinic_id) {
                    return $existing;
                }

                Log::warning('Razorpay payment confirmed against a capture that is already recorded', [
                    'payment_id' => $paymentId, 'banked_invoice_id' => $existing->invoice_id,
                    'banked_status' => $existing->status, 'confirmed_invoice_id' => $fresh->id,
                ]);

                throw new ConflictHttpException(self::ALREADY_RECORDED);
            }

            // The amount is the one we raised the order for; it is read off our own
            // row, never off the caller, and the signature ties the caller to that
            // order. It is banked even when it now exceeds the outstanding (see settle()).
            $pending = $this->settleableRows($fresh)->where('razorpay_order_id', $orderId)->lockForUpdate()->first();
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
        // Everything here comes off the wire. A non-scalar where a string belongs
        // must never throw: the throw would happen inside the controller's
        // transaction, rolling back the delivery-dedupe row, and Razorpay would
        // retry the same 500 for ever.
        $paymentId = self::wireString($paymentEntity['id'] ?? null);
        $orderId = self::wireString($paymentEntity['order_id'] ?? null);
        $notes = is_array($paymentEntity['notes'] ?? null) ? $paymentEntity['notes'] : [];
        $clinicId = (int) self::wireString($notes['clinic_id'] ?? null);

        if ($paymentId === '' || $orderId === '') {
            Log::info('Razorpay payment webhook without a usable id or order', [
                'payment_id' => $paymentId ?: null, 'order_id' => $orderId ?: null,
            ]);

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

            // A superseded ("failed") order may still be captured - the patient had
            // that checkout open - but a row that already carries a capture must
            // never be re-stamped, or the audit trail stops naming the money.
            $pending = Payment::where('id', $row->id)->where('clinic_id', $row->clinic_id)->lockForUpdate()->first();
            if (! $pending || ! in_array($pending->status, ['pending', 'failed'], true) || $pending->razorpay_payment_id !== null) {
                Log::warning('Razorpay capture for a payment row that can no longer be settled', [
                    'payment_row_id' => $row->id, 'payment_id' => $paymentId, 'status' => $pending?->status,
                    'recorded_payment_id' => $pending?->razorpay_payment_id,
                ]);

                return null;
            }

            // Anti-tamper: the capture must be for exactly what the order was raised
            // for, so a ₹1 order can never settle a ₹2,000 invoice. An entity with no
            // usable amount is a mismatch too - it is not an excuse to skip the check.
            $amount = round((float) $pending->amount, 2);
            $capturedPaise = is_numeric($paymentEntity['amount'] ?? null) ? (int) $paymentEntity['amount'] : null;
            if ($capturedPaise === null || $capturedPaise !== (int) round($amount * 100)) {
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

        // A void invoice cannot absorb money: syncState() leaves a cancelled
        // invoice (and its appointment) alone, so without this line the clinic
        // would be holding patient money with nothing to find it by.
        if (! in_array($invoice->status, ['issued', 'paid'], true)) {
            Log::warning('Online capture banked against an invoice that is not open; it needs refunding or re-invoicing', [
                'invoice_id' => $invoice->id, 'payment_id' => $paymentId,
                'amount' => $amount, 'invoice_status' => $invoice->status,
            ]);
        }

        if ($pending->status === 'failed') {
            Log::warning('Online capture banked on a superseded Razorpay order', [
                'invoice_id' => $invoice->id, 'payment_id' => $paymentId,
                'payment_row_id' => $pending->id, 'order_id' => $pending->razorpay_order_id,
            ]);
        }

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

    /**
     * Online orders that could still be captured: the live one, and any that a
     * newer order superseded (the patient may still have that checkout open).
     * Clinic-scoped. None of them is money until it is settled.
     */
    private function settleableRows(Invoice $invoice): Builder
    {
        return Payment::query()
            ->forClinic((int) $invoice->clinic_id)
            ->where('invoice_id', $invoice->id)
            ->where('payment_method', 'online')
            ->whereIn('status', ['pending', 'failed'])
            ->whereNull('razorpay_payment_id')
            ->whereNotNull('razorpay_order_id')
            ->orderByDesc('id');
    }

    /** The one order a patient may still be offered for this invoice. */
    private function livePendingRows(Invoice $invoice): Builder
    {
        return $this->settleableRows($invoice)->where('status', 'pending');
    }

    /** A string off the wire, or '' when the payload held something else there. */
    private static function wireString(mixed $value): string
    {
        return is_scalar($value) ? trim((string) $value) : '';
    }

    /** Call with the invoice row locked: total less everything already banked. */
    private function outstanding(Invoice $invoice): float
    {
        return round((float) $invoice->total_amount - $this->invoices->amountPaid($invoice), 2);
    }
}
