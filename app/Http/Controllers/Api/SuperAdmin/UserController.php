<?php

namespace App\Http\Controllers\Api\SuperAdmin;

use App\Http\Controllers\Api\BaseCrudController;
use App\Http\Requests\StoreUserRequest;
use App\Http\Requests\UpdateUserRequest;
use App\Models\User;
use App\Services\UserManagementService;
use Illuminate\Http\Request;

class UserController extends BaseCrudController
{
    protected string $modelClass = User::class;

    protected array $searchable = ['full_name', 'email', 'phone'];

    protected array $filterable = ['clinic_id', 'role', 'status'];

    public function __construct(private readonly UserManagementService $userManagementService) {}

    public function store(Request $request)
    {
        $data = validator($request->all(), (new StoreUserRequest())->rules())->validate();
        $user = $this->userManagementService->create($data);

        return $this->success('User created successfully', $user, 201);
    }

    public function resetPassword(Request $request, int $id)
    {
        $request->validate(['password' => ['required', 'string', 'min:8']]);
        $user = $this->findModel($id);
        $this->userManagementService->resetPassword($user, $request->string('password')->toString());

        return $this->success('Password reset successfully');
    }

    public function show(int $id)
    {
        /** @var \App\Models\User $user */
        $user = $this->findModel($id);

        $data = $user->toArray();

        return $this->success('Record fetched successfully', $data);
    }

    public function update(Request $request, int $id)
    {
        $data = validator($request->all(), (new UpdateUserRequest())->rules())->validate();

        /** @var \App\Models\User $user */
        $user = $this->findModel($id);
        $updated = $this->userManagementService->update($user, $data);

        $data = $updated->toArray();

        return $this->success('Record updated successfully', $data);
    }
}
