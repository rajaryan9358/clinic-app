<?php

namespace App\Http\Controllers\Api\Clinic;

use App\Http\Controllers\Concerns\ApiResponse;
use App\Http\Controllers\Controller;
use App\Models\Patient;
use App\Services\Portal\PortalLinkService;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class PatientPortalLinkController extends Controller
{
    use ApiResponse;

    public function __construct(private PortalLinkService $links) {}

    public function store(Request $request, string $id)
    {
        if ($id === '' || ! ctype_digit($id)) {
            abort(404);
        }

        $clinicId = (int) ($request->attributes->get('clinic_id') ?? $request->user()?->clinic_id);

        $patient = Patient::where('clinic_id', $clinicId)->findOrFail((int) $id);

        try {
            $result = $this->links->issue($patient, $request->user()?->id);
        } catch (ValidationException $e) {
            $message = (string) collect($e->errors())->collapse()->first();

            return $this->error($message, $e->errors(), 422);
        }

        return $this->success('Login link sent.', [
            'url' => $result['url'],
            'expires_at' => $result['expires_at'],
            'whatsapp' => [
                'id' => $result['whatsapp']->id,
                'delivery_status' => $result['whatsapp']->delivery_status,
            ],
        ], 201);
    }
}
