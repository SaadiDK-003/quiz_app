<?php

namespace Tests\Feature;

use App\Mail\AccountSetup;
use App\Models\Attempt;
use App\Models\Question;
use App\Models\Skill;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Storage;
use RuntimeException;
use Tests\TestCase;

class SignupAndModerationTest extends TestCase
{
    use RefreshDatabase;

    private const PASSWORD = ['password' => 'Learning1234', 'password_confirmation' => 'Learning1234'];

    public function test_family_setup_sends_once_and_creates_a_verified_parent_only_after_password_setup(): void
    {
        Mail::fake();
        Notification::fake();
        $data = ['name' => 'Family Tester', 'email' => '  Family@Example.test  ', 'password' => 'Ignored1234', 'role' => 'admin', 'can_moderate' => true];

        $first = $this->postJson('/api/v1/auth/signup', $data)->assertAccepted()->json();
        $this->postJson('/api/v1/auth/signup', $data)->assertAccepted()->assertExactJson($first);
        Mail::assertSent(AccountSetup::class, fn (AccountSetup $mail) => ! $mail->moderator && $mail->hasTo('family@example.test'));
        Mail::assertSentCount(1);
        $token = $this->emailedToken();
        $this->postJson('/api/v1/auth/setup/check', ['token' => $token])->assertOk()->assertJsonPath('requires_sign_in', false);
        $this->assertDatabaseCount('users', 0);
        $this->assertDatabaseHas('invitations', ['token_hash' => hash('sha256', $token), 'used_at' => null]);
        $this->postJson('/api/v1/auth/setup/complete', ['token' => $token, 'password' => 'short'])->assertUnprocessable();
        $result = $this->postJson('/api/v1/auth/setup/complete', ['token' => $token, ...self::PASSWORD, 'can_moderate' => true, 'name' => 'Changed'])
            ->assertOk()->assertJsonPath('user.name', 'Family Tester')
            ->assertJsonPath('user.role', 'parent')->assertJsonPath('user.can_moderate', false)
            ->assertJsonPath('mode', 'adult')->assertJsonCount(0, 'children')->json();
        $this->assertNotNull($result['user']['email_verified_at']);
        $this->postJson('/api/v1/children', ['nickname' => 'Fox', 'avatar' => 'fox', 'age_band' => '7-8'])->assertCreated();
        $this->postJson('/api/v1/auth/setup/complete', ['token' => $token, ...self::PASSWORD])->assertUnprocessable();
        $this->assertDatabaseCount('users', 1);
        Notification::assertNothingSent();
    }

    public function test_resending_rotates_setup_link_and_expired_link_returns_422(): void
    {
        Mail::fake();
        $data = ['name' => 'Family Tester', 'email' => 'family@example.test'];
        $this->freezeTime();
        $this->postJson('/api/v1/auth/signup', $data)->assertAccepted();
        $first = $this->emailedToken();

        $this->travel(61)->seconds();
        $this->postJson('/api/v1/auth/signup', $data)->assertAccepted();
        $second = $this->emailedToken();
        $this->assertNotSame($first, $second);
        $this->postJson('/api/v1/auth/setup/check', ['token' => $first])->assertUnprocessable();
        $this->postJson('/api/v1/auth/setup/check', ['token' => $second])->assertOk();

        $this->travel(25)->hours();
        $this->postJson('/api/v1/auth/setup/complete', ['token' => $second, ...self::PASSWORD])->assertUnprocessable();
        $this->assertDatabaseCount('users', 0);
    }

    public function test_known_accounts_and_pending_requests_receive_the_same_public_response(): void
    {
        Mail::fake();
        $parent = User::factory()->create();
        $known = $this->postJson('/api/v1/auth/signup', ['name' => 'Existing family', 'email' => $parent->email])->assertAccepted()->json();
        $lock = Cache::lock('account-setup:family_signup:'.hash('sha256', 'family@example.test').':sending', 120);
        $this->assertTrue($lock->get());
        try {
            $this->postJson('/api/v1/auth/signup', ['name' => 'New family', 'email' => 'family@example.test'])->assertAccepted()->assertExactJson($known);
        } finally {
            $lock->release();
        }
        Mail::assertNothingSent();
        $this->assertDatabaseCount('invitations', 0);
    }

    public function test_failed_setup_delivery_can_be_retried(): void
    {
        $mailManager = Mail::getFacadeRoot();
        Mail::shouldReceive('to')->once()->with('family@example.test')->andThrow(new RuntimeException('Test mail failure'));
        $data = ['name' => 'Family Tester', 'email' => 'family@example.test'];
        $this->postJson('/api/v1/auth/signup', $data)->assertServiceUnavailable();
        $this->assertDatabaseCount('invitations', 0);

        Mail::swap($mailManager);
        Mail::fake();
        $this->postJson('/api/v1/auth/signup', $data)->assertAccepted();
        Mail::assertSentCount(1);
    }

