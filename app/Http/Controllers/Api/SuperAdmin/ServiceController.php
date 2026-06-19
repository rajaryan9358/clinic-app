<?php

namespace App\Http\Controllers\Api\SuperAdmin;

use App\Http\Controllers\Api\BaseCrudController;
use App\Models\Branch;
use App\Models\Service;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;

class ServiceController extends BaseCrudController
{
    protected string $modelClass = Service::class;
    protected array $searchable = ['name', 'code'];
    protected array $filterable = ['clinic_id', 'status'];

    protected function baseQuery(Request $request): Builder
    {
        return parent::baseQuery($request)->with([
            'branches:id,name',
        ]);
    }

    public function store(Request $request)
    {
        $data = $request->all();

        $branchIds = isset($data['branch_ids']) && is_array($data['branch_ids'])
            ? array_map('intval', $data['branch_ids'])
            : null;
        unset($data['branch_ids']);

        $service = Service::create($data);

        if ($branchIds !== null && count($branchIds) > 0) {
            $payload = [];
            foreach ($branchIds as $branchId) {
                $payload[$branchId] = ['clinic_id' => (int) $service->clinic_id];
            }
            $service->branches()->sync($payload);
        }

        return $this->success('Record created successfully', $service->load(['branches:id,name']), 201);
    }

    public function syncBranches(Request $request, int $id)
    {
        $service = $this->findModel($id);

        $data = $request->validate([
            'branch_ids' => ['nullable', 'array'],
            'branch_ids.*' => ['integer', 'exists:branches,id'],
        ]);

        $branchIds = array_values(array_unique(array_map('intval', $data['branch_ids'] ?? [])));

        if (! empty($branchIds)) {
            $validCount = (int) \App\Models\Branch::query()
                ->where('clinic_id', (int) $service->clinic_id)
                ->whereIn('id', $branchIds)
                ->count();

            if ($validCount !== count($branchIds)) {
                return $this->error('One or more branches do not belong to this clinic', null, 422);
            }
        }

        $payload = [];
        foreach ($branchIds as $branchId) {
            $payload[$branchId] = ['clinic_id' => (int) $service->clinic_id];
        }
        $service->branches()->sync($payload);

        return $this->success(
            'Service branches updated successfully',
            $service->refresh()->load(['branches:id,name'])
        );
    }
}
