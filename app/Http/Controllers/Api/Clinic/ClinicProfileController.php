<?php

namespace App\Http\Controllers\Api\Clinic;

use App\Http\Controllers\Concerns\ApiResponse;
use App\Http\Controllers\Controller;
use App\Models\Clinic;
use Illuminate\Http\Request;

class ClinicProfileController extends Controller
{
    use ApiResponse;

    private function getClinic(Request $request): Clinic
    {
        $clinicId = (int) ($request->attributes->get('clinic_id') ?? $request->user()?->clinic_id);

        return Clinic::findOrFail($clinicId);
    }

    public function show(Request $request)
    {
        return $this->success('Clinic profile fetched', $this->getClinic($request));
    }

    public function update(Request $request)
    {
        $clinic = $this->getClinic($request);

        $data = validator($request->all(), [
            'logo_url'        => ['nullable', 'string', 'max:500'],
            'name'            => ['sometimes', 'string', 'max:255'],
            'primary_color'   => ['nullable', 'string', 'max:20'],
            'secondary_color' => ['nullable', 'string', 'max:20'],
            'address_line_1'  => ['nullable', 'string', 'max:255'],
            'address_line_2'  => ['nullable', 'string', 'max:255'],
            'city'            => ['nullable', 'string', 'max:120'],
            'state'           => ['nullable', 'string', 'max:120'],
            'pincode'         => ['nullable', 'string', 'max:20'],
            'phone'           => ['nullable', 'string', 'max:20'],
            'email'           => ['nullable', 'email', 'max:255'],
        ])->validate();

        $clinic->update($data);

        return $this->success('Clinic profile updated', $clinic->refresh());
    }
}