    public function test_existing_parent_accepts_moderator_invite_and_keeps_their_child_profiles(): void
    {
        Mail::fake();
        $admin = User::factory()->create(['role' => 'admin']);
        $parent = User::factory()->create();
        $child = $parent->children()->create(['nickname' => 'Mia', 'avatar' => 'fox', 'age_band' => '7-8']);
        $invite = ['email' => $parent->email];

        $this->useAccount($parent)->postJson('/api/v1/admin/moderator-invitations', $invite)->assertForbidden();
        $this->useAccount($admin)->postJson('/api/v1/admin/moderator-invitations', $invite)->assertOk();
        Mail::assertSent(AccountSetup::class, fn (AccountSetup $mail) => $mail->moderator && $mail->hasTo($parent->email));
        $token = $this->emailedToken();
        $this->postJson('/api/v1/auth/setup/check', ['token' => $token])->assertOk()->assertJsonPath('requires_sign_in', true);
        $this->postJson('/api/v1/auth/setup/complete', ['token' => $token])->assertForbidden();
        $this->useAccount($parent)->withSession(['mode' => 'child', 'child_id' => $child->id])
            ->postJson('/api/v1/auth/setup/complete', ['token' => $token])->assertForbidden();

        $this->withSession(['mode' => 'adult'])->postJson('/api/v1/auth/setup/complete', ['token' => $token])
            ->assertOk()->assertJsonPath('user.id', $parent->id)->assertJsonPath('user.role', 'parent')
            ->assertJsonPath('user.can_moderate', true)->assertJsonPath('children.0.id', $child->id);
        $this->assertDatabaseCount('users', 2);
        $this->getJson('/api/v1/studio/questions')->assertOk();
        $this->postJson('/api/v1/admin/moderator-invitations', ['email' => 'else@example.test'])->assertForbidden();
        $this->withSession(['mode' => 'child'])->getJson('/api/v1/studio/questions')->assertForbidden();
    }

    public function test_new_moderator_creates_an_account_only_from_a_separate_staff_invite(): void
    {
        Mail::fake();
        $admin = User::factory()->create(['role' => 'admin']);
        $this->useAccount($admin)->postJson('/api/v1/admin/moderator-invitations', ['email' => 'author@example.test'])->assertOk();
        $token = $this->emailedToken();
        $this->postJson('/api/v1/auth/logout')->assertNoContent();
        $this->postJson('/api/v1/auth/register', ['name' => 'New Author', 'email' => 'author@example.test', 'invite' => $token, ...self::PASSWORD])->assertUnprocessable();
        $this->postJson('/api/v1/auth/setup/check', ['token' => $token])->assertOk()->assertJsonPath('requires_sign_in', false);

        $result = $this->postJson('/api/v1/auth/setup/complete', ['token' => $token, 'name' => 'New Author', ...self::PASSWORD])
            ->assertOk()->assertJsonPath('user.role', 'parent')->assertJsonPath('user.can_moderate', true)
            ->assertJsonPath('user.email', 'author@example.test')->json();
        $this->assertNotNull($result['user']['email_verified_at']);
    }

    public function test_moderator_draft_is_private_and_admin_can_return_it_for_revision(): void
    {
        $this->seed();
        $author = User::factory()->create(['can_moderate' => true]);
        $otherAuthor = User::factory()->create(['can_moderate' => true]);
        $admin = User::factory()->create(['role' => 'admin']);
        $question = Question::with('latestRevision')->firstOrFail();
        $payload = [...$question->latestRevision->toArray(), 'skill_id' => $question->skill_id, 'question_id' => null, 'status' => 'published'];
        $this->useAccount($author)->postJson('/api/v1/admin/questions', $payload)->assertForbidden();
        $id = $this->postJson('/api/v1/studio/proposals', $payload)->assertCreated()->json('id');
        $url = '/api/v1/studio/proposals/'.$id;
        $this->useAccount($otherAuthor)->getJson('/api/v1/studio/proposals')->assertExactJson([]);
        $this->putJson($url, [...$payload, 'version' => 1])->assertNotFound();
        $this->useAccount($author)->postJson($url.'/submit', ['version' => 1])->assertOk();
        $this->putJson($url, [...$payload, 'version' => 2])->assertConflict();
        $this->postJson($url.'/review', ['decision' => 'publish', 'version' => 2])->assertForbidden();

        $this->useAccount($admin)->getJson('/api/v1/studio/proposals')
            ->assertJsonPath('0.state', 'in_review')->assertJsonPath('0.question.status', 'draft');
        $this->postJson($url.'/review', ['decision' => 'return', 'version' => 2, 'review_note' => 'Add narration.'])->assertOk();
        $this->useAccount($author)->getJson('/api/v1/studio/proposals')
            ->assertJsonPath('0.state', 'changes_requested')->assertJsonPath('0.review_note', 'Add narration.');
        $this->putJson($url, [...$payload, 'version' => 3, 'prompt' => 'Updated wording'])->assertOk();
        $this->postJson($url.'/submit', ['version' => 4])->assertOk();
        $this->assertDatabaseHas('question_proposals', ['id' => $id, 'state' => 'in_review', 'version' => 5]);
    }

