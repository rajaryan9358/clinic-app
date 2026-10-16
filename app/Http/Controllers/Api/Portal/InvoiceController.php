<?php

namespace App\Http\Controllers\Api\Portal;

use App\Http\Controllers\Concerns\ApiResponse;
use App\Http\Controllers\Controller;
use App\Models\ClinicSetting;
use App\Models\Invoice;
use App\Models\Patient;
use App\Services\Billing\PatientPaymentService;
use App\Services\Billing\RazorpayGateway;
use App\Services\InvoicePdfRenderer;
use App\Support\Billing\InvoicePresenter;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;

/**
 * Patient-facing invoices and online payment, scoped to the *acting* profile
 * (`portal_patient`) and that profile's own clinic. Only `issued` and `paid`
 * invoices are visible: a draft has not been issued and a cancelled one has
 * been voided, so both are a 404 on every route, the PDF included.
 *
 * Paying needs both the clinic's online-payment switch and a configured
 * gateway; without them the capability does not exist for this clinic and
 * `pay`/`confirm` are a 404.
 */
class InvoiceController extends Controller
{
    use ApiResponse;

    public function __construct(
        private readonly PatientPaymentService $payments,
        private readonly RazorpayGateway $gateway,
    ) {}

    public function index(Request $request)
    {
        $items = $this->visible($request)
            ->with('appointment.doctor')
            ->withSum(['payments as paid_sum' => fn ($q) => $q->where('status', 'success')], 'amount')
            ->orderByDesc('invoice_date')
            ->orderByDesc('id')
            ->get()
            ->map(fn (Invoice $i) => InvoicePresenter::item($i));

        return $this->success('OK', $items->values()->all());
    }

    public function show(Request $request, int $id)
    {
        return $this->success('OK', InvoicePresenter::portalDetail($this->find($request, $id)));
    }

    public function pdf(Request $request, int $id, InvoicePdfRenderer $renderer)
    {
        $invoice = $this->find($request, $id);

        return $renderer->render($invoice, patientFacing: true)->download('invoice-'.str_replace(['/', '\\'], '-', (string) ($invoice->invoice_number ?? $invoice->id)).'.pdf');
    }

    public function pay(Request $request, int $id)
    {
        $invoice = $this->payable($request, $id);

        return $this->success('OK', $this->payments->startOrder($invoice));
    }

    public function confirm(Request $request, int $id)
    {
        $invoice = $this->payable($request, $id);

        $data = $request->validate([
            'razorpay_order_id' => ['required', 'string', 'max:100'],
            'razorpay_payment_id' => ['required', 'string', 'max:100'],
            'razorpay_signature' => ['required', 'string', 'max:255'],
        ]);

        $this->payments->confirm($invoice, $data['razorpay_order_id'], $data['razorpay_payment_id'], $data['razorpay_signature']);

        return $this->success('OK', InvoicePresenter::portalDetail($this->find($request, $id)));
    }

    /** Invoices of the acting profile that the clinic has issued and not voided. */
    private function visible(Request $request): Builder
    {
        /** @var Patient $patient */
        $patient = $request->attributes->get('portal_patient');

        return Invoice::query()
            ->where('clinic_id', $patient->clinic_id)
            ->where('patient_id', $patient->id)
            ->whereIn('status', ['issued', 'paid']);
    }

    private function find(Request $request, int $id): Invoice
    {
        return $this->visible($request)->findOrFail($id);
    }

    /** A visible invoice, and only when this clinic can take online payment at all. */
    private function payable(Request $request, int $id): Invoice
    {
        $invoice = $this->find($request, $id);

        if (! ClinicSetting::billingFor((int) $invoice->clinic_id)['online_payment_enabled'] || ! $this->gateway->isConfigured()) {
            abort(404);
        }

        return $invoice;
    }
}
