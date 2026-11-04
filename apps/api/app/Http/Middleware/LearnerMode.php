<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class LearnerMode
{
    public function handle(Request $r, Closure $next): Response
    {
        abort_unless($r->session()->get('mode') === 'child' && $r->session()->has('child_id'), 403, 'Choose an explorer first.');
        abort_unless($r->user()->children()->whereKey($r->session()->get('child_id'))->exists(), 403);

        return $next($r);
    }
}
