<?php

namespace App\Http\Controllers\Api\SuperAdmin;

use App\Http\Controllers\Api\BaseCrudController;
use App\Http\Requests\StoreBranchRequest;
use App\Http\Requests\UpdateBranchRequest;
use App\Models\Branch;
use App\Services\BranchService;

class BranchController extends BaseCrudController
{
    protected string $modelClass = Branch::class;

    protected array $searchable = ['name', 'code', 'city', 'state', 'email', 'phone'];

    protected array $filterable = ['clinic_id', 'status', 'is_main_branch'];

    public function __construct(private readonly BranchService $branchService) {}

    public function store(\Illuminate\Http\Request $request)
    {
        $data = validator($request->all(), (new StoreBranchRequest())->rules())->validate();
        $branch = $this->branchService->create($data);

        return $this->success('Branch created successfully', $branch, 201);
    }

    public function update(\Illuminate\Http\Request $request, int $id)
    {
        $branch = $this->findModel($id);
        $data = validator($request->all(), (new UpdateBranchRequest())->rules())->validate();
        $updated = $this->branchService->update($branch, $data);

        return $this->success('Branch updated successfully', $updated);
    }
}
