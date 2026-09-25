<?php

namespace App\Http\Controllers\Api\Clinic;

use App\Http\Controllers\Concerns\ApiResponse;
use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
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
}
