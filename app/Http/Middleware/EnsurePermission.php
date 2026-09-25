<?php

namespace App\Http\Middleware;

use App\Support\PermissionCatalogue;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsurePermission
{
    public function handle(Request $request, Closure $next, string $permission): Response
    {
        $user = $request->user();
        if (! $user || ! $user->can($permission)) {
            return response()->json([
                'success' => false,
                'message' => "You don't have permission to ".PermissionCatalogue::label($permission).'.',
            ], 403);
        }

        return $next($request);
    }
}
