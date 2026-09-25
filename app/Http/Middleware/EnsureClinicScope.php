<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureClinicScope
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (! $user) {
            abort(401, 'Unauthenticated');
        }

        if ($user->roleKind() === 'super_admin') {
            return $next($request);
        }

        if (! $user->clinic_id) {
            abort(403, 'Clinic scope missing for user.');
        }

        $request->attributes->set('clinic_id', $user->clinic_id);

        return $next($request);
    }
}
