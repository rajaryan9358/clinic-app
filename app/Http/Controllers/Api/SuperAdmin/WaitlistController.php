<?php

namespace App\Http\Controllers\Api\SuperAdmin;

use App\Http\Controllers\Api\BaseStaffWaitlistController;
use Illuminate\Http\Request;

/**
 * Super-admin waitlist across clinics: `clinic_id` filters the list and
 * is required (with the patient and doctor in that clinic) to add.
 */
class WaitlistController extends BaseStaffWaitlistController
{
    protected function clinicId(Request $request): ?int
    {
        $data = $request->validate(['clinic_id' => ['nullable', 'integer']]);

        return isset($data['clinic_id']) ? (int) $data['clinic_id'] : null;
    }
}
