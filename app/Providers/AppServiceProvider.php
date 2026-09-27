<?php

namespace App\Providers;

use App\Services\Billing\RazorpayApiGateway;
use App\Services\Billing\RazorpayGateway;
use App\Services\WhatsApp\MetaWhatsAppGateway;
use App\Services\WhatsApp\PhoneNumber;
use App\Services\WhatsApp\WhatsAppGateway;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        $this->app->bind(RazorpayGateway::class, RazorpayApiGateway::class);
        $this->app->bind(WhatsAppGateway::class, MetaWhatsAppGateway::class);
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        Gate::before(function ($user) {
            return method_exists($user, 'roleKind') && in_array($user->roleKind(), ['super_admin', 'clinic_admin'], true) ? true : null;
        });

        RateLimiter::for('portal-otp', function (Request $request) {
            return Limit::perHour(20)->by($request->ip());
        });

        RateLimiter::for('portal-verify', function (Request $request) {
            $phone = PhoneNumber::normalise((string) $request->input('phone')) ?? 'invalid';

            return Limit::perHour(30)->by($request->ip().'|'.$phone);
        });
    }
}
