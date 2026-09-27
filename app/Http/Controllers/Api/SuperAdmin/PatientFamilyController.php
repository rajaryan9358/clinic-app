<?php

namespace App\Http\Controllers\Api\SuperAdmin;

use App\Http\Controllers\Concerns\ApiResponse;
use App\Http\Controllers\Controller;
use App\Models\Patient;
use App\Services\Patients\PatientFamilyLinkService;
use App\Services\Patients\PatientManagedByService;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class PatientFamilyController extends Controller
{
    use ApiResponse;

    public function __construct(
        private PatientManagedByService $managedBy,
        private PatientFamilyLinkService $familyLinks,
    ) {}

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

    public function storeFamilyLink(Request $request, string $id)
    {
        if ($id === '' || ! ctype_digit($id)) {
            abort(404);
        }

        $patient = Patient::findOrFail((int) $id);

        $data = $request->validate([
            'related_patient_id' => ['required', 'integer'],
            'relation' => ['nullable', 'string', 'max:50'],
        ]);

        try {
            $link = $this->familyLinks->create($patient, (int) $data['related_patient_id'], $data['relation'] ?? null);
        } catch (ValidationException $e) {
            $message = (string) collect($e->errors())->collapse()->first();

            return $this->error($message, $e->errors(), 422);
        }

        return $this->success('Family link created.', $link->load('relatedPatient:id,full_name,phone'), 201);
    }

    public function destroyFamilyLink(Request $request, string $id, string $linkId)
    {
        if ($id === '' || ! ctype_digit($id) || $linkId === '' || ! ctype_digit($linkId)) {
            abort(404);
        }

        $patient = Patient::findOrFail((int) $id);

        try {
            $this->familyLinks->delete($patient, (int) $linkId);
        } catch (ModelNotFoundException) {
            abort(404);
        }

        return $this->success('Family link removed.');
    }
}
