<?php

namespace App\Services\Billing;

use App\Models\Appointment;
use App\Models\ClinicSetting;
use App\Models\Doctor;
use App\Models\Invoice;
use App\Models\InvoiceCounter;
use App\Models\Payment;
use App\Models\Service;
use Carbon\CarbonInterface;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Drafts invoices, computes their totals and issues them with a per-clinic,
 * per-financial-year number (`{prefix}/{period}/{n padded to 5}`).
 *
 * The number is allocated at issue only, under a row lock on the clinic's
 * counter, and is never reused (cancelling keeps it). Statuses are
 * draft/issued/paid/cancelled; "partly paid" is derived elsewhere.
 */
final class InvoiceService
{
    private const COUNTER_METHODS = ['cash', 'upi', 'card', 'bank_transfer', 'other'];

    /**
     * @param  array{patient_id:int, appointment_id?:int, invoice_date?:string, discount_amount?:float,
     *               tax_amount?:float, notes?:string, items:array<int, array{description:string,
     *               service_id?:int, quantity:int, unit_amount:float}>}  $data
     */
    public function draft(int $clinicId, array $data, ?int $userId = null): Invoice
    {
        // Only new invoices are gated: issuing, paying, cancelling and refunding existing ones must keep working.
        if (! ClinicSetting::billingFor($clinicId)['invoicing_enabled']) {
            throw ValidationException::withMessages(['invoice' => 'Invoicing is turned off for this clinic.']);
        }

        $items = $this->normalizeItems($data['items'] ?? []);
        $totals = $this->totals($clinicId, $items, (float) ($data['discount_amount'] ?? 0), $data['tax_amount'] ?? null);

        return DB::transaction(function () use ($clinicId, $data, $userId, $items, $totals) {
            $this->assertAppointmentFree($clinicId, $data['appointment_id'] ?? null, null);

            $invoice = Invoice::create([
                'clinic_id' => $clinicId,
                'patient_id' => $data['patient_id'],
                'appointment_id' => $data['appointment_id'] ?? null,
                'invoice_date' => $data['invoice_date'] ?? $this->today()->toDateString(),
                'notes' => $data['notes'] ?? null,
                'status' => 'draft',
            ] + $totals);
            $invoice->forceFill([
                'created_by_user_id' => $userId,
                'tax_is_manual' => ($data['tax_amount'] ?? null) !== null,
            ])->save();

            $this->writeItems($invoice, $items);

            return $invoice->load('items');
        });
    }

    /** Draft only. Items, when given, replace the existing lines. */
    public function update(Invoice $invoice, array $data): Invoice
    {
        return DB::transaction(function () use ($invoice, $data) {
            $fresh = Invoice::where('id', $invoice->id)->where('clinic_id', $invoice->clinic_id)->lockForUpdate()->firstOrFail();

            if ($fresh->status !== 'draft') {
                throw ValidationException::withMessages(['invoice' => 'Only a draft invoice can be edited.']);
            }

            $items = array_key_exists('items', $data)
                ? $this->normalizeItems($data['items'])
                : $fresh->items->map(fn ($i) => [
                    'service_id' => $i->service_id, 'description' => $i->description, 'quantity' => $i->quantity,
                    'unit_amount' => (float) $i->unit_amount, 'amount' => (float) $i->amount,
                ])->all();

            $clinicId = (int) $fresh->clinic_id;
            $discount = (float) ($data['discount_amount'] ?? $fresh->discount_amount);

            // tax_is_manual records that a caller set the tax by hand: honour the stored
            // figure when this call omits tax_amount, otherwise recompute from the clinic percent.
            $explicitTax = array_key_exists('tax_amount', $data) && $data['tax_amount'] !== null;
            $manual = $explicitTax || (bool) $fresh->tax_is_manual;
            $tax = $explicitTax ? $data['tax_amount'] : ($manual ? (float) $fresh->tax_amount : null);

            $totals = $this->totals($clinicId, $items, $discount, $tax);

            if (! empty($data['appointment_id'])) {
                $this->assertAppointmentFree($clinicId, $data['appointment_id'], $fresh->id);
            }

            $fresh->fill(array_intersect_key($data, array_flip(['appointment_id', 'invoice_date', 'notes'])) + $totals);
            $fresh->forceFill(['tax_is_manual' => $manual])->save();

            if (array_key_exists('items', $data)) {
                $fresh->items()->delete();
                $this->writeItems($fresh, $items);
            }

            $invoice->setRawAttributes($fresh->getAttributes(), true);

            return $invoice->load('items');
        });
    }

