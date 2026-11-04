<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class AdultMode
{
    public function handle(Request $r, Closure $next): Response
    {
        abort_unless($r->session()->get('mode', 'adult') === 'adult', 403, 'Ask a grown-up to open the parent area.');

        return $next($r);
    }
}
