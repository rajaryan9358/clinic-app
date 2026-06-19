<?php

namespace App\Http\Controllers\Api\SuperAdmin;

use App\Http\Controllers\Api\BaseCrudController;
use App\Models\WhatsappAccount;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Validation\Rule;

class WhatsappAccountController extends BaseCrudController
{
    protected string $modelClass = WhatsappAccount::class;
    protected array $searchable = ['business_name', 'phone_number', 'provider'];
    protected array $filterable = ['clinic_id', 'branch_id', 'status', 'provider'];

    public function store(Request $request)
    {
        $data = $this->validatedData($request, isCreate: true);
        $model = WhatsappAccount::create($data);

        return $this->success('Record created successfully', $model, 201);
    }

    public function update(Request $request, int $id)
    {
        $model = $this->findModel($id);
        $data = $this->validatedData($request, isCreate: false, existingClinicId: (int) ($model->clinic_id ?? 0));
        $model->update($data);

        return $this->success('Record updated successfully', $model->refresh());
    }

    private function validatedData(Request $request, bool $isCreate, int $existingClinicId = 0): array
    {
        $statusValues = ['active', 'inactive', 'pending'];
        $providerValues = ['meta', 'twilio', 'gupshup', 'interakt', 'other'];

        $clinicIdForBranch = (int) ($request->input('clinic_id') ?: $existingClinicId);
        $branchExistsRule = Rule::exists('branches', 'id');
        if ($clinicIdForBranch) {
            $branchExistsRule = $branchExistsRule->where(fn ($q) => $q->where('clinic_id', $clinicIdForBranch));
        }

        $data = $request->validate([
            'clinic_id' => array_values(array_filter([
                $isCreate ? 'required' : 'sometimes',
                'integer',
                'exists:clinics,id',
            ])),
            'branch_id' => ['nullable', 'integer', $branchExistsRule],
            'business_name' => ['nullable', 'string', 'max:255'],
            'phone_number' => ['required', 'string', 'max:20'],
            'provider' => ['required', Rule::in($providerValues)],
            'phone_number_id' => ['nullable', 'string', 'max:255'],
            'waba_id' => ['nullable', 'string', 'max:255'],
            'access_token' => ['nullable', 'string'],
            'webhook_verify_token' => ['nullable', 'string', 'max:255'],
            'status' => ['nullable', Rule::in($statusValues)],
        ]);

        if (! $isCreate && array_key_exists('clinic_id', $data) && ! array_key_exists('branch_id', $data)) {
            $data['branch_id'] = null;
        }

        if (array_key_exists('access_token', $data)) {
            $token = $data['access_token'];
            $data['access_token_encrypted'] = ($token === null || $token === '') ? null : Crypt::encryptString((string) $token);
            unset($data['access_token']);
        }

        return $data;
    }
}
