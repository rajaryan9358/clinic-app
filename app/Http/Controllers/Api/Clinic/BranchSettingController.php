<?php

namespace App\Http\Controllers\Api\Clinic;

use App\Models\Branch;
use App\Models\BranchSetting;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;

class BranchSettingController extends BaseClinicCrudController
{
    protected string $modelClass = BranchSetting::class;
    protected array $searchable = [];
    protected array $filterable = ['branch_id'];

    protected function baseQuery(Request $request): Builder
    {
        return parent::baseQuery($request)->with(['branch:id,name']);
    }

    public function index(Request $request)
    {
        $clinicId = (int) ($request->attributes->get('clinic_id') ?? $request->user()?->clinic_id);

        $branchIds = Branch::query()->where('clinic_id', $clinicId)->pluck('id');
        foreach ($branchIds as $branchId) {
            BranchSetting::query()->firstOrCreate(
                ['branch_id' => (int) $branchId],
                ['clinic_id' => $clinicId, 'branch_id' => (int) $branchId]
            );
        }

        return parent::index($request);
    }

    public function store(Request $request)
    {
        $role = (string) ($request->user()?->role ?? '');
        abort_if(in_array($role, ['receptionist', 'assistant', 'doctor'], true), 403, 'Not allowed.');

        $clinicId = $request->attributes->get('clinic_id') ?? $request->user()?->clinic_id;
        $clinicId = (int) $clinicId;

        $data = $request->all();
        $data['clinic_id'] = $clinicId;

        $branchId = $data['branch_id'] ?? null;
        if (! $branchId) {
            return $this->error('branch_id is required', null, 422);
        }

        $model = BranchSetting::query()->updateOrCreate(
            ['branch_id' => (int) $branchId],
            $data
        );

        return $this->success(
            $model->wasRecentlyCreated ? 'Record created successfully' : 'Record updated successfully',
            $model,
            $model->wasRecentlyCreated ? 201 : 200
        );
    }

    public function destroy(int $id)
    {
        return $this->error('Branch settings cannot be deleted directly', null, 403);
    }
}
