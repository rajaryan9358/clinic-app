<?php

namespace App\Http\Controllers\Api\SuperAdmin;

use App\Http\Controllers\Api\BaseStaffInvoiceController;
use Illuminate\Http\Request;

/**
 * Super-admin invoices across clinics: `clinic_id` filters the list and lookups,
 * and is required to create.
 */
class InvoiceController extends BaseStaffInvoiceController
{
    protected function clinicId(Request $request): ?int
    {
        $data = $request->validate(['clinic_id' => ['nullable', 'integer']]);

        return isset($data['clinic_id']) ? (int) $data['clinic_id'] : null;
    }
}