    public function issue(Invoice $invoice): Invoice
    {
        return DB::transaction(function () use ($invoice) {
            $fresh = Invoice::where('id', $invoice->id)->where('clinic_id', $invoice->clinic_id)->lockForUpdate()->firstOrFail();

            if ($fresh->status !== 'draft') {
                throw ValidationException::withMessages(['invoice' => 'This invoice has already been issued.']);
            }

            $clinicId = (int) $fresh->clinic_id;
            $period = self::financialYear($this->today());

            // insertOrIgnore never throws on the unique(clinic_id, period) race, so the
            // first issue of a financial year cannot 500; the select below then locks the row.
            InvoiceCounter::insertOrIgnore(['clinic_id' => $clinicId, 'period' => $period, 'next_number' => 1]);
            $counter = InvoiceCounter::where('clinic_id', $clinicId)->where('period', $period)->lockForUpdate()->firstOrFail();

            $number = (int) $counter->next_number;
            $counter->next_number = $number + 1;
            $counter->save();

            $prefix = ClinicSetting::billingFor($clinicId)['invoice_prefix'];

            $fresh->forceFill([
                'invoice_number' => sprintf('%s/%s/%s', $prefix, $period, str_pad((string) $number, 5, '0', STR_PAD_LEFT)),
                'status' => 'issued',
                'issued_at' => now(),
            ])->save();

            // Mirrors the money onto the appointment (and marks a zero-total invoice paid).
            $this->syncState($fresh);

            $invoice->setRawAttributes($fresh->getAttributes(), true);

            return $invoice->load('items');
        });
    }

    /** The number is kept. Cancelling an already-cancelled invoice is a no-op. */
    public function cancel(Invoice $invoice, ?string $reason = null): Invoice
    {
        return DB::transaction(function () use ($invoice, $reason) {
            $fresh = Invoice::where('id', $invoice->id)->where('clinic_id', $invoice->clinic_id)->lockForUpdate()->firstOrFail();

            if ($fresh->status !== 'cancelled') {
                if ($this->amountPaid($fresh) > 0) {
                    throw ValidationException::withMessages(['invoice' => 'Refund the payments before cancelling this invoice.']);
                }

                $fresh->forceFill([
                    'status' => 'cancelled',
                    'cancelled_at' => now(),
                    'cancelled_reason' => $reason,
                ])->save();

                $this->releaseAppointment($fresh);
            }

            $invoice->setRawAttributes($fresh->getAttributes(), true);

            return $invoice->load('items');
        });
    }

    /**
     * Record a counter payment (cash/UPI/card/...) against an issued invoice.
     *
     * @param  array{amount:float|int|string, payment_method:string, reference_number?:?string, paid_at?:mixed, notes?:?string}  $data
     */
    public function recordPayment(Invoice $invoice, array $data, ?int $userId = null): Payment
    {
        return DB::transaction(function () use ($invoice, $data, $userId) {
            $fresh = Invoice::where('id', $invoice->id)->where('clinic_id', $invoice->clinic_id)->lockForUpdate()->firstOrFail();

            if ($fresh->status === 'draft') {
                throw ValidationException::withMessages(['invoice' => 'Issue the invoice before taking a payment.']);
            }
            if ($fresh->status === 'cancelled') {
                throw ValidationException::withMessages(['invoice' => 'A cancelled invoice cannot take a payment.']);
            }
            if (! in_array($data['payment_method'] ?? null, self::COUNTER_METHODS, true)) {
                throw ValidationException::withMessages(['payment_method' => 'That is not a valid payment method.']);
            }

            $amount = round((float) ($data['amount'] ?? 0), 2);
            if ($amount <= 0) {
                throw ValidationException::withMessages(['amount' => 'The payment amount must be more than zero.']);
            }

            $outstanding = round((float) $fresh->total_amount - $this->amountPaid($fresh), 2);
            if ($amount > $outstanding) {
                throw ValidationException::withMessages(['amount' => 'That is more than the amount outstanding.']);
            }

            $payment = Payment::create([
                'clinic_id' => $fresh->clinic_id,
                'invoice_id' => $fresh->id,
                'appointment_id' => $fresh->appointment_id,
                'patient_id' => $fresh->patient_id,
                'amount' => $amount,
                'payment_method' => $data['payment_method'],
                'reference_number' => $data['reference_number'] ?? null,
                'paid_at' => $data['paid_at'] ?? now(),
                'status' => 'success',
                'collected_by_user_id' => $userId,
                'notes' => $data['notes'] ?? null,
            ]);

            $this->syncState($fresh);
            $invoice->setRawAttributes($fresh->getAttributes(), true);

            return $payment;
        });
    }

