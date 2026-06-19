<?php

namespace App\Http\Controllers\Api\SuperAdmin;

use App\Http\Controllers\Api\BaseCrudController;
use App\Models\Payment;

class PaymentController extends BaseCrudController
{
    protected string $modelClass = Payment::class;
    protected array $searchable = ['reference_number', 'payment_method', 'status'];
    protected array $filterable = ['clinic_id', 'patient_id', 'appointment_id', 'invoice_id', 'status'];
}
