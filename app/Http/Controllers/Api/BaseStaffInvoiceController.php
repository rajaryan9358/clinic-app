<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\ApiResponse;
use App\Http\Controllers\Controller;
use App\Models\Appointment;
use App\Models\Invoice;
use App\Models\Patient;
use App\Models\Payment;
use App\Services\Billing\InvoiceService;
use App\Services\InvoicePdfRenderer;
use App\Services\Portal\PortalLinkService;
use App\Services\WhatsApp\PatientNotifier;
use App\Support\Billing\InvoicePresenter;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Staff invoice endpoints shared by the clinic and super-admin APIs. Every rule lives in
 * InvoiceService and every response shape in InvoicePresenter; subclasses only say which
 * clinic a request is limited to. Records outside that scope are a 404, never a 403.
 */
abstract class BaseStaffInvoiceController extends Controller
{
    use ApiResponse;

    public function __construct(protected readonly InvoiceService $invoices) {}

    /** The clinic this request is limited to; null = every clinic (super admin without a filter). */
    abstract protected function clinicId(Request $request): ?int;

    public function index(Request $request)
    {
        $data = $request->validate([
            'patient_id' => ['nullable', 'integer'],
            'appointment_id' => ['nullable', 'integer'],
            'status' => ['nullable', Rule::in(['draft', 'issued', 'paid', 'cancelled'])],
            'from' => ['nullable', 'date_format:Y-m-d'],
            'to' => ['nullable', 'date_format:Y-m-d'],
            'q' => ['nullable', 'string', 'max:100'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $q = trim((string) ($data['q'] ?? ''));

        $result = $this->scoped($request)
            ->with(['patient' => fn ($query) => $query->withTrashed(), 'appointment.doctor'])
            ->withSum(['payments as paid_sum' => fn ($query) => $query->where('status', 'success')], 'amount')
            ->when(isset($data['patient_id']), fn (Builder $b) => $b->where('patient_id', (int) $data['patient_id']))
            ->when(isset($data['appointment_id']), fn (Builder $b) => $b->where('appointment_id', (int) $data['appointment_id']))
            ->when(isset($data['status']), fn (Builder $b) => $b->where('status', $data['status']))
            ->when(isset($data['from']), fn (Builder $b) => $b->whereDate('invoice_date', '>=', $data['from']))
            ->when(isset($data['to']), fn (Builder $b) => $b->whereDate('invoice_date', '<=', $data['to']))
            ->when($q !== '', fn (Builder $b) => $b->where(function (Builder $w) use ($q) {
                $w->where('invoice_number', 'like', "%{$q}%")
                    ->orWhereHas('patient', fn (Builder $p) => $p->withTrashed()
                        ->where(fn (Builder $n) => $n->where('full_name', 'like', "%{$q}%")->orWhere('phone', 'like', "%{$q}%")));
            }))
            ->orderByDesc('invoice_date')
            ->orderByDesc('id')
            ->paginate((int) ($data['per_page'] ?? 15));

        $result->setCollection($result->getCollection()->map(fn (Invoice $i) => InvoicePresenter::item($i)));

        return $this->paginated('Invoices fetched successfully', $result);
    }

    public function show(Request $request, int $id)
    {
        return $this->success('Invoice fetched successfully', InvoicePresenter::detail($this->find($request, $id)));
    }

    public function store(Request $request)
    {
        $clinicId = $this->clinicId($request)
            ?? (int) $request->validate(['clinic_id' => ['required', 'integer', 'exists:clinics,id']])['clinic_id'];

        $data = $request->validate([
            'patient_id' => ['required', 'integer', Rule::exists('patients', 'id')->where('clinic_id', $clinicId)->whereNull('deleted_at')],
            'appointment_id' => ['nullable', 'integer', Rule::exists('appointments', 'id')->where('clinic_id', $clinicId)],
            'invoice_date' => ['nullable', 'date_format:Y-m-d'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ] + $this->moneyRules($clinicId, true));

        $invoice = $this->invoices->draft($clinicId, $data, $request->user()?->id);

        return $this->success('Invoice created successfully', InvoicePresenter::detail($invoice), 201);
    }

    public function update(Request $request, int $id)
    {
        $invoice = $this->find($request, $id);

        $data = $request->validate([
            'appointment_id' => ['nullable', 'integer', Rule::exists('appointments', 'id')->where('clinic_id', $invoice->clinic_id)],
            'invoice_date' => ['nullable', 'date_format:Y-m-d'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ] + $this->moneyRules((int) $invoice->clinic_id, false));

        $invoice = $this->invoices->update($invoice, $data);

        return $this->success('Invoice updated successfully', InvoicePresenter::detail($invoice));
    }

    public function issue(Request $request, int $id)
    {
        $invoice = $this->invoices->issue($this->find($request, $id));

        return $this->success('Invoice issued successfully', InvoicePresenter::detail($invoice));
    }

    public function cancel(Request $request, int $id)
    {
        $data = $request->validate(['reason' => ['nullable', 'string', 'max:500']]);
        $invoice = $this->invoices->cancel($this->find($request, $id), $data['reason'] ?? null);

        return $this->success('Invoice cancelled successfully', InvoicePresenter::detail($invoice));
    }

    public function recordPayment(Request $request, int $id)
    {
        $invoice = $this->find($request, $id);

        $data = $request->validate([
            'amount' => ['required', 'numeric'],
            'payment_method' => ['required', 'string'],
            'reference_number' => ['nullable', 'string', 'max:100'],
            'paid_at' => ['nullable', 'date'],
            'notes' => ['nullable', 'string', 'max:1000'],
        ]);

        $payment = $this->invoices->recordPayment($invoice, $data, $request->user()?->id);

        return $this->success('Payment recorded successfully', InvoicePresenter::payment($payment), 201);
    }

    public function refund(Request $request, int $id)
    {
        $data = $request->validate(['reason' => ['required', 'string', 'max:500']]);

        $payment = Payment::query()
            ->when($this->clinicId($request) !== null, fn (Builder $b) => $b->where('clinic_id', $this->clinicId($request)))
            ->findOrFail($id);

        return $this->success('Payment refunded successfully', InvoicePresenter::payment($this->invoices->markRefunded($payment, $data['reason'])));
    }

    public function pdf(Request $request, int $id, InvoicePdfRenderer $renderer)
    {
        $invoice = $this->find($request, $id);

        return $renderer->render($invoice)->download('invoice-'.str_replace(['/', '\\'], '-', (string) ($invoice->invoice_number ?? $invoice->id)).'.pdf');
    }

    /** Sends the patient a WhatsApp with a login link that lands on this invoice in the portal. */
    public function send(Request $request, int $id, PortalLinkService $links, PatientNotifier $notifier)
    {
        $invoice = $this->find($request, $id);

        if (! in_array($invoice->status, ['issued', 'paid'], true)) {
            throw ValidationException::withMessages(['invoice' => 'Only an issued invoice can be sent to the patient.']);
        }

        $patient = Patient::withTrashed()->findOrFail($invoice->patient_id);
        $holder = $patient->managed_by_patient_id !== null
            ? Patient::withTrashed()->where('clinic_id', $invoice->clinic_id)->find($patient->managed_by_patient_id)
            : $patient;

        // A holder outside the invoice's clinic (or missing) is bad data: refuse rather than
        // issue a login link for another clinic's patient.
        if ($holder === null) {
            throw ValidationException::withMessages(['patient' => 'The account holder for this patient could not be found in this clinic.']);
        }

        $issued = $links->issueForRedirect(
            $holder,
            now()->addDays(7),
            "/invoices/{$invoice->id}?profile={$patient->id}",
            $request->user()?->id,
        );

        $message = $notifier->invoiceReady($invoice, $issued['token']);
        $message->refresh();

        return $this->success('Invoice sent successfully', ['delivery_status' => $message->delivery_status]);
    }

    public function prefill(Request $request, int $id)
    {
        $appointment = Appointment::query()
            ->when($this->clinicId($request) !== null, fn (Builder $b) => $b->where('clinic_id', $this->clinicId($request)))
            ->findOrFail($id);

        return $this->success('Invoice prefill fetched successfully', [
            'appointment_id' => $appointment->id,
            'patient_id' => $appointment->patient_id,
            'items' => $this->invoices->prefillFor($appointment),
        ]);
    }

    /** Invoices visible to this request. */
    protected function scoped(Request $request): Builder
    {
        return Invoice::query()
            ->when($this->clinicId($request) !== null, fn (Builder $b) => $b->where('clinic_id', $this->clinicId($request)));
    }

    protected function find(Request $request, int $id): Invoice
    {
        return $this->scoped($request)->findOrFail($id);
    }

    /** @return array<string, mixed> */
    private function moneyRules(int $clinicId, bool $required): array
    {
        return [
            'items' => [$required ? 'required' : 'sometimes', 'array', 'min:1'],
            'items.*.description' => ['required', 'string', 'max:255'],
            'items.*.quantity' => ['required', 'integer', 'min:1'],
            'items.*.unit_amount' => ['required', 'numeric', 'min:0'],
            'items.*.service_id' => ['nullable', 'integer', Rule::exists('services', 'id')->where('clinic_id', $clinicId)],
            'discount_amount' => ['nullable', 'numeric', 'min:0'],
            'tax_amount' => ['nullable', 'numeric', 'min:0'],
        ];
    }
}
