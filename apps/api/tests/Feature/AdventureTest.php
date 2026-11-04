<?php

namespace Tests\Feature;

use App\Models\AttemptQuestion;
use App\Models\ChildProfile;
use App\Models\Invitation;
use App\Models\Question;
use App\Models\QuestionRevision;
use App\Models\Skill;
use App\Models\User;
use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class AdventureTest extends TestCase
{
    use RefreshDatabase;

    private User $parent;

    private ChildProfile $child;

    private int $skillId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed();
        $this->skillId = Skill::where('slug', 'place-value')->value('id');
        $this->parent = User::factory()->create();
        $this->child = $this->parent->children()->create(['nickname' => 'Mia', 'avatar' => 'fox', 'age_band' => '7-8']);
    }

    private function learner(): static
    {
        return $this->actingAs($this->parent)->withSession(['mode' => 'child', 'child_id' => $this->child->id]);
    }

    private function publish(?int $skill = null): void
    {
        $skill ??= $this->skillId;
        Storage::fake('public');
        Storage::disk('public')->put('media/test.wav', 'test fixture');
        Question::where('skill_id', $skill)->get()->each(function ($q) {
            $q->latestRevision->update(['answers_reviewed' => true, 'explanation_reviewed' => true, 'narration_reviewed' => true, 'audio_path' => 'media/test.wav']);
            $q->update(['status' => 'published']);
        });
    }

    private function start(): array
    {
        $this->publish();

        return $this->learner()->postJson('/api/v1/attempts', ['skill_id' => $this->skillId])->assertOk()->json();
    }

    public function test_seed_has_120_drafts_and_is_idempotent(): void
    {
        $this->assertDatabaseCount('questions', 120);
        $this->assertDatabaseCount('skills', 12);
        $this->assertSame(120, Question::where('status', 'draft')->count());
        $this->seed();
        $this->assertDatabaseCount('question_revisions', 120);
    }

    public function test_seed_choices_are_unique_and_answers_valid(): void
    {
        foreach (QuestionRevision::all() as $q) {
            $ids = array_column($q->choices, 'id');
            $this->assertCount(4, array_unique($ids));
            $this->assertContains($q->correct_choice_id, $ids);
            $this->assertCount(4, array_unique(array_column($q->choices, 'text')));
            $this->assertNotEmpty($q->explanation);
        }
    }

    public function test_guests_and_unverified_parents_cannot_start(): void
    {
        $this->postJson('/api/v1/attempts', ['skill_id' => $this->skillId])->assertUnauthorized();
        $this->parent->forceFill(['email_verified_at' => null])->save();
        $this->learner()->postJson('/api/v1/attempts', ['skill_id' => $this->skillId])->assertForbidden();
    }

    public function test_drafts_are_not_playable(): void
    {
        $this->learner()->postJson('/api/v1/attempts', ['skill_id' => $this->skillId])->assertUnprocessable();
        $this->assertDatabaseCount('attempts', 0);
    }

    public function test_adult_mode_cannot_submit_child_answers(): void
    {
        $this->actingAs($this->parent)->withSession(['mode' => 'adult'])->postJson('/api/v1/attempts', ['skill_id' => $this->skillId])->assertForbidden();
    }

    public function test_child_mode_cannot_access_parent_or_admin_actions(): void
    {
        $this->learner()->getJson('/api/v1/children')->assertForbidden();
        $this->getJson('/api/v1/admin/questions')->assertForbidden();
        $this->deleteJson('/api/v1/children/'.$this->child->id)->assertForbidden();
    }

    public function test_start_returns_five_questions_without_answer_leak_and_reuses_active_attempt(): void
    {
        $a = $this->start();
        $this->assertSame(5, $a['total']);
        $this->assertArrayNotHasKey('correct_choice_id', $a['question']);
        $this->assertArrayNotHasKey('explanation', $a['question']);
        $this->assertNull($a['feedback']);
        $this->postJson('/api/v1/attempts', ['skill_id' => Skill::where('slug', 'addition')->value('id')])->assertJsonPath('id', $a['id']);
        $this->assertDatabaseCount('attempts', 1);
    }

    public function test_accepted_answer_resumes_and_cannot_be_overwritten(): void
    {
        $a = $this->start();
        $rev = QuestionRevision::findOrFail($a['question']['id']);
        $p = ['position' => 0, 'question_id' => $rev->id, 'choice_id' => $rev->correct_choice_id];
        $this->postJson('/api/v1/attempts/'.$a['id'].'/answers', $p)->assertJsonPath('feedback.correct', true);
        $p['choice_id'] = collect($rev->choices)->first(fn ($c) => $c['id'] !== $rev->correct_choice_id)['id'];
        $this->postJson('/api/v1/attempts/'.$a['id'].'/answers', $p)->assertJsonPath('feedback.selected_choice_id', $rev->correct_choice_id);
        $this->getJson('/api/v1/attempts/active')->assertJsonPath('answered', 1)->assertJsonPath('feedback.correct', true);
        $this->assertSame(1, AttemptQuestion::whereNotNull('answered_at')->count());
    }

    public function test_next_is_retry_safe_and_rejects_skipping(): void
    {
        $a = $this->start();
        $this->postJson('/api/v1/attempts/'.$a['id'].'/next', ['position' => 0])->assertUnprocessable();
        $rev = QuestionRevision::find($a['question']['id']);
        $this->postJson('/api/v1/attempts/'.$a['id'].'/answers', ['position' => 0, 'question_id' => $rev->id, 'choice_id' => $rev->correct_choice_id])->assertOk();
        $this->postJson('/api/v1/attempts/'.$a['id'].'/next', ['position' => 0])->assertJsonPath('position', 1);
        $this->postJson('/api/v1/attempts/'.$a['id'].'/next', ['position' => 0])->assertJsonPath('position', 1);
    }

    public function test_completion_awards_one_reward_and_reports_stored_score(): void
    {
        $a = $this->start();
        for ($i = 0; $i < 5; $i++) {
            $rev = QuestionRevision::findOrFail($a['question']['id']);
            $this->postJson('/api/v1/attempts/'.$a['id'].'/answers', ['position' => $i, 'question_id' => $rev->id, 'choice_id' => $rev->correct_choice_id])->assertOk();
            $a = $this->postJson('/api/v1/attempts/'.$a['id'].'/next', ['position' => $i])->assertOk()->json();
        }$this->assertSame('completed', $a['status']);
        $this->assertSame(5, $a['score']);
        $this->postJson('/api/v1/attempts/'.$a['id'].'/next', ['position' => 4])->assertJsonPath('status', 'completed');
        $this->assertDatabaseCount('rewards', 1);
        $this->getJson('/api/v1/children/'.$this->child->id.'/progress')->assertJsonPath('completed', 1)->assertJsonPath('accuracy', 100)->assertJsonCount(1, 'stickers');
    }

    public function test_family_ownership_and_selected_child_are_enforced(): void
    {
        $a = $this->start();
        $other = User::factory()->create();
        $sibling = $this->parent->children()->create(['nickname' => 'Leo', 'avatar' => 'bear', 'age_band' => '9-10']);
        $this->getJson('/api/v1/children/'.$sibling->id.'/progress')->assertForbidden();
        $this->actingAs($other)->withSession(['mode' => 'adult'])->getJson('/api/v1/children/'.$this->child->id.'/progress')->assertNotFound();
        $this->postJson('/api/v1/children/'.$this->child->id.'/enter')->assertNotFound();
        $this->withSession(['mode' => 'child', 'child_id' => $sibling->id])->getJson('/api/v1/attempts/'.$a['id'])->assertForbidden();
    }

    public function test_question_edits_preserve_active_revision(): void
    {
        $a = $this->start();
        $rev = QuestionRevision::find($a['question']['id']);
        $q = Question::find($rev->question_id);
        $new = $rev->replicate(['id', 'version']);
        $new->version = 2;
        $new->prompt = 'A replacement question';
        $new->save();
        $q->update(['status' => 'archived']);
        $this->getJson('/api/v1/attempts/'.$a['id'])->assertJsonPath('question.prompt', $a['question']['prompt'])->assertJsonPath('question.id', $rev->id);
    }

    public function test_parent_reauthentication_requires_password(): void
    {
        $this->learner()->postJson('/api/v1/auth/reauthenticate', ['password' => 'wrong'])->assertUnprocessable();
        $this->postJson('/api/v1/auth/reauthenticate', ['password' => 'password'])->assertOk()->assertJsonPath('mode', 'adult');
        $this->getJson('/api/v1/children')->assertOk();
    }

    public function test_publishing_requires_review_and_narration(): void
    {
        $this->parent->forceFill(['role' => 'admin'])->save();
        $q = Question::with('latestRevision', 'skill')->first();
        $p = array_merge($q->latestRevision->toArray(), ['skill_id' => $q->skill_id, 'status' => 'published']);
        $this->actingAs($this->parent)->withSession(['mode' => 'adult'])->putJson('/api/v1/admin/questions/'.$q->id, $p)->assertUnprocessable();
        $this->assertSame('draft', $q->fresh()->status);
        $this->assertSame(1, $q->revisions()->count());
    }

    public function test_admin_saves_revision_and_non_admin_cannot_edit(): void
    {
        $q = Question::with('latestRevision')->first();
        $p = array_merge($q->latestRevision->toArray(), ['skill_id' => $q->skill_id, 'status' => 'draft', 'prompt' => 'What is 2 + 3?']);
        $this->actingAs($this->parent)->withSession(['mode' => 'adult'])->putJson('/api/v1/admin/questions/'.$q->id, $p)->assertForbidden();
        $this->parent->forceFill(['role' => 'admin'])->save();
        $this->putJson('/api/v1/admin/questions/'.$q->id, $p)->assertOk()->assertJsonPath('version', 2);
        $this->assertDatabaseCount('question_revisions', 121);
    }

    public function test_registration_consumes_invite_and_sends_verification(): void
    {
        Notification::fake();
        $token = 'valid-invitation';
        Invitation::create(['email' => 'family@example.test', 'token_hash' => hash('sha256', $token), 'expires_at' => now()->addDay()]);
        $p = ['name' => 'Parent', 'email' => 'family@example.test', 'invite' => $token, 'password' => 'SafePassword42', 'password_confirmation' => 'SafePassword42'];
        $this->postJson('/api/v1/auth/register', $p)->assertCreated()->assertJsonPath('mode', 'adult');
        Notification::assertSentTo(User::where('email', 'family@example.test')->first(), VerifyEmail::class);
        $this->assertNotNull(Invitation::first()->used_at);
        $this->postJson('/api/v1/auth/register', $p)->assertUnprocessable();
    }

    public function test_expired_invite_is_rejected(): void
    {
        Invitation::create(['email' => 'expired@example.test', 'token_hash' => hash('sha256', 'old'), 'expires_at' => now()->subMinute()]);
        $this->postJson('/api/v1/auth/register', ['name' => 'Parent', 'email' => 'expired@example.test', 'invite' => 'old', 'password' => 'SafePassword42', 'password_confirmation' => 'SafePassword42'])->assertUnprocessable();
    }

    public function test_account_deletion_cascades_family_progress(): void
    {
        $this->start();
        $this->postJson('/api/v1/auth/reauthenticate', ['password' => 'password'])->assertOk();
        $this->deleteJson('/api/v1/account', ['password' => 'wrong'])->assertUnprocessable();
        $this->deleteJson('/api/v1/account', ['password' => 'password'])->assertNoContent();
        $this->assertDatabaseCount('child_profiles', 0);
        $this->assertDatabaseCount('attempts', 0);
        $this->assertDatabaseCount('attempt_questions', 0);
    }

    public function test_no_active_attempt_returns_json_null(): void
    {
        $this->learner()->getJson('/api/v1/attempts/active')->assertOk()->assertContent('null');
    }
}
