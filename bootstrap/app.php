<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->alias([
            'clinic.scope' => \App\Http\Middleware\EnsureClinicScope::class,
            'clinic.context' => \App\Http\Middleware\ResolveClinicContext::class,
            'clinic.subscription' => \App\Http\Middleware\EnsureClinicSubscription::class,
            'role' => \Spatie\Permission\Middleware\RoleMiddleware::class,
            'permission' => \Spatie\Permission\Middleware\PermissionMiddleware::class,
            'perm' => \App\Http\Middleware\EnsurePermission::class,
            'portal.auth' => \App\Http\Middleware\AuthenticatePortal::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        //
    })->create();
