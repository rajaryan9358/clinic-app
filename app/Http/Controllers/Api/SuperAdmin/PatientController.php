<?php

namespace App\Http\Controllers\Api\SuperAdmin;

use App\Http\Controllers\Api\BaseCrudController;
use App\Models\Patient;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;

class PatientController extends BaseCrudController
{
    protected string $modelClass = Patient::class;
    protected array $searchable = ['full_name', 'first_name', 'last_name', 'phone', 'email'];
    protected array $filterable = ['clinic_id', 'branch_id', 'status_tag', 'preferred_doctor_id'];

    protected function baseQuery(Request $request): Builder
    {
        return parent::baseQuery($request)->with([
            'clinic:id,name',
            'branch:id,name',
        ]);
    }

    public function show(int $id)
    {
        $request = request();
        $query = $this->baseQuery($request);
        if ($this->supportsSoftDeletes()) {
            $query->withTrashed();
        }

        $model = $query->findOrFail($id);

        return $this->success('Record fetched successfully', $model);
    }
}
