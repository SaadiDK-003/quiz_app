<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class ApiHeaders
{
    public function handle(Request $r, Closure $next): Response
    {
        $response = $next($r);
        if ($r->is('api/*')) {
            $response->headers->set('Cache-Control', 'no-store, private');
            $response->headers->set('X-Content-Type-Options', 'nosniff');
        }

        return $response;
    }
}
