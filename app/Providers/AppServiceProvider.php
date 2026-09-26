<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        $this->app->bind(\App\Services\Billing\RazorpayGateway::class, \App\Services\Billing\RazorpayApiGateway::class);
        $this->app->bind(\App\Services\WhatsApp\WhatsAppGateway::class, \App\Services\WhatsApp\MetaWhatsAppGateway::class);
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        \Illuminate\Support\Facades\Gate::before(function ($user) {
            return method_exists($user, 'roleKind') && in_array($user->roleKind(), ['super_admin', 'clinic_admin'], true) ? true : null;
        });
    }
}
