<?php

namespace App\Providers;

use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void {}

    public function boot(): void
    {
        VerifyEmail::createUrlUsing(fn ($u) => config('app.url').URL::temporarySignedRoute('verification.verify', now()->addMinutes(60), ['id' => $u->id, 'hash' => sha1($u->getEmailForVerification())], absolute: false));
        ResetPassword::createUrlUsing(fn ($u, $token) => config('app.url').'/?reset_token='.urlencode($token).'&email='.urlencode($u->email));
    }
}
