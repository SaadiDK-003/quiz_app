<?php

namespace App\Services;

use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class VerificationEmailSender
{
    public function send(User $user): bool
    {
        $lock = Cache::lock('verification-email:'.$user->id.':sending', 120);
        if (! $lock->get()) {
            return false;
        }

        try {
            return DB::transaction(function () use ($user): bool {
                // Keep sends serialized even if a slow transport outlasts the cache lock lease.
                $recipient = User::whereKey($user->id)->lockForUpdate()->firstOrFail();
                if ($recipient->hasVerifiedEmail() || $this->availableAt($recipient)) {
                    return false;
                }

                $recipient->notify(new VerifyEmail);
                $availableAt = CarbonImmutable::now()->addSeconds(60);
                Cache::put($this->cooldownKey($recipient), $availableAt->getTimestamp(), $availableAt);

                return true;
            });
        } finally {
            $lock->release();
        }
    }

    public function availableAt(User $user): ?CarbonImmutable
    {
        if ($user->hasVerifiedEmail()) {
            return null;
        }

        $timestamp = Cache::get($this->cooldownKey($user));
        if (! is_int($timestamp)) {
            return null;
        }

        $availableAt = CarbonImmutable::createFromTimestampUTC($timestamp);

        return $availableAt->isFuture() ? $availableAt : null;
    }

    public function retryAfter(User $user): int
    {
        $now = CarbonImmutable::now()->getTimestamp();

        return max(1, ($this->availableAt($user)?->getTimestamp() ?? $now) - $now);
    }

    private function cooldownKey(User $user): string
    {
        return 'verification-email:'.$user->id.':available-at';
    }
}
