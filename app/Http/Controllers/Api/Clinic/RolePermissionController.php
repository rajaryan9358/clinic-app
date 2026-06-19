<?php

namespace App\Http\Controllers\Api\Clinic;

use App\Http\Controllers\Concerns\ApiResponse;
use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;

class RolePermissionController extends Controller
{
    use ApiResponse;

    private array $protectedRoles = ['super_admin'];

    public function roles(Request $request)
    {
        $roles = Role::whereNotIn('name', $this->protectedRoles)
            ->with('permissions')
            ->paginate((int) $request->input('per_page', 15));

        return $this->paginated('Roles fetched successfully', $roles);
    }

    public function permissions(Request $request)
    {
        $permissions = Permission::query()->paginate((int) $request->input('per_page', 50));

        return $this->paginated('Permissions fetched successfully', $permissions);
    }

    public function syncRolePermissions(Request $request, int $roleId)
    {
        $request->validate(['permissions' => ['required', 'array']]);

        $role = Role::findOrFail($roleId);
        if (in_array($role->name, $this->protectedRoles, true)) {
            return $this->error('Cannot modify protected roles', null, 403);
        }

        $role->syncPermissions($request->input('permissions'));

        return $this->success('Role permissions updated successfully', $role->load('permissions'));
    }
}
