<?php

namespace App\Services\Billing;

use App\Models\Appointment;
use App\Models\ClinicSetting;
use App\Models\Invoice;
use App\Models\InvoiceCounter;
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
    /**
     * @param  array{patient_id:int, appointment_id?:int, invoice_date?:string, discount_amount?:float,
     *               tax_amount?:float, notes?:string, items:array<int, array{description:string,
     *               service_id?:int, quantity:int, unit_amount:float}>}  $data
     */
    public function draft(int $clinicId, array $data, ?int $userId = null): Invoice
    {
        $items = $this->normalizeItems($data['items'] ?? []);
        $totals = $this->totals($clinicId, $items, (float) ($data['discount_amount'] ?? 0), $data['tax_amount'] ?? null);

        return DB::transaction(function () use ($clinicId, $data, $userId, $items, $totals) {
            $invoice = Invoice::create([
                'clinic_id' => $clinicId,
                'patient_id' => $data['patient_id'],
                'appointment_id' => $data['appointment_id'] ?? null,
                
                'invoice_date' => $data['invoice_date'] ?? $this->today()->toDateString(),
                'notes' => $data['notes'] ?? null,
                'status' => 'draft',
            ] + $totals);
            $invoice->forceFill(['created_by_user_id' => $userId])->save();

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

            $totals = $this->totals(
                (int) $fresh->clinic_id,
                $items,
                (float) ($data['discount_amount'] ?? $fresh->discount_amount),
                $data['tax_amount'] ?? null,
            );

            $fresh->fill(array_intersect_key($data, array_flip(['appointment_id', 'invoice_date', 'notes'])) + $totals)->save();

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

            InvoiceCounter::firstOrCreate(['clinic_id' => $clinicId, 'period' => $period]);
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
                $fresh->forceFill([
                    'status' => 'cancelled',
                    'cancelled_at' => now(),
                    'cancelled_reason' => $reason,
                ])->save();
            }

            $invoice->setRawAttributes($fresh->getAttributes(), true);

            return $invoice;
        });
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
            ? \App\Models\Service::forClinic($clinicId)->find($appointment->service_id)
            : null;
        if ($service && (float) $service->fee > 0) {
            $lines[] = ['description' => $service->name, 'service_id' => $service->id, 'quantity' => 1, 'unit_amount' => (float) $service->fee];
        }

        $doctor = $appointment->doctor_id
            ? \App\Models\Doctor::forClinic($clinicId)->find($appointment->doctor_id)
            : null;
        if ($doctor) {
            $followup = $appointment->visit_type === 'followup';
            $fee = (float) ($followup ? $doctor->followup_fee : $doctor->consultation_fee);
            if ($fee > 0) {
                $lines[] = [
                    'description' => ($followup ? 'Follow-up consultation' : 'Consultation').' - '.$doctor->full_name,
                    'service_id' => null,
                    'quantity' => 1,
                    'unit_amount' => $fee,
                ];
            }
        }

        return $lines;
    }

    /** Indian financial year (April-March), e.g. 2026-27. */
    public static function financialYear(CarbonInterface $date): string
    {
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
        return array_values(array_map(function (array $item) {
            $quantity = (int) ($item['quantity'] ?? 1);
            $unit = round((float) $item['unit_amount'], 2);

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

        if ($discount > $subtotal) {
            throw ValidationException::withMessages(['discount_amount' => 'The discount cannot be more than the subtotal.']);
        }

        $tax = $tax !== null
            ? round((float) $tax, 2)
            : round(($subtotal - $discount) * ClinicSetting::billingFor($clinicId)['invoice_tax_percent'] / 100, 2);

        return [
            'subtotal' => $subtotal,
            'discount_amount' => $discount,
            'tax_amount' => $tax,
            'total_amount' => round($subtotal - $discount + $tax, 2),
        ];
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
