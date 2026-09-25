<?php

namespace App\Http\Controllers\Api\SuperAdmin;

use App\Http\Controllers\Api\BaseCrudController;
use App\Models\Invoice;

class InvoiceController extends BaseCrudController
{
    protected string $modelClass = Invoice::class;
    protected array $searchable = ['invoice_number', 'status'];
    protected array $filterable = ['clinic_id', 'patient_id', 'status', 'invoice_date'];
}
