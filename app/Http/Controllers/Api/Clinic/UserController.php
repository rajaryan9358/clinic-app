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

    private function assertCanManageUsers(Request $request): void
    {
        $role = (string) ($request->user()?->role ?? '');
        abort_if(in_array($role, ['receptionist', 'assistant', 'doctor'], true), 403, 'Not allowed.');
    }

    private function allowedTargetRoles(string $actorRole): array
    {
        return match ($actorRole) {
            'clinic_admin' => ['branch_manager', 'receptionist', 'assistant'],
            'branch_manager' => ['receptionist', 'assistant'],
            default => [],
        };
    }

    protected function baseQuery(Request $request): Builder
    {
        $query = parent::baseQuery($request);

        $this->assertCanManageUsers($request);

        $actorRole = (string) ($request->user()?->role ?? '');
        $allowedRoles = $this->allowedTargetRoles($actorRole);
        if (count($allowedRoles) > 0) {
            $query->whereIn('role', $allowedRoles);
        }

        return $query;
    }

    protected function findModel(int $id): Model
    {
        /** @var \App\Models\User $user */
        $user = parent::findModel($id);

        $request = request();
        $this->assertCanManageUsers($request);

        $actorRole = (string) ($request->user()?->role ?? '');
        $allowedManageRoles = $this->allowedTargetRoles($actorRole);
        abort_if(! in_array((string) $user->role, $allowedManageRoles, true), 403, 'Not allowed.');

        return $user;
    }

    public function index(Request $request)
    {
        $this->assertCanManageUsers($request);

        return parent::index($request);
    }

    public function store(Request $request)
    {
            $this->assertCanManageUsers($request);

            $actorRole = (string) ($request->user()?->role ?? '');
            $allowedRoles = $this->allowedTargetRoles($actorRole);
            abort_if(count($allowedRoles) === 0, 403, 'Not allowed.');

            $data = validator($request->all(), [
                'full_name' => ['required', 'string', 'max:255'],
                'email' => ['nullable', 'email', 'required_without:phone'],
                'phone' => ['nullable', 'string', 'max:20', 'required_without:email'],
                'password' => ['required', 'string', 'min:8'],
                'role' => ['required', Rule::in($allowedRoles)],
                'status' => ['nullable', Rule::in(['active', 'inactive', 'blocked'])],
                'branch_ids' => ['nullable', 'array'],
                'branch_ids.*' => ['integer', 'exists:branches,id'],
                'doctor_ids' => ['nullable', 'array'],
                'doctor_ids.*' => ['integer', 'exists:doctors,id'],
            ])->validate();
        $data['clinic_id'] = $request->attributes->get('clinic_id');

        $activeBranchId = $request->attributes->get('active_branch_id');
        if ($activeBranchId && empty($data['branch_ids'])) {
            $data['branch_ids'] = [(int) $activeBranchId];
        }

        $user = $this->userManagementService->create($data);

        return $this->success('User created successfully', $user, 201);
    }

    public function show(int $id)
    {
            $this->assertCanManageUsers(request());

        /** @var \App\Models\User $user */
        $user = $this->findModel($id);
        $user->loadMissing('branches:id', 'assignedDoctors:id');

        $data = $user->toArray();
        $data['branch_ids'] = $user->branches->pluck('id')->values()->all();
        $data['doctor_ids'] = $user->assignedDoctors->pluck('id')->values()->all();

        return $this->success('Record fetched successfully', $data);
    }

    public function update(Request $request, int $id)
    {
            $this->assertCanManageUsers($request);

        /** @var \App\Models\User $user */
        $user = $this->findModel($id);

            $actorRole = (string) ($request->user()?->role ?? '');
            $allowedManageRoles = $this->allowedTargetRoles($actorRole);
            abort_if(! in_array((string) $user->role, $allowedManageRoles, true), 403, 'Not allowed.');

            $data = validator($request->all(), [
                'full_name' => ['sometimes', 'string', 'max:255'],
                'email' => ['sometimes', 'nullable', 'email'],
                'phone' => ['sometimes', 'nullable', 'string', 'max:20'],
                'password' => ['sometimes', 'nullable', 'string', 'min:8'],
                'role' => ['sometimes', Rule::in($allowedManageRoles)],
                'status' => ['sometimes', 'nullable', Rule::in(['active', 'inactive', 'blocked'])],
                'login_type' => ['sometimes', 'nullable', Rule::in(['password', 'otp'])],
                'branch_ids' => ['sometimes', 'array'],
                'branch_ids.*' => ['integer', 'exists:branches,id'],
                'doctor_ids' => ['sometimes', 'array'],
                'doctor_ids.*' => ['integer', 'exists:doctors,id'],
            ])->validate();

            $updated = $this->userManagementService->update($user, $data);

        $updated->loadMissing('branches:id', 'assignedDoctors:id');
        $data = $updated->toArray();
        $data['branch_ids'] = $updated->branches->pluck('id')->values()->all();
        $data['doctor_ids'] = $updated->assignedDoctors->pluck('id')->values()->all();

        return $this->success('Record updated successfully', $data);
    }

        public function destroy(int $id)
        {
            $this->assertCanManageUsers(request());

            return parent::destroy($id);
        }
}
