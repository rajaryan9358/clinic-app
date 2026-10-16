<?php

namespace App\Services;

use App\Models\ClinicSetting;
use App\Models\Invoice;
use App\Models\Payment;
use App\Services\Billing\InvoiceService;
use Barryvdh\DomPDF\Facade\Pdf;
use Barryvdh\DomPDF\PDF as PdfDocument;

/**
 * Renders the invoice PDF for the staff "invoices/{id}/pdf" endpoints. Headed
 * "Invoice", or "Receipt" once fully paid. Never "Tax Invoice": tax is a plain
 * line, not a GST-compliant document.
 */
class InvoicePdfRenderer
{
    public function __construct(private readonly InvoiceService $invoices) {}

    public function render(Invoice $invoice): PdfDocument
    {
        return Pdf::loadView('reports.invoice', $this->data($invoice))->setPaper('a4', 'portrait');
    }

    /** @return array<string, mixed> The variables reports.invoice is rendered with. */
    public function data(Invoice $invoice): array
    {
        $invoice->loadMissing(['clinic', 'patient' => fn ($q) => $q->withTrashed(), 'items', 'payments']);

        $total = round((float) $invoice->total_amount, 2);
        $paid = $this->invoices->amountPaid($invoice);
        $balance = round($total - $paid, 2); // may be negative: never clamped

        return [
            'title' => $invoice->status === 'paid' ? 'Receipt' : 'Invoice',
            'clinicName' => (string) ($invoice->clinic?->name ?? ''),
            'invoiceNumber' => (string) ($invoice->invoice_number ?? '-'),
            'invoiceDate' => $invoice->invoice_date?->format('d M Y') ?? '-',
            'patientName' => (string) ($invoice->patient?->full_name ?? '-'),
            'items' => $invoice->items->map(fn ($i) => [
                'description' => $i->description,
                'quantity' => (int) $i->quantity,
                'unit' => $this->money($i->unit_amount),
                'amount' => $this->money($i->amount),
            ])->all(),
            'subtotal' => $this->money($invoice->subtotal),
            'discount' => (float) $invoice->discount_amount > 0 ? $this->money($invoice->discount_amount) : null,
            'tax' => (float) $invoice->tax_amount > 0 ? $this->money($invoice->tax_amount) : null,
            'total' => $this->money($total),
            'paid' => $this->money($paid),
            'balance' => $this->money($balance),
            // Failed online rows are superseded or abandoned checkout attempts, not real
            // failures, so they are left out of the history.
            'payments' => $invoice->payments
                ->sortBy('id')
                ->reject(fn (Payment $p) => $p->status === 'failed' && $p->payment_method === 'online')
                ->map(fn (Payment $p) => [
                    'date' => ($p->paid_at ?? $p->created_at)?->format('d M Y') ?? '-',
                    'method' => str_replace('_', ' ', (string) $p->payment_method),
                    'reference' => $p->reference_number,
                    'status' => $p->status === 'success' ? 'Paid' : ucfirst((string) $p->status),
                    'amount' => $this->money($p->amount),
                ])->values()->all(),
            'notes' => $invoice->notes,
            'footerNote' => ClinicSetting::billingFor((int) $invoice->clinic_id)['invoice_footer_note'],
        ];
    }

    private function money(mixed $amount): string
    {
        $amount = round((float) $amount, 2);

        return ($amount < 0 ? '-' : '').'₹'.number_format(abs($amount), 2);
    }
}