    /** Marks a successful payment refunded (money is returned outside the system) and recomputes state. */
    public function markRefunded(Payment $payment, string $reason): Payment
    {
        return DB::transaction(function () use ($payment, $reason) {
            $invoice = Invoice::where('id', $payment->invoice_id)->where('clinic_id', $payment->clinic_id)->lockForUpdate()->firstOrFail();
            $fresh = Payment::where('id', $payment->id)->where('clinic_id', $payment->clinic_id)->lockForUpdate()->firstOrFail();

            if ($fresh->status !== 'success') {
                throw ValidationException::withMessages(['payment' => 'Only a successful payment can be refunded.']);
            }

            $fresh->status = 'refunded';
            $fresh->forceFill(['refunded_at' => now(), 'refund_reason' => $reason])->save();

            $this->syncState($invoice);
            $payment->setRawAttributes($fresh->getAttributes(), true);

            return $payment;
        });
    }

    /**
     * Bring the invoice status and its appointment in line with the payments.
     * Call inside a transaction holding the invoice lock. Draft and cancelled
     * invoices are left alone; a waived appointment keeps its payment_status.
     */
    public function syncState(Invoice $invoice): void
    {
        if (! in_array($invoice->status, ['issued', 'paid'], true)) {
            return;
        }

        $paid = $this->amountPaid($invoice);
        $status = $paid >= round((float) $invoice->total_amount, 2) ? 'paid' : 'issued';

        if ($invoice->status !== $status) {
            $invoice->forceFill(['status' => $status])->save();
        }

        if (! $invoice->appointment_id) {
            return;
        }

        $appointment = Appointment::where('id', $invoice->appointment_id)->where('clinic_id', $invoice->clinic_id)->first();
        if (! $appointment) {
            return;
        }

        $appointment->fill([
            'appointment_fee' => $invoice->subtotal,
            'discount_amount' => $invoice->discount_amount,
            'final_amount' => $invoice->total_amount,
        ]);
        if ($appointment->payment_status !== 'waived') {
            $appointment->payment_status = $status === 'paid' ? 'paid' : ($paid > 0 ? 'partial' : 'unpaid');
        }
        $appointment->save();
    }

    /** One non-cancelled invoice per appointment; the lock on the appointment row serialises concurrent drafts. */
    private function assertAppointmentFree(int $clinicId, mixed $appointmentId, ?int $exceptInvoiceId): void
    {
        if (empty($appointmentId)) {
            return;
        }

        Appointment::where('id', $appointmentId)->where('clinic_id', $clinicId)->lockForUpdate()->first();

        $taken = Invoice::where('clinic_id', $clinicId)
            ->where('appointment_id', $appointmentId)
            ->where('status', '!=', 'cancelled')
            ->when($exceptInvoiceId, fn ($q) => $q->where('id', '!=', $exceptInvoiceId))
            ->exists();

        if ($taken) {
            throw ValidationException::withMessages(['appointment_id' => 'This appointment already has an invoice.']);
        }
    }

    /** The bill no longer exists: clear the mirrored money (discount resets to its 0 default) and recompute payment_status (waived is kept). */
    private function releaseAppointment(Invoice $invoice): void
    {
        if (! $invoice->appointment_id) {
            return;
        }

        $appointment = Appointment::where('id', $invoice->appointment_id)->where('clinic_id', $invoice->clinic_id)->first();
        if (! $appointment) {
            return;
        }

        $appointment->fill(['appointment_fee' => null, 'discount_amount' => 0, 'final_amount' => null]);
        if ($appointment->payment_status !== 'waived') {
            $appointment->payment_status = $this->amountPaid($invoice) > 0 ? 'partial' : 'unpaid';
        }
        $appointment->save();
    }

    /** Sum of successful payments, in rupees. */
    public function amountPaid(Invoice $invoice): float
    {
        return round((float) Payment::where('invoice_id', $invoice->id)
            ->where('clinic_id', $invoice->clinic_id)
            ->where('status', 'success')
            ->sum('amount'), 2);
    }

    /**
     * Suggested lines for an appointment: its service fee, then the doctor's
     * consultation (new) or follow-up fee. Null/zero fees are skipped.
     *
     * @return array<int, array{description:string, service_id:?int, quantity:int, unit_amount:float}>
     */
    public function prefillFor(Appointment $appointment): array
    {
        $lines = [];
        $clinicId = (int) $appointment->clinic_id;

        $service = $appointment->service_id
            ? Service::forClinic($clinicId)->find($appointment->service_id)
            : null;
        if ($service && (float) $service->fee > 0) {
            $lines[] = ['description' => $service->name, 'service_id' => $service->id, 'quantity' => 1, 'unit_amount' => (float) $service->fee];
        }

        $doctor = $appointment->doctor_id
            ? Doctor::forClinic($clinicId)->find($appointment->doctor_id)
            : null;
        if ($doctor && ($line = self::doctorFeeLine($doctor, (string) $appointment->visit_type))) {
            $lines[] = $line;
        }

        return $lines;
    }

