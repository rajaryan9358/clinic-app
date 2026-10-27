<?php

namespace App\Http\Controllers\Api\SuperAdmin;

use App\Http\Controllers\Concerns\ApiResponse;
use App\Http\Controllers\Controller;
use App\Models\Role;
use App\Models\User;
use App\Support\PermissionCatalogue;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Spatie\Permission\PermissionRegistrar;

class RoleController extends Controller
{
    use ApiResponse;

    /**
     * Roles managed by this controller: everything except the hidden super_admin
     * role, which never appears in the builder (spec §5).
     */
    private function findRole(int $id): ?Role
    {
        return Role::query()->where('guard_name', 'web')->where('kind', '!=', 'super_admin')->find($id);
    }

    public function index()
    {
        $roles = Role::query()
            ->with('permissions')
            ->where('guard_name', 'web')
            ->where('kind', '!=', 'super_admin')
            ->orderBy('label')
            ->get();

        return $this->success('Roles fetched successfully', $roles->map(fn (Role $role) => $this->present($role))->all());
    }

    public function catalogue()
    {
        $modules = collect(PermissionCatalogue::modules())
            ->map(fn (array $def, string $key) => ['key' => $key, 'label' => $def['label'], 'actions' => $def['actions']])
            ->values()->all();

        $specials = collect(PermissionCatalogue::specials())
            ->map(fn (array $def, string $name) => ['name' => $name, 'label' => $def['label'], 'module' => $def['module'], 'group' => $def['group'] ?? null])
            ->values()->all();

        return $this->success('Permission catalogue fetched successfully', ['modules' => $modules, 'specials' => $specials]);
    }

    public function store(Request $request)
    {
        $data = validator($request->all(), [
            'label' => ['required', 'string', 'max:60'],
            'kind' => ['required', Rule::in(['staff', 'doctor'])],
            'limit_to_assigned_doctors' => ['nullable', 'boolean'],
            'description' => ['nullable', 'string', 'max:500'],
            'permissions' => ['nullable', 'array'],
            'permissions.*' => [Rule::in(PermissionCatalogue::all())],
        ])->validate();

        $name = Str::slug($data['label'], '_');
        if (Role::query()->where('name', $name)->exists()) {
            return $this->error('A role with this name already exists.');
        }

        $limitToAssignedDoctors = $data['kind'] === 'doctor' ? false : (bool) ($data['limit_to_assigned_doctors'] ?? false);

        $role = Role::create([
            'name' => $name,
            'guard_name' => 'web',
            'label' => $data['label'],
            'kind' => $data['kind'],
            'limit_to_assigned_doctors' => $limitToAssignedDoctors,
            'is_system' => false,
            'description' => $data['description'] ?? null,
        ]);
        $role->syncPermissions($data['permissions'] ?? []);

        app(PermissionRegistrar::class)->forgetCachedPermissions();

        return $this->success('Role created successfully', $this->present($role->load('permissions')), 201);
    }

    public function update(Request $request, int $id)
    {
        $role = $this->findRole($id);
        if (! $role) {
            return $this->error('Role not found.', null, 404);
        }

        if ($role->name === 'clinic_admin' && $request->has('permissions')) {
            return $this->error('Clinic Admin always has full access.');
        }

        if ($request->has('kind') && $request->input('kind') !== $role->kind) {
            return $this->error("A role's kind can't be changed after it's created.");
        }

        $data = validator($request->all(), [
            'label' => ['sometimes', 'string', 'max:60'],
            'limit_to_assigned_doctors' => ['sometimes', 'nullable', 'boolean'],
            'description' => ['sometimes', 'nullable', 'string', 'max:500'],
            'permissions' => ['sometimes', 'array'],
            'permissions.*' => [Rule::in(PermissionCatalogue::all())],
        ])->validate();

        // name and kind are set once at creation and are never touched here (both immutable).
        if (array_key_exists('label', $data)) {
            $role->label = $data['label'];
        }
        if (array_key_exists('description', $data)) {
            $role->description = $data['description'];
        }
        if (array_key_exists('limit_to_assigned_doctors', $data)) {
            $role->limit_to_assigned_doctors = (bool) $data['limit_to_assigned_doctors'];
        }
        if ($role->kind === 'doctor') {
            $role->limit_to_assigned_doctors = false;
        }
        $role->save();

        if (array_key_exists('permissions', $data)) {
            $role->syncPermissions($data['permissions']);
        }

        app(PermissionRegistrar::class)->forgetCachedPermissions();

        return $this->success('Role updated successfully', $this->present($role->load('permissions')));
    }

    public function destroy(int $id)
    {
        $role = $this->findRole($id);
        if (! $role) {
            return $this->error('Role not found.', null, 404);
        }

        if ($role->is_system) {
            return $this->error("Built-in roles can't be deleted.");
        }

        $usersCount = User::where('role', $role->name)->count();
        if ($usersCount > 0) {
            return $this->error("Move its {$usersCount} users to another role first.");
        }

        $role->delete();

        app(PermissionRegistrar::class)->forgetCachedPermissions();

        return $this->success('Role deleted successfully');
    }

    private function present(Role $role): array
    {
        return [
            'id' => $role->id,
            'name' => $role->name,
            'label' => $role->label,
            'kind' => $role->kind,
            'limit_to_assigned_doctors' => (bool) $role->limit_to_assigned_doctors,
            'is_system' => (bool) $role->is_system,
            'description' => $role->description,
            'permissions' => $role->permissions->pluck('name')->values()->all(),
            'users_count' => User::where('role', $role->name)->count(),
        ];
    }
}
