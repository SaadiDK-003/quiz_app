<?php

namespace Tests\Feature;

use App\Models\AttemptQuestion;
use App\Models\ChildProfile;
use App\Models\Question;
use App\Models\Skill;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Collection;
use Tests\TestCase;

class QuestionSelectionTest extends TestCase
{
    use RefreshDatabase;

    /** @return array{ChildProfile, Collection<int, Question>} */
    private function learner(): array
    {
        $this->seed();
        $user = User::factory()->create();
        $child = $user->children()->create(['nickname' => 'Mia', 'avatar' => 'fox', 'age_band' => '7-8']);
        $skill = Skill::where('slug', 'place-value')->firstOrFail();
        $questions = Question::where('skill_id', $skill->id)->with('latestRevision')->get();
        Question::whereIn('id', $questions->pluck('id'))->update(['status' => 'published']);
        $this->actingAs($user)->withSession(['mode' => 'child', 'child_id' => $child->id]);

        return [$child, $questions];
    }

    private function checked(ChildProfile $child, Collection $questions, string $time): void
    {
        $attempt = $child->attempts()->create(['skill_id' => $questions->first()->skill_id, 'status' => 'completed', 'position' => 4, 'score' => 0, 'completed_at' => $time]);
        foreach ($questions->values() as $i => $q) {
            $attempt->items()->create(['position' => $i, 'question_revision_id' => $q->latestRevision->id, 'selected_choice_id' => 'a', 'correct' => false, 'answered_at' => $time]);
        }
    }

    public function test_adventure_orders_two_starter_two_growing_and_one_challenge(): void
    {
        [$child, $questions] = $this->learner();

        $result = $this->postJson('/api/v1/attempts', ['skill_id' => $questions->first()->skill_id])->assertOk()->json();

        $items = AttemptQuestion::where('attempt_id', $result['id'])->orderBy('position')->with('revision')->get();
        $this->assertSame(['starter', 'starter', 'growing', 'growing', 'challenge'], $items->pluck('revision.difficulty')->all());
        $this->assertCount(5, $items->pluck('revision.question_id')->unique());
        $this->assertArrayNotHasKey('correct_choice_id', $result['question']);
    }

    public function test_unchecked_questions_are_preferred_and_old_revisions_count_as_the_same_question(): void
    {
        [$child, $questions] = $this->learner();
        $seen = $questions->groupBy(fn (Question $q): string => $q->latestRevision->difficulty)->flatMap(fn (Collection $bucket): Collection => $bucket->take(2))->values();
        $this->checked($child, $seen, '2026-01-01 10:00:00');
        foreach ($seen as $question) {
            $revision = $question->latestRevision->replicate();
            $revision->version = 2;
            $revision->save();
        }

        $result = $this->postJson('/api/v1/attempts', ['skill_id' => $questions->first()->skill_id])->assertOk()->json();

        $ids = AttemptQuestion::where('attempt_id', $result['id'])->with('revision')->get()->pluck('revision.question_id');
        $this->assertCount(0, $ids->intersect($seen->pluck('id')));
    }

    public function test_reused_questions_are_the_least_recently_checked_within_each_level(): void
    {
        [$child, $questions] = $this->learner();
        $buckets = $questions->groupBy(fn (Question $q): string => $q->latestRevision->difficulty);
        $oldest = $buckets->flatMap(fn (Collection $bucket): Collection => $bucket->take(2))->values();
        $recent = $questions->whereNotIn('id', $oldest->pluck('id'));
        $this->checked($child, $oldest, '2026-01-01 10:00:00');
        $this->checked($child, $recent, '2026-02-01 10:00:00');

        $result = $this->postJson('/api/v1/attempts', ['skill_id' => $questions->first()->skill_id])->assertOk()->json();

        $ids = AttemptQuestion::where('attempt_id', $result['id'])->with('revision')->get()->pluck('revision.question_id');
        $this->assertCount(5, $ids->intersect($oldest->pluck('id')));
    }

    public function test_history_is_private_to_each_child_and_empty_superseded_attempts_do_not_count(): void
    {
        [$child, $questions] = $this->learner();
        $other = $child->user->children()->create(['nickname' => 'Jo', 'avatar' => 'bear', 'age_band' => '9-10']);
        $target = $questions->groupBy(fn (Question $q): string => $q->latestRevision->difficulty)->flatMap(fn (Collection $bucket): Collection => $bucket->take(2))->values();
        $this->checked($other, $target, '2026-01-01 10:00:00');
        $this->checked($child, $questions->whereNotIn('id', $target->pluck('id')), '2026-01-01 10:00:00');
        $empty = $child->attempts()->create(['skill_id' => $questions->first()->skill_id, 'status' => 'superseded', 'position' => 0, 'score' => 0]);
        foreach ($target as $i => $q) {
            $empty->items()->create(['position' => $i, 'question_revision_id' => $q->latestRevision->id]);
        }

        $result = $this->postJson('/api/v1/attempts', ['skill_id' => $questions->first()->skill_id])->assertOk()->json();

        $ids = AttemptQuestion::where('attempt_id', $result['id'])->with('revision')->get()->pluck('revision.question_id');
        $this->assertCount(5, $ids->intersect($target->pluck('id')));
    }

    public function test_sparse_levels_fill_with_easier_available_questions(): void
    {
        [$child, $questions] = $this->learner();
        $starter = $questions->filter(fn (Question $q): bool => $q->latestRevision->difficulty === 'starter')->take(6);
        $growing = $questions->first(fn (Question $q): bool => $q->latestRevision->difficulty === 'growing');
        Question::whereIn('id', $questions->pluck('id'))->whereNotIn('id', $starter->pluck('id')->push($growing->id))->update(['status' => 'draft']);

        $result = $this->postJson('/api/v1/attempts', ['skill_id' => $questions->first()->skill_id])->assertOk()->json();

        $levels = AttemptQuestion::where('attempt_id', $result['id'])->orderBy('position')->with('revision')->get()->pluck('revision.difficulty')->all();
        $this->assertSame(['starter', 'starter', 'starter', 'starter', 'growing'], $levels);
    }
}
