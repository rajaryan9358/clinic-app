<?php

namespace App\Http\Controllers\Api\Portal;

use App\Http\Controllers\Concerns\ApiResponse;
use App\Http\Controllers\Controller;
use App\Services\Portal\PortalOtpService;
use App\Support\Portal\PortalAccount;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class OtpController extends Controller
{
    use ApiResponse;

    public function __construct(private PortalOtpService $otp) {}

    public function requestCode(Request $request)
    {
        $data = $request->validate(['phone' => 'required|string']);

        $this->otp->request($data['phone']);

        return $this->success('If this number is registered, a code has been sent.');
    }

    public function verify(Request $request)
    {
        $data = $request->validate([
            'phone' => 'required|string',
            'code' => 'required|string',
            'patient_id' => 'nullable|integer',
        ]);

        try {
            $result = $this->otp->verify($data['phone'], $data['code'], $data['patient_id'] ?? null);
        } catch (ValidationException $e) {
            $errors = $e->errors();
            $message = (string) collect($errors)->collapse()->first();

            return $this->error($message, $errors, 422);
        }

        if ($result['status'] === 'choose') {
            return $this->success('Multiple profiles are linked to this number.', [
                'needs_selection' => true,
                'choices' => $result['choices'],
            ]);
        }

        $patient = $result['patient'];
        $token = $patient->createToken('portal', ['portal'], now()->addDays(30))->plainTextToken;

        return $this->success('Logged in.', [
            'token' => $token,
            'account' => PortalAccount::payload($patient),
        ]);
    }
}
