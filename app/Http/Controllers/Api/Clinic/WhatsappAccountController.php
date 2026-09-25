<?php

namespace App\Http\Controllers\Api\Clinic;

use App\Models\WhatsappAccount;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Validation\Rule;

class WhatsappAccountController extends BaseClinicCrudController
{
    protected string $modelClass = WhatsappAccount::class;
    protected array $searchable = ['business_name', 'phone_number', 'provider'];
    protected array $filterable = ['status', 'provider'];

    public function store(Request $request)
    {
        $clinicId = (int) ($request->attributes->get('clinic_id') ?? $request->user()?->clinic_id);

        $providerValues = ['meta', 'twilio', 'gupshup', 'interakt', 'other'];
        $statusValues = ['active', 'inactive', 'pending'];

        $data = $request->validate([
            'business_name' => ['nullable', 'string', 'max:255'],
            'phone_number' => ['required', 'string', 'max:20'],
            'provider' => ['required', Rule::in($providerValues)],
            'phone_number_id' => ['nullable', 'string', 'max:255'],
            'waba_id' => ['nullable', 'string', 'max:255'],
            'access_token' => ['nullable', 'string'],
            'webhook_verify_token' => ['nullable', 'string', 'max:255'],
            'status' => ['nullable', Rule::in($statusValues)],
        ]);

        $data['clinic_id'] = $clinicId;

        if (array_key_exists('access_token', $data)) {
            $token = $data['access_token'];
            $data['access_token_encrypted'] = ($token === null || $token === '') ? null : Crypt::encryptString((string) $token);
            unset($data['access_token']);
        }

        $model = WhatsappAccount::create($data);

        return $this->success('Record created successfully', $model, 201);
    }

    public function update(Request $request, int $id)
    {
        $model = $this->findModel($id);

        $providerValues = ['meta', 'twilio', 'gupshup', 'interakt', 'other'];
        $statusValues = ['active', 'inactive', 'pending'];

        $data = $request->validate([
            'business_name' => ['nullable', 'string', 'max:255'],
            'phone_number' => ['sometimes', 'required', 'string', 'max:20'],
            'provider' => ['sometimes', 'required', Rule::in($providerValues)],
            'phone_number_id' => ['nullable', 'string', 'max:255'],
            'waba_id' => ['nullable', 'string', 'max:255'],
            'access_token' => ['nullable', 'string'],
            'webhook_verify_token' => ['nullable', 'string', 'max:255'],
            'status' => ['nullable', Rule::in($statusValues)],
        ]);

        if (array_key_exists('access_token', $data)) {
            $token = $data['access_token'];
            $data['access_token_encrypted'] = ($token === null || $token === '') ? null : Crypt::encryptString((string) $token);
            unset($data['access_token']);
        }

        $model->update($data);

        return $this->success('Record updated successfully', $model->refresh());
    }
}
