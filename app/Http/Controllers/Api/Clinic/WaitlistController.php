<?php

namespace App\Http\Controllers\Api\Clinic;

use App\Http\Controllers\Api\BaseStaffWaitlistController;
use Illuminate\Http\Request;

/** Clinic staff waitlist: always scoped to the signed-in user's clinic. */
class WaitlistController extends BaseStaffWaitlistController
{
    protected function clinicId(Request $request): ?int
    {
        return (int) ($request->attributes->get('clinic_id') ?? $request->user()?->clinic_id);
    }
}
