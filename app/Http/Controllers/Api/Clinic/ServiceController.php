<?php

namespace App\Http\Controllers\Api\Clinic;

use App\Models\Service;
use Illuminate\Http\Request;

class ServiceController extends BaseClinicCrudController
{
    protected string $modelClass = Service::class;
    protected array $searchable = ['name', 'code'];
    protected array $filterable = ['status'];

    public function store(Request $request)
    {
        $data = $request->all();
        $data['clinic_id'] = $request->attributes->get('clinic_id') ?? $request->user()?->clinic_id;

        $activeBranchId = $request->attributes->get('active_branch_id');
        if ($activeBranchId && empty($data['branch_ids'])) {
            $data['branch_ids'] = [(int) $activeBranchId];
        }

        $branchIds = isset($data['branch_ids']) && is_array($data['branch_ids'])
            ? array_map('intval', $data['branch_ids'])
            : null;
        unset($data['branch_ids']);

        $service = Service::create($data);

        if ($branchIds !== null && count($branchIds) > 0) {
            $service->branches()->sync($branchIds);
        }

        return $this->success('Record created successfully', $service, 201);
    }
}
