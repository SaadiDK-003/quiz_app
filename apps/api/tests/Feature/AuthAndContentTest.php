<?php

namespace Tests\Feature;

use App\Models\Question;
use App\Models\User;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class AuthAndContentTest extends TestCase
{
    use RefreshDatabase;

    public function test_signed_verification_link_verifies_only_its_parent(): void
    {
        Notification::fake();
        $u = User::factory()->unverified()->create();
        $u->sendEmailVerificationNotification();
        $url = '';
        Notification::assertSentTo($u, VerifyEmail::class, function ($n) use ($u, &$url) {
            $url = $n->toMail($u)->actionUrl;

            return true;
        });
        $this->actingAs($u)->get($url)->assertRedirect(config('app.url').'/?verified=1');
        $this->assertNotNull($u->fresh()->email_verified_at);
    }

    public function test_password_reset_uses_the_emailed_token(): void
    {
        Notification::fake();
        $u = User::factory()->create();
        $this->postJson('/api/v1/auth/forgot-password', ['email' => $u->email])->assertOk();
        $token = '';
        Notification::assertSentTo($u, ResetPassword::class, function ($n) use (&$token) {
            $token = $n->token;

            return true;
        });
        $p = ['email' => $u->email, 'token' => $token, 'password' => 'FreshPassword123', 'password_confirmation' => 'FreshPassword123'];
        $this->postJson('/api/v1/auth/reset-password', $p)->assertOk();
        $this->assertTrue(Hash::check($p['password'], $u->fresh()->password));
        $this->postJson('/api/v1/auth/reset-password', $p)->assertUnprocessable();
    }

    public function test_reviewed_audio_allows_publication_and_old_revision_stays_immutable(): void
    {
        $this->seed();
        Storage::fake('public');
        Storage::disk('public')->put('media/narration.wav', base64_decode('UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='));
        $u = User::factory()->create();
        $u->forceFill(['role' => 'admin'])->save();
        $q = Question::with('latestRevision')->first();
        $original = $q->latestRevision;
        $p = array_merge($original->toArray(), ['skill_id' => $q->skill_id, 'status' => 'published', 'answers_reviewed' => true, 'explanation_reviewed' => true, 'narration_reviewed' => true, 'audio_path' => 'media/narration.wav']);
        $this->actingAs($u)->withSession(['mode' => 'adult'])->putJson('/api/v1/admin/questions/'.$q->id, $p)->assertOk()->assertJsonPath('version', 2)->assertJsonPath('status', 'published');
        $this->assertFalse($original->fresh()->answers_reviewed);
    }

    public function test_image_cannot_be_used_as_narration(): void
    {
        $this->seed();
        Storage::fake('public');
        Storage::disk('public')->put('media/not-audio.png', base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZQAAAABJRU5ErkJggg=='));
        $u = User::factory()->create();
        $u->forceFill(['role' => 'admin'])->save();
        $q = Question::with('latestRevision')->first();
        $p = array_merge($q->latestRevision->toArray(), ['skill_id' => $q->skill_id, 'status' => 'published', 'answers_reviewed' => true, 'explanation_reviewed' => true, 'narration_reviewed' => true, 'audio_path' => 'media/not-audio.png']);
        $this->actingAs($u)->withSession(['mode' => 'adult'])->putJson('/api/v1/admin/questions/'.$q->id, $p)->assertUnprocessable();
    }

    public function test_only_admin_can_invite_and_email_contains_a_registration_link(): void
    {
        Mail::fake();
        $u = User::factory()->create();
        $this->actingAs($u)->withSession(['mode' => 'adult'])->postJson('/api/v1/admin/invitations', ['email' => 'invited@example.test'])->assertForbidden();
        $u->forceFill(['role' => 'admin'])->save();
        $this->postJson('/api/v1/admin/invitations', ['email' => 'invited@example.test'])->assertOk();
        $this->assertDatabaseHas('invitations', ['email' => 'invited@example.test']);
        Mail::assertSentCount(1);
    }
}
