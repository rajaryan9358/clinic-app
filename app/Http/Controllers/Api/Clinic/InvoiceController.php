<?php

namespace App\Http\Controllers\Api\Clinic;

use App\Models\Invoice;

class InvoiceController extends BaseClinicCrudController
{
    protected string $modelClass = Invoice::class;
    protected array $searchable = ['invoice_number', 'status'];
    protected array $filterable = ['branch_id', 'patient_id', 'status', 'invoice_date'];
}
