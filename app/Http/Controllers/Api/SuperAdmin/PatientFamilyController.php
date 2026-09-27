<?php

namespace App\Http\Controllers\Api\SuperAdmin;

use App\Http\Controllers\Concerns\ApiResponse;
use App\Http\Controllers\Controller;
use App\Models\Patient;
use App\Services\Patients\PatientManagedByService;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class PatientFamilyController extends Controller
{
    use ApiResponse;

    public function __construct(private PatientManagedByService $managedBy) {}

    public function updateManagedBy(Request $request, string $id)
    {
        if ($id === '' || ! ctype_digit($id)) {
            abort(404);
        }

        $patient = Patient::findOrFail((int) $id);

        $data = $request->validate([
            'managed_by_patient_id' => ['nullable', 'integer'],
        ]);

        try {
            $this->managedBy->update($patient, $data['managed_by_patient_id'] ?? null);
        } catch (ValidationException $e) {
            $message = (string) collect($e->errors())->collapse()->first();

            return $this->error($message, $e->errors(), 422);
        }

        return $this->success('Updated.', ['managed_by_patient_id' => $patient->managed_by_patient_id]);
    }
}
