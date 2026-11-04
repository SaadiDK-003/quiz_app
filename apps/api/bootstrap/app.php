<?php

use App\Http\Middleware\AdminOnly;
use App\Http\Middleware\AdultMode;
use App\Http\Middleware\ApiHeaders;
use App\Http\Middleware\LearnerMode;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(web: __DIR__.'/../routes/web.php', commands: __DIR__.'/../routes/console.php', health: '/up')
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->alias(['adult' => AdultMode::class, 'learner' => LearnerMode::class, 'admin' => AdminOnly::class]);
        $middleware->trustProxies(at: '*');
        $middleware->web(append: [ApiHeaders::class]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(fn (Request $request) => $request->is('api/*') || $request->expectsJson());
    })->create();
