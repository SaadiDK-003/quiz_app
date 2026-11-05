<?php

namespace Tests\Feature;

use App\Models\Question;
use App\Models\Skill;
use App\Models\User;
use App\Services\QuestionBankImporter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Validation\ValidationException;
use PHPUnit\Framework\Attributes\TestWith;
use Tests\TestCase;

class QuestionBankTest extends TestCase
{
    use RefreshDatabase;

    private function administrator(): User
    {
        $user = User::factory()->create();
        $user->forceFill(['role' => 'admin'])->save();

        return $user;
    }

    private function originalBank(): void
    {
        $this->seed();
        $pack = json_decode(file_get_contents(database_path('content/questions.json')), true, 512, JSON_THROW_ON_ERROR);
        Question::whereIn('seed_key', array_column(array_slice($pack, 120), 'seed_key'))->delete();
    }

    public function test_each_skill_has_ten_questions_at_each_difficulty(): void
    {
        $this->seed();

        foreach (Skill::all() as $skill) {
            $counts = $skill->questions()->with('latestRevision')->get()->countBy(fn (Question $q): string => $q->latestRevision->difficulty)->sortKeys()->all();
            $this->assertSame(['challenge' => 10, 'growing' => 10, 'starter' => 10], $counts);
        }
    }

    public function test_import_adds_only_missing_drafts_and_preserves_edited_content_on_retry(): void
    {
        $this->originalBank();
        $question = Question::with('latestRevision')->firstOrFail();
        $question->update(['status' => 'archived']);
        $question->latestRevision->update(['prompt' => 'An adult edited this question.', 'audio_path' => 'media/kept.wav', 'answers_reviewed' => true, 'explanation_reviewed' => true, 'narration_reviewed' => true]);
        $before = $question->latestRevision->fresh()->toArray();
        $this->actingAs($this->administrator())->withSession(['mode' => 'adult']);

        $this->postJson('/api/v1/admin/questions/import')->assertOk()->assertExactJson(['created' => 240, 'skipped' => 120]);
        $this->postJson('/api/v1/admin/questions/import')->assertOk()->assertExactJson(['created' => 0, 'skipped' => 360]);

        $this->assertDatabaseCount('questions', 360);
        $this->assertDatabaseCount('question_revisions', 360);
        $this->assertSame($before, $question->latestRevision->fresh()->toArray());
        $this->assertSame('archived', $question->fresh()->status);
        $this->assertSame(359, Question::where('status', 'draft')->count());
        $this->assertDatabaseCount('skills', 12);
    }

    public function test_guest_import_returns_401(): void
    {
        $this->postJson('/api/v1/admin/questions/import')->assertUnauthorized();
        $this->assertDatabaseCount('questions', 0);
    }

    #[TestWith(['parent', 'adult', true])]
    #[TestWith(['admin', 'child', true])]
    #[TestWith(['admin', 'adult', false])]
    public function test_import_returns_403_without_verified_administrator_adult_context(string $role, string $mode, bool $verified): void
    {
        $user = User::factory()->create();
        $user->forceFill(['role' => $role, 'email_verified_at' => $verified ? now() : null])->save();

        $this->actingAs($user)->withSession(['mode' => $mode])->postJson('/api/v1/admin/questions/import')->assertForbidden();
        $this->assertDatabaseCount('questions', 0);
    }

    public function test_missing_skill_returns_422_without_partial_import_or_catalog_recreation(): void
    {
        $this->originalBank();
        Skill::where('slug', 'division')->update(['slug' => 'renamed-division']);

        $this->actingAs($this->administrator())->withSession(['mode' => 'adult'])->postJson('/api/v1/admin/questions/import')
            ->assertUnprocessable()->assertJsonValidationErrors('pack');

        $this->assertDatabaseCount('questions', 120);
        $this->assertDatabaseCount('question_revisions', 120);
        $this->assertDatabaseCount('skills', 12);
        $this->assertDatabaseMissing('skills', ['slug' => 'division']);
    }

    #[TestWith(['wrong-answer'])]
    #[TestWith(['duplicate-choice'])]
    #[TestWith(['duplicate-key'])]
    #[TestWith(['review-injection'])]
    public function test_invalid_pack_is_rejected_before_any_insert(string $case): void
    {
        $this->originalBank();
        $pack = json_decode(file_get_contents(database_path('content/questions.json')), true, 512, JSON_THROW_ON_ERROR);
        $rows = array_slice($pack, 120, 2);
        match ($case) {
            'wrong-answer' => $rows[1]['correct_choice_id'] = 'missing',
            'duplicate-choice' => $rows[1]['choices'][1]['text'] = $rows[1]['choices'][0]['text'],
            'duplicate-key' => $rows[1]['seed_key'] = $rows[0]['seed_key'],
            'review-injection' => $rows[1]['answers_reviewed'] = true,
        };

        try {
            app(QuestionBankImporter::class)->import($rows);
            $this->fail('An invalid pack must be rejected.');
        } catch (ValidationException $exception) {
            $this->assertNotEmpty($exception->errors());
        }

        $this->assertDatabaseCount('questions', 120);
        $this->assertDatabaseCount('question_revisions', 120);
    }
}
