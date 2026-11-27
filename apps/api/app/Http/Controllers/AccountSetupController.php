<?php

namespace App\Http\Controllers;

use App\Mail\AccountSetup;
use App\Models\Invitation;
use App\Models\User;
use Illuminate\Auth\Events\Verified;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules\Password;
use Throwable;

class AccountSetupController extends Controller
{
    public function signup(Request $request): JsonResponse
    {
        $this->normalizeEmail($request);
        $data = $request->validate(['name' => 'required|string|max:80', 'email' => 'required|email|max:254']);
        if (! User::where('email', $data['email'])->exists()) {
            $this->send($data['email'], Invitation::FAMILY_SIGNUP, $data['name']);
        }

        return response()->json(['message' => 'If this address can be used for a new family account, a setup link is on its way.'], 202);
    }

    public function inviteModerator(Request $request): array
    {
        $this->normalizeEmail($request);
        $data = $request->validate(['email' => 'required|email|max:254']);
        $user = User::where('email', $data['email'])->first();
        abort_if($user && ($user->role === 'admin' || $user->can_moderate), 422, 'This account already has Content Studio access.');
        abort_unless($this->send($data['email'], Invitation::MODERATOR), 429, 'A moderator invitation was just requested. Try again in a minute.');

        return ['message' => 'Moderator invitation sent. The link is valid for seven days.'];
    }

    public function check(Request $request): array
    {
        $data = $request->validate(['token' => 'required|string|size:64']);
        $invitation = $this->invitation($data['token']);
        $existing = User::where('email', $invitation->email)->exists();
        abort_if($invitation->purpose === Invitation::FAMILY_SIGNUP && $existing, 422, 'An account already exists. Sign in or reset your password.');

        return [
            'purpose' => $invitation->purpose,
            'email' => $invitation->email,
            'requires_sign_in' => $existing,
        ];
    }

    public function complete(Request $request, AuthController $auth): array
    {
        $data = $request->validate(['token' => 'required|string|size:64']);
        [$user, $newlyVerified] = DB::transaction(function () use ($request, $data) {
            $invitation = $this->invitation($data['token'], lock: true);
            $moderator = $invitation->purpose === Invitation::MODERATOR;
            $signedIn = Auth::guard('web')->id();
            $existing = User::where('email', $invitation->email)->lockForUpdate()->first();
            if ($existing) {
                abort_unless($moderator, 422, 'An account already exists. Sign in or reset your password.');
                abort_unless($signedIn === $existing->id && $request->session()->get('mode', 'adult') === 'adult', 403, 'Sign in with the invited email address to accept this invitation.');
                $user = $existing;
            } else {
                abort_if($signedIn !== null, 409, 'Sign out of the current account before creating another one.');
                $values = $request->validate([
                    'name' => $moderator ? 'required|string|max:80' : 'exclude',
                    'password' => ['required', 'confirmed', Password::min(10)->letters()->numbers()],
                ]);
                $user = User::query()->createOrFirst(
                    ['email' => $invitation->email],
                    ['name' => $invitation->name ?? $values['name'], 'password' => $values['password']],
                );
                abort_unless($user->wasRecentlyCreated, 409, 'An account now exists for this address. Sign in and try the link again.');
            }

            $newlyVerified = ! $user->hasVerifiedEmail();
            if ($moderator) {
                $user->can_moderate = true;
            }
            if ($newlyVerified) {
                $user->email_verified_at = now();
            }
            $user->save();
            $invitation->update(['used_at' => now(), 'name' => null]);

            return [$user, $newlyVerified];
        });

        if ($newlyVerified) {
            event(new Verified($user));
        }

        return $auth->openAdultSession($request, $user);
    }

    private function normalizeEmail(Request $request): void
    {
        if (is_string($request->input('email'))) {
            $request->merge(['email' => Str::lower(trim($request->input('email')))]);
        }
    }

    private function invitation(string $token, bool $lock = false): Invitation
    {
        $query = Invitation::where('token_hash', hash('sha256', $token))
            ->whereIn('purpose', [Invitation::FAMILY_SIGNUP, Invitation::MODERATOR]);
        $invitation = ($lock ? $query->lockForUpdate() : $query)->first();
        abort_unless($invitation && ! $invitation->used_at && $invitation->expires_at->isFuture(), 422, 'This link has expired or has already been used.');

        return $invitation;
    }

    private function send(string $email, string $purpose, ?string $name = null): bool
    {
        $key = 'account-setup:'.$purpose.':'.hash('sha256', $email);
        $lock = Cache::lock($key.':sending', 120);
        if (! $lock->get()) {
            return false;
        }

        try {
            if (Cache::has($key)) {
                return false;
            }

            $moderator = $purpose === Invitation::MODERATOR;
            $token = Str::random(64);
            $invitation = Invitation::create([
                'name' => $name,
                'email' => $email,
                'token_hash' => hash('sha256', $token),
                'purpose' => $purpose,
                'expires_at' => $moderator ? now()->addDays(7) : now()->addDay(),
            ]);
            $url = rtrim(config('app.url'), '/').'/#setup='.$token;
            try {
                Mail::to($email)->send(new AccountSetup($url, $moderator));
            } catch (Throwable $error) {
                Invitation::whereKey($invitation->id)->whereNull('used_at')->delete();
                report($error);
                abort(503, 'The setup email could not be sent. Please try again.');
            }

            Cache::put($key, true, 60);
            Invitation::where('email', $email)->where('purpose', $purpose)
                ->whereKeyNot($invitation->id)->whereNull('used_at')
                ->update(['used_at' => now(), 'name' => null]);

            return true;
        } finally {
            $lock->release();
        }
    }
}
