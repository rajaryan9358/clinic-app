<?php

namespace App\Http\Controllers\Api\Clinic;

use App\Http\Requests\StoreBranchRequest;
use App\Http\Requests\UpdateBranchRequest;
use App\Models\Branch;
use App\Services\BranchService;
use Illuminate\Http\Request;

class BranchController extends BaseClinicCrudController
{
    protected string $modelClass = Branch::class;
    protected array $searchable = ['name', 'code', 'city', 'state', 'email', 'phone'];
    protected array $filterable = ['status', 'is_main_branch'];

    public function __construct(private readonly BranchService $branchService) {}

    public function store(Request $request)
    {
        return $this->error('Only super admin can create branches', null, 403);

        $request->merge([
            'clinic_id' => $request->attributes->get('clinic_id'),
        ]);

        $data = validator($request->all(), (new StoreBranchRequest())->rules())->validate();
        $data['clinic_id'] = $request->attributes->get('clinic_id');
        $branch = $this->branchService->create($data);

        return $this->success('Branch created successfully', $branch, 201);
    }

    public function update(Request $request, int $id)
    {
        $branch = $this->findModel($id);
        abort_if($branch->clinic_id !== (int) $request->attributes->get('clinic_id'), 403);
        $data = validator($request->all(), (new UpdateBranchRequest())->rules())->validate();
        $updated = $this->branchService->update($branch, $data);

        return $this->success('Branch updated successfully', $updated);
    }
}
