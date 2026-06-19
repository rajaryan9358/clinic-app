<?php

namespace App\Http\Controllers\Api\Clinic;

use App\Models\Payment;

class PaymentController extends BaseClinicCrudController
{
    protected string $modelClass = Payment::class;
    protected array $searchable = ['reference_number', 'payment_method', 'status'];
    protected array $filterable = ['patient_id', 'appointment_id', 'invoice_id', 'status'];
}
