<?php

namespace App\Http\Controllers\Api\Clinic;

use App\Http\Controllers\Api\BaseStaffInvoiceController;
use Illuminate\Http\Request;

/** Clinic staff invoices: always scoped to the signed-in user clinic. */
class InvoiceController extends BaseStaffInvoiceController
{
    protected function clinicId(Request $request): ?int
    {
        $clinicId = (int) ($request->attributes->get('clinic_id') ?? $request->user()?->clinic_id);
        abort_if($clinicId === 0, 403, 'No clinic context.');

        return $clinicId;
    }
}
