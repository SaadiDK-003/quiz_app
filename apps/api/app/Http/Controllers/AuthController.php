<?php

namespace App\Http\Controllers;

use App\Models\Invitation;
use App\Models\User;
use Illuminate\Auth\Events\PasswordReset;
use Illuminate\Auth\Events\Registered;
use Illuminate\Auth\Events\Verified;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules\Password as PasswordRule;
use Symfony\Component\HttpFoundation\Response;

class AuthController extends Controller
{
    public function session(Request $r): array
    {
        $u = $r->user();
        $children = $u->children()->get();
        $mode = $r->session()->get('mode', 'adult');

        return ['user' => $u, 'mode' => $mode, 'children' => $children, 'child' => $mode === 'child' ? $children->firstWhere('id', $r->session()->get('child_id')) : null];
    }

    public function login(Request $r): array
    {
        $r->merge(['email' => strtolower(trim((string) $r->input('email')))]);
        $v = $r->validate(['email' => 'required|email', 'password' => 'required|string']);
        abort_unless(Auth::attempt($v), 422, 'That email and password do not match.');
        $r->session()->regenerate();
        $r->session()->put('mode', 'adult');
        $r->session()->forget('child_id');

        return $this->session($r);
    }

    public function register(Request $r): JsonResponse
    {
        $r->merge(['email' => strtolower(trim((string) $r->input('email')))]);
        $v = $r->validate(['name' => 'required|string|max:80', 'email' => 'required|email|max:254|unique:users', 'password' => ['required', 'confirmed', PasswordRule::min(10)->letters()->numbers()], 'invite' => 'required|string']);
        $user = DB::transaction(function () use ($v) {
            $i = Invitation::where('token_hash', hash('sha256', $v['invite']))->lockForUpdate()->first();
            abort_unless($i && ! $i->used_at && $i->expires_at->isFuture() && strtolower($i->email) === strtolower($v['email']), 422, 'This invitation is invalid or has expired.');
            $u = User::create(collect($v)->only(['name', 'email', 'password'])->all());
            $i->update(['used_at' => now()]);

            return $u;
        });
        Auth::login($user);
        $r->session()->regenerate();
        $r->session()->put('mode', 'adult');
        event(new Registered($user));

        return response()->json($this->session($r), 201);
    }

    public function logout(Request $r): Response
    {
        Auth::guard('web')->logout();
        $r->session()->invalidate();
        $r->session()->regenerateToken();

        return response()->noContent();
    }

    public function reauthenticate(Request $r): array
    {
        $v = $r->validate(['password' => 'required|string']);
        abort_unless(Hash::check($v['password'], $r->user()->password), 422, 'Please check your password.');
        $r->session()->regenerate();
        $r->session()->put('mode', 'adult');
        $r->session()->forget('child_id');

        return $this->session($r);
    }

    public function resend(Request $r): array
    {
        if (! $r->user()->hasVerifiedEmail()) {
            $r->user()->sendEmailVerificationNotification();
        }

        return ['message' => 'A verification email is on its way.'];
    }

    public function verify(Request $r, string $id, string $hash): RedirectResponse
    {
        abort_unless((string) $r->user()->id === $id && hash_equals(sha1($r->user()->getEmailForVerification()), $hash), 403);
        if (! $r->user()->hasVerifiedEmail()) {
            $r->user()->markEmailAsVerified();
            event(new Verified($r->user()));
        }

        return redirect(config('app.url').'/?verified=1');
    }

    public function forgot(Request $r): array
    {
        $r->merge(['email' => strtolower(trim((string) $r->input('email')))]);
        $r->validate(['email' => 'required|email']);
        Password::sendResetLink($r->only('email'));

        return ['message' => 'If this email has an account, a reset link is on its way.'];
    }

    public function reset(Request $r): array
    {
        $r->merge(['email' => strtolower(trim((string) $r->input('email')))]);
        $r->validate(['email' => 'required|email', 'token' => 'required|string', 'password' => ['required', 'confirmed', PasswordRule::min(10)->letters()->numbers()]]);
        $status = Password::reset($r->only('email', 'password', 'password_confirmation', 'token'), function (User $u, string $password) {
            $u->forceFill(['password' => $password, 'remember_token' => Str::random(60)])->save();
            DB::table('sessions')->where('user_id', $u->id)->delete();
            $u->tokens()->delete();
            event(new PasswordReset($u));
        });
        abort_unless($status === Password::PASSWORD_RESET, 422, __($status));

        return ['message' => 'Your password has been reset. You can sign in now.'];
    }

    public function destroy(Request $r): Response
    {
        $r->validate(['password' => 'required|string']);
        abort_unless(Hash::check($r->password, $r->user()->password), 422, 'Please check your password.');
        $u = $r->user();
        DB::transaction(function () use ($u) {
            $u->tokens()->delete();
            Invitation::where('email', $u->email)->delete();
            DB::table('password_reset_tokens')->where('email', $u->email)->delete();
            DB::table('sessions')->where('user_id', $u->id)->delete();
            $u->delete();
        });

        return $this->logout($r);
    }
}
