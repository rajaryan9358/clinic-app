<?php

namespace App\Http\Controllers\Api\SuperAdmin;

use App\Http\Controllers\Api\BaseCrudController;
use App\Models\BranchSetting;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;

class BranchSettingController extends BaseCrudController
{
    protected string $modelClass = BranchSetting::class;
    protected array $searchable = [];
    protected array $filterable = ['clinic_id', 'branch_id'];

    protected function baseQuery(Request $request): Builder
    {
        return parent::baseQuery($request)->with(['branch:id,name']);
    }

    public function store(Request $request)
    {
        $clinicId = $request->input('clinic_id');
        $branchId = $request->input('branch_id');
        if (! $clinicId) {
            return $this->error('clinic_id is required', null, 422);
        }
        if (! $branchId) {
            return $this->error('branch_id is required', null, 422);
        }

        $data = $request->all();
        $data['clinic_id'] = (int) $clinicId;
        $data['branch_id'] = (int) $branchId;

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
