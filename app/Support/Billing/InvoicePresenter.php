<?php

namespace App\Support\Billing;

use App\Models\Appointment;
use App\Models\Invoice;
use App\Models\Payment;
use App\Services\Billing\InvoiceService;

/**
 * Response shapes for invoices, shared by the clinic and super-admin
 * controllers (and the patient portal). Money is rupees as a float.
 *
 * `balance` is total minus what has been successfully paid and is NOT
 * clamped: an online capture can overshoot the outstanding amount, which
 * leaves a negative balance staff need to see.
 */
final class InvoicePresenter
{
    /** List row. Uses a preloaded `paid_sum` (withSum) when present to avoid a query per row. */
    public static function item(Invoice $invoice): array
    {
        $paid = self::paid($invoice);

        return [
            'id' => $invoice->id,
            'clinic_id' => $invoice->clinic_id,
            'invoice_number' => $invoice->invoice_number,
            'invoice_date' => $invoice->invoice_date?->toDateString(),
            'appointment_id' => $invoice->appointment_id,
            'doctor_name' => $invoice->appointment?->doctor?->full_name,
            'patient' => $invoice->patient
                ? ['id' => $invoice->patient->id, 'full_name' => $invoice->patient->full_name, 'phone' => $invoice->patient->phone]
                : null,
            'status' => $invoice->status,
            'total_amount' => (float) $invoice->total_amount,
            'amount_paid' => $paid,
            'balance' => round((float) $invoice->total_amount - $paid, 2),
        ];
    }

    public static function detail(Invoice $invoice): array
    {
        $invoice->loadMissing(['patient' => fn ($q) => $q->withTrashed(), 'appointment.doctor', 'items', 'payments']);

        return self::item($invoice) + [
            'subtotal' => (float) $invoice->subtotal,
            'discount_amount' => (float) $invoice->discount_amount,
            'tax_amount' => (float) $invoice->tax_amount,
            'tax_is_manual' => (bool) $invoice->tax_is_manual,
            'notes' => $invoice->notes,
            'issued_at' => $invoice->issued_at?->toIso8601String(),
            'cancelled_at' => $invoice->cancelled_at?->toIso8601String(),
            'cancelled_reason' => $invoice->cancelled_reason,
            'items' => $invoice->items->map(fn ($i) => [
                'id' => $i->id,
                'service_id' => $i->service_id,
                'description' => $i->description,
                'quantity' => (int) $i->quantity,
                'unit_amount' => (float) $i->unit_amount,
                'amount' => (float) $i->amount,
            ])->values()->all(),
            'payments' => $invoice->payments->sortBy('id')->map(fn (Payment $p) => self::payment($p))->values()->all(),
        ];
    }

    /**
     * The patient's view of an issued invoice: the staff detail minus payment rows that are not
     * money the patient moved. A superseded online checkout (`failed`) and an unsettled `pending`
     * order are internal bookkeeping; showing either would read as a failed or phantom payment.
     */
    public static function portalDetail(Invoice $invoice): array
    {
        $detail = self::detail($invoice);

        // Staff-authored free text (invoice notes, cancellation and refund reasons, payment notes)
        // is internal and must never reach the patient.
        unset($detail['notes'], $detail['cancelled_reason'], $detail['cancelled_at'], $detail['tax_is_manual']);

        $detail['payments'] = array_values(array_map(
            function (array $p) {
                unset($p['notes'], $p['refund_reason']);

                return $p;
            },
            array_filter($detail['payments'], fn (array $p) => ! $p['superseded'] && $p['status'] !== 'pending'),
        ));

        return $detail;
    }

    public static function payment(Payment $payment): array
    {
        // A failed online row is a checkout attempt that was abandoned or replaced by a newer
        // order, not a failed charge; label it so staff do not chase it.
        $superseded = $payment->payment_method === 'online' && $payment->status === 'failed';

        return [
            'id' => $payment->id,
            'invoice_id' => $payment->invoice_id,
            'amount' => (float) $payment->amount,
            'payment_method' => $payment->payment_method,
            'status' => $payment->status,
            'display_status' => $superseded ? 'superseded' : $payment->status,
            'superseded' => $superseded,
            'reference_number' => $payment->reference_number,
            'paid_at' => $payment->paid_at?->toIso8601String(),
            'notes' => $payment->notes,
            'refunded_at' => $payment->refunded_at?->toIso8601String(),
            'refund_reason' => $payment->refund_reason,
        ];
    }

    /** The one non-cancelled invoice of an appointment as `{id, number, status, total, balance}`, or null. */
    public static function summaryForAppointment(Appointment $appointment): ?array
    {
        $invoice = Invoice::where('clinic_id', $appointment->clinic_id)
            ->where('appointment_id', $appointment->id)
            ->where('status', '!=', 'cancelled')
            ->latest('id')
            ->first();

        if (! $invoice) {
            return null;
        }

        return [
            'id' => $invoice->id,
            'number' => $invoice->invoice_number,
            'status' => $invoice->status,
            'total' => (float) $invoice->total_amount,
            'balance' => round((float) $invoice->total_amount - self::paid($invoice), 2),
        ];
    }

    private static function paid(Invoice $invoice): float
    {
        return array_key_exists('paid_sum', $invoice->getAttributes())
            ? round((float) $invoice->getAttributes()['paid_sum'], 2)
            : app(InvoiceService::class)->amountPaid($invoice);
    }
}
