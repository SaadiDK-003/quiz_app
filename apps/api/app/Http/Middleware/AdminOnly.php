<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class AdminOnly
{
    public function handle(Request $r, Closure $next): Response
    {
        abort_unless($r->user()->role === 'admin', 403);

        return $next($r);
    }
}
