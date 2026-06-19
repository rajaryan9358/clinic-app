<?php

namespace App\Http\Controllers\Api\SuperAdmin;

use App\Http\Controllers\Concerns\ApiResponse;
use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;

class RolePermissionController extends Controller
{
    use ApiResponse;

    public function roles(Request $request)
    {
        $roles = Role::with('permissions')->paginate((int) $request->input('per_page', 15));

        return $this->paginated('Roles fetched successfully', $roles);
    }

    public function permissions(Request $request)
    {
        $permissions = Permission::query()->paginate((int) $request->input('per_page', 50));

        return $this->paginated('Permissions fetched successfully', $permissions);
    }

    public function createRole(Request $request)
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'permissions' => ['nullable', 'array'],
        ]);

        $role = Role::create(['name' => $validated['name'], 'guard_name' => 'web']);
        if (! empty($validated['permissions'])) {
            $role->syncPermissions($validated['permissions']);
        }

        return $this->success('Role created successfully', $role->load('permissions'), 201);
    }

    public function syncRolePermissions(Request $request, int $roleId)
    {
        $validated = $request->validate([
            'permissions' => ['required', 'array'],
        ]);

        $role = Role::findOrFail($roleId);
        if ($role->name === 'super_admin' && $request->user()?->role !== 'super_admin') {
            return $this->error('Not allowed', null, 403);
        }

        $role->syncPermissions($validated['permissions']);

        return $this->success('Role permissions updated successfully', $role->load('permissions'));
    }
}
