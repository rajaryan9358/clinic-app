<?php

namespace App\Http\Controllers\Api\Clinic;

use App\Models\Invoice;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class InvoiceController extends BaseClinicCrudController
{
    protected string $modelClass = Invoice::class;
    protected array $searchable = ['invoice_number', 'status'];
    protected array $filterable = ['patient_id', 'status', 'invoice_date'];
    protected array $statuses = ['draft', 'issued', 'paid', 'cancelled'];

    protected function rules(Request $request, ?Model $model = null): array
    {
        $clinicId = $this->clinicId($request);
        $required = $model ? ['sometimes', 'required'] : ['required'];

        return [
            'patient_id' => [...$required, 'integer', Rule::exists('patients', 'id')->where('clinic_id', $clinicId)->whereNull('deleted_at')],
            'appointment_id' => ['nullable', 'integer', Rule::exists('appointments', 'id')->where('clinic_id', $clinicId)],
            'invoice_number' => [...$required, 'string', 'max:255', Rule::unique('invoices', 'invoice_number')->ignore($model?->getKey())],
            'invoice_date' => [...$required, 'date'],
            'subtotal' => [...$required, 'numeric', 'min:0'],
            'discount_amount' => ['sometimes', 'numeric', 'min:0'],
            'tax_amount' => ['sometimes', 'numeric', 'min:0'],
            'total_amount' => [...$required, 'numeric', 'min:0'],
            'status' => ['sometimes', 'in:draft,issued,paid,cancelled'],
            'notes' => ['nullable', 'string', 'max:5000'],
        ];
    }
}
