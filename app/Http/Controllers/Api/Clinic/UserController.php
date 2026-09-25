<?php

namespace App\Http\Controllers\Api\Clinic;

use App\Models\User;
use App\Services\UserManagementService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class UserController extends BaseClinicCrudController
{
    protected string $modelClass = User::class;
    protected array $searchable = ['full_name', 'email', 'phone'];
    protected array $filterable = ['role', 'status'];

    public function __construct(private readonly UserManagementService $userManagementService) {}

    /**
     * Roles a staff manager may list/create/edit. The route's staff.* permission
     * decides who may manage staff at all; Task 4 replaces this list with the
     * clinic's assignable roles.
     */
    private function allowedTargetRoles(): array
    {
        return ['receptionist', 'assistant'];
    }

    protected function baseQuery(Request $request): Builder
    {
        $query = parent::baseQuery($request);

        $allowedRoles = $this->allowedTargetRoles();
        $query->whereIn('role', $allowedRoles);

        return $query;
    }

    protected function findModel(int $id): Model
    {
        /** @var \App\Models\User $user */
        $user = parent::findModel($id);

        $allowedManageRoles = $this->allowedTargetRoles();
        abort_if(! in_array((string) $user->role, $allowedManageRoles, true), 403, 'Not allowed.');

        return $user;
    }

    public function store(Request $request)
    {
            $allowedRoles = $this->allowedTargetRoles();

            $data = validator($request->all(), [
                'full_name' => ['required', 'string', 'max:255'],
                'email' => ['nullable', 'email', 'required_without:phone'],
                'phone' => ['nullable', 'string', 'max:20', 'required_without:email'],
                'password' => ['required', 'string', 'min:8'],
                'role' => ['required', Rule::in($allowedRoles)],
                'status' => ['nullable', Rule::in(['active', 'inactive', 'blocked'])],
                'doctor_ids' => ['nullable', 'array'],
                'doctor_ids.*' => ['integer', 'exists:doctors,id'],
            ])->validate();
        $data['clinic_id'] = $request->attributes->get('clinic_id');

        $user = $this->userManagementService->create($data);

        return $this->success('User created successfully', $user, 201);
    }

    public function show(int $id)
    {
        /** @var \App\Models\User $user */
        $user = $this->findModel($id);
        $user->loadMissing('assignedDoctors:id');

        $data = $user->toArray();
        $data['doctor_ids'] = $user->assignedDoctors->pluck('id')->values()->all();

        return $this->success('Record fetched successfully', $data);
    }

    public function update(Request $request, int $id)
    {
        /** @var \App\Models\User $user */
        $user = $this->findModel($id);

            $allowedManageRoles = $this->allowedTargetRoles();
            abort_if(! in_array((string) $user->role, $allowedManageRoles, true), 403, 'Not allowed.');

            $data = validator($request->all(), [
                'full_name' => ['sometimes', 'string', 'max:255'],
                'email' => ['sometimes', 'nullable', 'email'],
                'phone' => ['sometimes', 'nullable', 'string', 'max:20'],
                'password' => ['sometimes', 'nullable', 'string', 'min:8'],
                'role' => ['sometimes', Rule::in($allowedManageRoles)],
                'status' => ['sometimes', 'nullable', Rule::in(['active', 'inactive', 'blocked'])],
                'login_type' => ['sometimes', 'nullable', Rule::in(['password', 'otp'])],
                'doctor_ids' => ['sometimes', 'array'],
                'doctor_ids.*' => ['integer', 'exists:doctors,id'],
            ])->validate();

            $updated = $this->userManagementService->update($user, $data);

        $updated->loadMissing('assignedDoctors:id');
        $data = $updated->toArray();
        $data['doctor_ids'] = $updated->assignedDoctors->pluck('id')->values()->all();

        return $this->success('Record updated successfully', $data);
    }

}
