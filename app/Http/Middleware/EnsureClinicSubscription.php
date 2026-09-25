<?php

namespace App\Http\Middleware;

use App\Models\Clinic;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureClinicSubscription
{
    private const ALWAYS_ALLOWED = [
        ['GET', 'api/clinic/me/context'],
        ['GET', 'api/clinic/subscription'],
        ['POST', 'api/clinic/subscription/checkout'],
        ['POST', 'api/clinic/subscription/verify'],
    ];

    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        if (! $user || $user->role === 'super_admin') {
            return $next($request);
        }

        foreach (self::ALWAYS_ALLOWED as [$method, $path]) {
            if ($request->isMethod($method) && $request->is($path)) {
                return $next($request);
            }
        }

        $clinicId = (int) ($request->attributes->get('clinic_id') ?? $user->clinic_id);
        $clinic = Clinic::query()->with('subscription')->find($clinicId);

        $locked = $clinic && ($clinic->status === 'suspended'
            || ($clinic->subscription && ! $clinic->subscription->allowsAccess()));

        if ($locked) {
            return response()->json([
                'success' => false,
                'code' => 'SUBSCRIPTION_REQUIRED',
                'message' => $clinic->status === 'suspended'
                    ? 'This clinic has been suspended. Contact support.'
                    : 'Your clinic subscription is inactive. Renew it to continue.',
            ], 402);
        }

        return $next($request);
    }
}
