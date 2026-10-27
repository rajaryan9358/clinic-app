<?php

namespace App\Http\Controllers\Api\Clinic;

use App\Models\Payment;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class PaymentController extends BaseClinicCrudController
{
    protected string $modelClass = Payment::class;
    protected array $searchable = ['reference_number', 'payment_method', 'status'];
    protected array $filterable = ['patient_id', 'appointment_id', 'invoice_id', 'status'];
    protected array $statuses = ['success', 'pending', 'failed', 'refunded'];

    protected function rules(Request $request, ?Model $model = null): array
    {
        $clinicId = $this->clinicId($request);
        $required = $model ? ['sometimes', 'required'] : ['required'];

        return [
            'invoice_id' => ['nullable', 'integer', Rule::exists('invoices', 'id')->where('clinic_id', $clinicId)],
            'appointment_id' => ['nullable', 'integer', Rule::exists('appointments', 'id')->where('clinic_id', $clinicId)],
            'patient_id' => [...$required, 'integer', Rule::exists('patients', 'id')->where('clinic_id', $clinicId)->whereNull('deleted_at')],
            'amount' => [...$required, 'numeric', 'min:0'],
            'payment_method' => [...$required, 'in:cash,upi,card,bank_transfer,other'],
            'reference_number' => ['nullable', 'string', 'max:255'],
            'paid_at' => [...$required, 'date'],
            'status' => ['sometimes', 'in:success,pending,failed,refunded'],
            'notes' => ['nullable', 'string', 'max:5000'],
        ];
    }
}
