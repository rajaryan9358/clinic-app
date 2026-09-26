<?php

namespace App\Http\Controllers\Api\Clinic;

use App\Http\Controllers\Concerns\ApiResponse;
use App\Http\Controllers\Controller;
use App\Models\Role;
use Illuminate\Http\Request;

class RolePermissionController extends Controller
{
    use ApiResponse;

    /**
     * Assignable roles for the clinic staff form: staff-kind roles for everyone,
     * plus clinic_admin-kind roles when the actor is themselves clinic_admin (or
     * super_admin) kind. Doctor-kind and super_admin-kind roles are never listed
     * here (spec §4).
     */
    public function roles(Request $request)
    {
        // `?kind=doctor` is a narrow, additive exception for the doctor
        // onboarding form's optional "Login role" picker (Task 7): it lists
        // doctor-kind roles only, never clinic_admin or the hidden
        // super_admin role, and leaves the default listing below untouched.
        if ($request->query('kind') === 'doctor') {
            $roles = Role::query()
                ->where('guard_name', 'web')
                ->where('kind', 'doctor')
                ->orderBy('label')
                ->get(['name', 'label', 'kind', 'limit_to_assigned_doctors']);

            return $this->success('Roles fetched successfully', $roles);
        }

        $kinds = ['staff'];
        if (in_array($request->user()?->roleKind(), ['clinic_admin', 'super_admin'], true)) {
            $kinds[] = 'clinic_admin';
        }

        $roles = Role::query()
            ->where('guard_name', 'web')
            ->whereIn('kind', $kinds)
            ->orderBy('label')
            ->get(['name', 'label', 'kind', 'limit_to_assigned_doctors']);

        return $this->success('Roles fetched successfully', $roles);
    }
}