    public function test_admin_can_publish_a_reviewed_proposal_without_narration(): void
    {
        $this->seed();
        $author = User::factory()->create(['can_moderate' => true]);
        $admin = User::factory()->create(['role' => 'admin']);
        $question = Question::with('latestRevision')->firstOrFail();
        $payload = [
            ...$question->latestRevision->toArray(),
            'question_id' => $question->id,
            'question_version' => $question->latestRevision->version,
            'skill_id' => $question->skill_id,
            'audio_path' => null,
        ];
        $id = $this->useAccount($author)->postJson('/api/v1/studio/proposals', $payload)->assertCreated()->json('id');
        $url = '/api/v1/studio/proposals/'.$id;
        $this->postJson($url.'/submit', ['version' => 1])->assertOk();

        $this->useAccount($admin)->postJson($url.'/review', [
            'decision' => 'publish',
            'version' => 2,
            'question_version' => $question->latestRevision->version,
            'answers_reviewed' => true,
            'explanation_reviewed' => true,
        ])->assertOk();

        $this->assertSame('published', $question->fresh()->status);
        $this->assertNull($question->fresh()->latestRevision->audio_path);
        $this->assertDatabaseHas('question_proposals', ['id' => $id, 'state' => 'published']);
    }

    public function test_reviewed_edit_reaches_new_adventures_and_keeps_existing_child_snapshots(): void
    {
        $this->seed();
        Storage::fake('public');
        Storage::disk('public')->put('media/narration.wav', base64_decode('UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='));
        $skill = Skill::where('slug', 'place-value')->firstOrFail();
        $published = $skill->questions()->with('latestRevision')->orderBy('id')->take(5)->get();
        Question::whereIn('id', $published->pluck('id'))->update(['status' => 'published']);
        $question = $published->first();
        $original = $question->latestRevision;
        $author = User::factory()->create(['can_moderate' => true]);
        $admin = User::factory()->create(['role' => 'admin']);
        $parent = User::factory()->create();
        $first = $parent->children()->create(['nickname' => 'Mia', 'avatar' => 'fox', 'age_band' => '7-8']);
        $second = $parent->children()->create(['nickname' => 'Jo', 'avatar' => 'bear', 'age_band' => '9-10']);
        $this->useAccount($parent)->postJson('/api/v1/children/'.$first->id.'/enter')->assertOk();
        $oldAttempt = $this->postJson('/api/v1/attempts', ['skill_id' => $skill->id])->assertOk()->json('id');

        $payload = [
            ...$original->toArray(), 'question_id' => $question->id, 'question_version' => $original->version,
            'skill_id' => $skill->id, 'audio_path' => 'media/narration.wav', 'prompt' => 'A nicer question',
        ];
        $id = $this->useAccount($author)->withSession(['mode' => 'adult'])->postJson('/api/v1/studio/proposals', $payload)->assertCreated()->json('id');
        $url = '/api/v1/studio/proposals/'.$id;
        $this->postJson($url.'/submit', ['version' => 1])->assertOk();
        $this->assertSame($original->id, $question->fresh()->latestRevision->id);

        $approval = [
            'version' => 2, 'decision' => 'publish', 'question_version' => $original->version,
            'answers_reviewed' => true, 'explanation_reviewed' => true, 'narration_reviewed' => true,
        ];
        $this->useAccount($admin)->postJson($url.'/review', [...$approval, 'narration_reviewed' => false])->assertUnprocessable();
        $this->postJson($url.'/review', [...$approval, 'question_version' => $original->version + 1])->assertConflict();
        $this->postJson($url.'/review', $approval)->assertOk();
        $newRevision = $question->fresh()->latestRevision;
        $this->assertSame('A nicer question', $newRevision->prompt);
        $this->postJson($url.'/review', $approval)->assertConflict();

        $this->useAccount($parent)->postJson('/api/v1/children/'.$second->id.'/enter')->assertOk();
        $this->getJson('/api/v1/attempts/active')->assertOk()->assertContent('null');
        $newAttempt = $this->postJson('/api/v1/attempts', ['skill_id' => $skill->id])->assertOk()->json('id');
        $this->assertTrue(Attempt::findOrFail($newAttempt)->items()->where('question_revision_id', $newRevision->id)->exists());

        $this->postJson('/api/v1/children/'.$first->id.'/enter')->assertOk();
        $this->getJson('/api/v1/attempts/active')->assertOk()->assertJsonPath('id', $oldAttempt);
        $this->assertTrue(Attempt::findOrFail($oldAttempt)->items()->where('question_revision_id', $original->id)->exists());
    }

    private function useAccount(User $user): static
    {
        Auth::forgetGuards();

        return $this->actingAs($user, 'web');
    }

    private function emailedToken(): string
    {
        return substr(parse_url(Mail::sent(AccountSetup::class)->last()->url, PHP_URL_FRAGMENT), strlen('setup='));
    }
}
