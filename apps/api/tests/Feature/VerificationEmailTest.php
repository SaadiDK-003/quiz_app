<?php

namespace Tests\Feature;

use App\Models\Invitation;
use App\Models\User;
use App\Services\VerificationEmailSender;
use Illuminate\Auth\Events\Registered;
use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Notification;
use RuntimeException;
use Tests\TestCase;

class VerificationEmailTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['cache.default' => 'database']);
        Notification::fake();
        $this->freezeSecond();
    }

    public function test_registration_waits_for_one_manual_email_and_then_enforces_the_cooldown(): void
    {
        Invitation::create(['email' => 'family@example.test', 'token_hash' => hash('sha256', 'family-invite'), 'expires_at' => now()->addDay()]);
        $registration = ['name' => 'Parent', 'email' => 'family@example.test', 'invite' => 'family-invite', 'password' => 'SafePassword42', 'password_confirmation' => 'SafePassword42'];

        $this->postJson('/api/v1/auth/register', $registration)
            ->assertCreated()
            ->assertJsonPath('verification_resend_available_at', null);
        $user = User::where('email', 'family@example.test')->firstOrFail();
        $this->getJson('/api/v1/session')->assertJsonPath('verification_resend_available_at', null);
        Notification::assertNothingSent();
        $this->postJson('/api/v1/auth/verification-notification')->assertOk()
            ->assertJsonPath('verification_resend_available_at', now()->addSeconds(60)->toIso8601String());
        Notification::assertSentToTimes($user, VerifyEmail::class, 1);

        event(new Registered($user));
        $this->postJson('/api/v1/auth/verification-notification')->assertStatus(429)->assertHeader('Retry-After', '60');
        Notification::assertSentToTimes($user, VerifyEmail::class, 1);
        $this->assertNotNull(Invitation::first()->used_at);
    }

    public function test_repeated_resends_and_session_refreshes_do_not_send_extra_mail(): void
    {
        $user = User::factory()->unverified()->create();
        $this->actingAs($user)->withSession(['mode' => 'adult']);
        $availableAt = now()->addSeconds(60)->toIso8601String();

        $this->postJson('/api/v1/auth/verification-notification')->assertOk()->assertJsonPath('verification_resend_available_at', $availableAt);
        for ($i = 0; $i < 5; $i++) {
            $this->postJson('/api/v1/auth/verification-notification')->assertStatus(429)->assertHeader('Retry-After', '60');
            $this->getJson('/api/v1/session')->assertOk()->assertJsonPath('verification_resend_available_at', $availableAt);
        }

        $this->travel(59)->seconds();
        $this->postJson('/api/v1/auth/verification-notification')->assertStatus(429)->assertHeader('Retry-After', '1');
        Notification::assertSentToTimes($user, VerifyEmail::class, 1);

        $this->travel(1)->seconds();
        $this->getJson('/api/v1/session')->assertJsonPath('verification_resend_available_at', null);
        $this->postJson('/api/v1/auth/verification-notification')->assertOk()->assertJsonPath('verification_resend_available_at', now()->addSeconds(60)->toIso8601String());
        Notification::assertSentToTimes($user, VerifyEmail::class, 2);
    }

    public function test_an_in_flight_send_blocks_another_request_without_taking_its_lock(): void
    {
        $user = User::factory()->unverified()->create();
        $lock = Cache::lock('verification-email:'.$user->id.':sending', 120);
        $this->assertTrue($lock->get());
        try {
            $this->actingAs($user)->withSession(['mode' => 'adult'])
                ->postJson('/api/v1/auth/verification-notification')
                ->assertStatus(429)->assertHeader('Retry-After', '1');
            $this->assertFalse(Cache::lock('verification-email:'.$user->id.':sending', 120)->get());
            Notification::assertNothingSent();
        } finally {
            $lock->release();
        }

        $this->postJson('/api/v1/auth/verification-notification')->assertOk();
        Notification::assertSentToTimes($user, VerifyEmail::class, 1);
    }

    public function test_a_competing_send_during_notification_delivery_cannot_send_twice(): void
    {
        $user = User::factory()->unverified()->create();
        $sender = app(VerificationEmailSender::class);
        Notification::shouldReceive('send')->once()->andReturnUsing(function (User $recipient, VerifyEmail $notification) use ($user, $sender): void {
            $this->assertTrue($recipient->is($user));
            $this->assertFalse($sender->send($user->fresh()));
            $this->assertNull($sender->availableAt($user));
            $this->travel(3)->seconds();
        });

        $this->assertTrue($sender->send($user));
        $this->assertSame(now()->addSeconds(60)->toIso8601String(), $sender->availableAt($user)->toIso8601String());
    }

    public function test_one_parents_cooldown_does_not_block_another_parent(): void
    {
        $first = User::factory()->unverified()->create();
        $second = User::factory()->unverified()->create();
        $this->actingAs($first)->withSession(['mode' => 'adult'])->postJson('/api/v1/auth/verification-notification')->assertOk();
        $this->actingAs($second)->postJson('/api/v1/auth/verification-notification')->assertOk();
        Notification::assertSentToTimes($first, VerifyEmail::class, 1);
        Notification::assertSentToTimes($second, VerifyEmail::class, 1);
    }

    public function test_failed_delivery_releases_the_lock_and_leaves_the_send_retryable(): void
    {
        $user = User::factory()->unverified()->create();
        $sender = app(VerificationEmailSender::class);
        Notification::shouldReceive('send')->once()->andThrow(new RuntimeException('Mail transport unavailable'));
        try {
            $sender->send($user);
            $this->fail('Delivery failure should be reported.');
        } catch (RuntimeException $error) {
            $this->assertSame('Mail transport unavailable', $error->getMessage());
        }
        $this->assertNull($sender->availableAt($user));

        Notification::fake();
        $this->actingAs($user)->withSession(['mode' => 'adult'])->postJson('/api/v1/auth/verification-notification')->assertOk();
        Notification::assertSentToTimes($user, VerifyEmail::class, 1);
    }

    public function test_verified_accounts_and_stale_user_instances_never_send_verification_mail(): void
    {
        $user = User::factory()->unverified()->create();
        $stale = $user->fresh();
        $user->markEmailAsVerified();
        $stale->sendEmailVerificationNotification();

        $this->actingAs($user)->withSession(['mode' => 'adult'])
            ->postJson('/api/v1/auth/verification-notification')
            ->assertOk()->assertJsonPath('message', 'Your email is already verified.')
            ->assertJsonPath('verification_resend_available_at', null);
        $this->getJson('/api/v1/session')->assertJsonPath('verification_resend_available_at', null);
        Notification::assertNothingSent();
    }

    public function test_reopening_verification_links_and_reading_session_never_resends_mail(): void
    {
        $user = User::factory()->unverified()->create();
        $user->sendEmailVerificationNotification();
        $url = (new VerifyEmail)->toMail($user)->actionUrl;

        $this->actingAs($user)->withSession(['mode' => 'adult']);
        for ($i = 0; $i < 2; $i++) {
            $this->get($url)->assertRedirect(config('app.url').'/?verified=1');
            $this->getJson('/api/v1/session')->assertOk()->assertJsonPath('verification_resend_available_at', null);
        }
        Notification::assertSentToTimes($user, VerifyEmail::class, 1);
    }

    public function test_resending_requires_authentication_and_adult_mode(): void
    {
        $this->postJson('/api/v1/auth/verification-notification')->assertUnauthorized();
        $user = User::factory()->unverified()->create();
        $this->actingAs($user)->withSession(['mode' => 'child'])->postJson('/api/v1/auth/verification-notification')->assertForbidden();
        Notification::assertNothingSent();
    }
}