    /**
     * The single source of a doctor's fee line (wording and amount), shared by prefill and the
     * hand-picked line. `$visitType` is 'new' or 'followup'; anything else counts as 'new'.
     * Null when the relevant fee is null or zero, so a zero-rupee line never reaches an invoice.
     *
     * @return array{description:string, service_id:?int, quantity:int, unit_amount:float}|null
     */
    public static function doctorFeeLine(Doctor $doctor, string $visitType): ?array
    {
        $followup = $visitType === 'followup';
        $fee = (float) ($followup ? $doctor->followup_fee : $doctor->consultation_fee);

        if ($fee <= 0) {
            return null;
        }

        return [
            'description' => ($followup ? 'Follow-up consultation' : 'Consultation').' - '.$doctor->full_name,
            'service_id' => null,
            'quantity' => 1,
            'unit_amount' => $fee,
        ];
    }

    /** Indian financial year (April-March), e.g. 2026-27. */
    public static function financialYear(CarbonInterface $date): string
    {
        // Century rollover reads 2099-00 (start year + 1, mod 100); accepted as-is.
        $start = $date->month >= 4 ? $date->year : $date->year - 1;

        return sprintf('%d-%02d', $start, ($start + 1) % 100);
    }

    private function today(): Carbon
    {
        return Carbon::now(config('app.clinic_timezone', config('app.timezone')));
    }

    /**
     * @param  array<int, array<string, mixed>>  $rawItems
     * @return array<int, array{service_id:?int, description:string, quantity:int, unit_amount:float, amount:float}>
     */
    private function normalizeItems(array $rawItems): array
    {
        if ($rawItems === []) {
            throw ValidationException::withMessages(['items' => 'An invoice needs at least one item.']);
        }

        return array_values(array_map(function (array $item) {
            $quantity = (int) ($item['quantity'] ?? 1);
            $unit = round((float) $item['unit_amount'], 2);

            if ($quantity < 1 || $unit < 0) {
                throw ValidationException::withMessages(['items' => 'Each item needs a quantity of at least 1 and a unit amount of 0 or more.']);
            }

            return [
                'service_id' => $item['service_id'] ?? null,
                'description' => (string) $item['description'],
                'quantity' => $quantity,
                'unit_amount' => $unit,
                'amount' => round($quantity * $unit, 2),
            ];
        }, $rawItems));
    }

    /**
     * @param  array<int, array{amount:float}>  $items
     * @return array{subtotal:float, discount_amount:float, tax_amount:float, total_amount:float}
     */
    private function totals(int $clinicId, array $items, float $discount, mixed $tax): array
    {
        $subtotal = round(array_sum(array_column($items, 'amount')), 2);
        $discount = round($discount, 2);

        if ($discount < 0) {
            throw ValidationException::withMessages(['discount_amount' => 'The discount cannot be negative.']);
        }

        if ($tax !== null && (float) $tax < 0) {
            throw ValidationException::withMessages(['tax_amount' => 'The tax amount cannot be negative.']);
        }

        if ($discount > $subtotal) {
            throw ValidationException::withMessages(['discount_amount' => 'The discount cannot be more than the subtotal.']);
        }

        $tax = $tax !== null
            ? round((float) $tax, 2)
            : $this->automaticTax($clinicId, $subtotal, $discount);

        return [
            'subtotal' => $subtotal,
            'discount_amount' => $discount,
            'tax_amount' => $tax,
            'total_amount' => round($subtotal - $discount + $tax, 2),
        ];
    }

    private function automaticTax(int $clinicId, float $subtotal, float $discount): float
    {
        return round(($subtotal - $discount) * ClinicSetting::billingFor($clinicId)['invoice_tax_percent'] / 100, 2);
    }

    /** @param array<int, array<string, mixed>> $items */
    private function writeItems(Invoice $invoice, array $items): void
    {
        foreach ($items as $i => $item) {
            $invoice->items()->create([
                'service_id' => $item['service_id'],
                'description' => $item['description'],
                'quantity' => $item['quantity'],
                'unit_amount' => $item['unit_amount'],
                'amount' => $item['amount'],
                'sort_order' => $i,
            ]);
        }
    }
}
