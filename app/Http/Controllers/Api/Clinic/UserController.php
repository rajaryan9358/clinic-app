<?php

namespace App\Http\Controllers\Api\Clinic;

use App\Http\Requests\StatusChangeRequest;
use App\Models\Role;
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
     * Role names manageable through this controller: staff and clinic_admin kinds.
     * Doctor-kind and super_admin-kind users are managed elsewhere (doctor onboarding
     * / super admin console) and never appear here.
     */
    private function manageableRoleNames(): array
    {
        return Role::query()
            ->where('guard_name', 'web')
            ->whereIn('kind', ['staff', 'clinic_admin'])
            ->pluck('name')
            ->all();
    }

    /**
     * A non-admin editor (staff kind) may not update/delete/block a clinic_admin-kind
     * user, nor a user whose current role carries any permission the editor doesn't
     * hold themselves — otherwise a staff.create/staff.edit holder could take over a
     * more privileged account (e.g. reset its password and log in as it). Self-edits
     * are exempt here since the actor's and target's permissions are identical; they
     * remain governed by assertNotWideningOwnAccess. clinic_admin and super_admin
     * actors are unrestricted.
     */
    private function assertCanMutate(User $actor, User $target): void
    {
        if (in_array($actor->roleKind(), ['clinic_admin', 'super_admin'], true)) {
            return;
        }

        if ($target->roleKind() === 'clinic_admin') {
            abort(403, "You can't change a clinic admin.");
        }

        if ((int) $actor->id === (int) $target->id) {
            return;
        }

        $targetPermissions = $target->roleModel()?->permissions->pluck('name') ?? collect();
        $actorPermissions = $actor->getAllPermissions()->pluck('name');

        if ($targetPermissions->diff($actorPermissions)->isNotEmpty()) {
            abort(403, "You can't change a user with more access than you.");
        }
    }

    /**
     * A non-admin editor may not change their own `role`, nor widen the set of doctors
     * they're assigned to (a role with limit_to_assigned_doctors would otherwise be able
     * to grant itself a broader data scope). Resubmitting the same doctor_ids (e.g. a
     * full-form save that also changes full_name) is fine — only a genuine set change
     * is rejected. clinic_admin/super_admin actors are unrestricted.
     */
    private function assertNotWideningOwnAccess(User $actor, User $target, array $data): void
    {
        if ((int) $actor->id !== (int) $target->id) {
            return;
        }

        if (in_array($actor->roleKind(), ['clinic_admin', 'super_admin'], true)) {
            return;
        }

        $changingRole = array_key_exists('role', $data) && $data['role'] !== $target->role;

        $changingDoctorIds = false;
        if (array_key_exists('doctor_ids', $data)) {
            $submitted = $this->normalizeDoctorIds(is_array($data['doctor_ids']) ? $data['doctor_ids'] : []);
            $current = $this->normalizeDoctorIds($target->assignedDoctors->pluck('id')->all());
            $changingDoctorIds = $submitted !== $current;
        }

        if ($changingRole || $changingDoctorIds) {
            abort(403, "You can't change your own access.");
        }
    }

    /** @param array<int, int|string> $ids */
    private function normalizeDoctorIds(array $ids): array
    {
        $ids = array_map('intval', $ids);
        $ids = array_values(array_unique($ids));
        sort($ids);

        return $ids;
    }

    protected function baseQuery(Request $request): Builder
    {
        $query = parent::baseQuery($request);
        $query->whereIn('role', $this->manageableRoleNames());

        return $query;
    }

    protected function findModel(int $id): Model
    {
        /** @var \App\Models\User $user */
        $user = parent::findModel($id);

        abort_if(! in_array((string) $user->role, $this->manageableRoleNames(), true), 404);

        return $user;
    }

    public function store(Request $request)
    {
        $data = validator($request->all(), [
            'full_name' => ['required', 'string', 'max:255'],
            'email' => ['nullable', 'email', 'required_without:phone'],
            'phone' => ['nullable', 'string', 'max:20', 'required_without:email'],
            'password' => ['required', 'string', 'min:8'],
            'role' => ['required', 'string', 'exists:roles,name'],
            'status' => ['nullable', Rule::in(['active', 'inactive', 'blocked'])],
            'doctor_ids' => ['nullable', 'array'],
            'doctor_ids.*' => ['integer', 'exists:doctors,id'],
        ])->validate();
        $data['clinic_id'] = $request->attributes->get('clinic_id');

        $user = $this->userManagementService->create($data, $request->user());

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
        $actor = $request->user();

        $this->assertCanMutate($actor, $user);

        $data = validator($request->all(), [
            'full_name' => ['sometimes', 'string', 'max:255'],
            'email' => ['sometimes', 'nullable', 'email'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:20'],
            'password' => ['sometimes', 'nullable', 'string', 'min:8'],
            'role' => ['sometimes', 'string', 'exists:roles,name'],
            'status' => ['sometimes', 'nullable', Rule::in(['active', 'inactive', 'blocked'])],
            'login_type' => ['sometimes', 'nullable', Rule::in(['password', 'otp'])],
            'doctor_ids' => ['sometimes', 'array'],
            'doctor_ids.*' => ['integer', 'exists:doctors,id'],
        ])->validate();

        $this->assertNotWideningOwnAccess($actor, $user, $data);

        $updated = $this->userManagementService->update($user, $data, $actor);

        $updated->loadMissing('assignedDoctors:id');
        $data = $updated->toArray();
        $data['doctor_ids'] = $updated->assignedDoctors->pluck('id')->values()->all();

        return $this->success('Record updated successfully', $data);
    }

    public function destroy(int $id)
    {
        /** @var \App\Models\User $user */
        $user = $this->findModel($id);
        $this->assertCanMutate(request()->user(), $user);

        return parent::destroy($id);
    }

    public function changeStatus(StatusChangeRequest $request, int $id)
    {
        /** @var \App\Models\User $user */
        $user = $this->findModel($id);
        $this->assertCanMutate($request->user(), $user);

        return parent::changeStatus($request, $id);
    }

    protected function toggleBlock(int $id, string $status)
    {
        /** @var \App\Models\User $user */
        $user = $this->findModel($id);
        $this->assertCanMutate(request()->user(), $user);

        return parent::toggleBlock($id, $status);
    }

    public function restore(int $id)
    {
        /** @var \App\Models\User $user */
        $user = $this->findModel($id);
        $this->assertCanMutate(request()->user(), $user);

        $user->restore();

        return $this->success('Record restored successfully', $user->refresh());
    }
}
