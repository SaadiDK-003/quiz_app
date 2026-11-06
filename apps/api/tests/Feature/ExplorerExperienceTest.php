<?php

namespace Tests\Feature;

use App\Models\Attempt;
use App\Models\AttemptQuestion;
use App\Models\ChildProfile;
use App\Models\Question;
use App\Models\QuestionRevision;
use App\Models\Skill;
use App\Models\User;
use App\Services\AdventureQuestionSelector;
use App\Services\ExplorerRank;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Mockery\MockInterface;
use Tests\TestCase;

class ExplorerExperienceTest extends TestCase
{
    use RefreshDatabase;

    private function learner(): ChildProfile
    {
        $this->seed();
        $user = User::factory()->create();
        $child = $user->children()->create(['nickname' => 'Mia', 'avatar' => 'fox', 'age_band' => '7-8']);
        $skill = Skill::firstOrFail();
        Question::where('skill_id', $skill->id)->update(['status' => 'published']);
        $this->actingAs($user)->withSession(['mode' => 'child', 'child_id' => $child->id]);

        return $child;
    }

    private function complete(int $correctAnswers): array
    {
        $attempt = $this->postJson('/api/v1/attempts', ['skill_id' => Skill::firstOrFail()->id])->assertOk()->json();
        for ($position = 0; $position < 5; $position++) {
            $revision = QuestionRevision::findOrFail($attempt['question']['id']);
            $choice = $position < $correctAnswers ? $revision->correct_choice_id : collect($revision->choices)->first(fn (array $c): bool => $c['id'] !== $revision->correct_choice_id)['id'];
            $this->postJson('/api/v1/attempts/'.$attempt['id'].'/answers', ['position' => $position, 'question_id' => $revision->id, 'choice_id' => $choice])->assertOk();
            $attempt = $this->postJson('/api/v1/attempts/'.$attempt['id'].'/next', ['position' => $position])->assertOk()->json();
        }

        return $attempt;
    }

    public function test_shuffled_choice_ids_are_snapshotted_and_stable_for_reads_answers_and_repeated_starts(): void
    {
        $this->learner();
        $this->partialMock(AdventureQuestionSelector::class, function (MockInterface $mock): void {
            $mock->shouldReceive('choiceOrder')->times(5)->andReturnUsing(fn (QuestionRevision $revision): array => array_reverse(array_column($revision->choices, 'id')));
        });
        $attempt = $this->postJson('/api/v1/attempts', ['skill_id' => Skill::firstOrFail()->id])->assertOk()->json();
        foreach (AttemptQuestion::where('attempt_id', $attempt['id'])->with('revision')->get() as $item) {
            $this->assertSame(array_reverse(array_column($item->revision->choices, 'id')), $item->choice_order);
        }
        $revision = QuestionRevision::findOrFail($attempt['question']['id']);
        $this->assertSame(array_reverse(array_column($revision->choices, 'id')), array_column($attempt['question']['choices'], 'id'));
        $this->assertArrayNotHasKey('correct_choice_id', $attempt['question']);
        $this->assertArrayNotHasKey('explanation', $attempt['question']);
        $this->getJson('/api/v1/attempts/active')->assertJsonPath('question.choices', $attempt['question']['choices']);
        $this->postJson('/api/v1/attempts', ['skill_id' => Skill::firstOrFail()->id])->assertJsonPath('id', $attempt['id'])->assertJsonPath('question.choices', $attempt['question']['choices']);
        $this->postJson('/api/v1/attempts/'.$attempt['id'].'/answers', ['position' => 0, 'question_id' => $revision->id, 'choice_id' => $revision->correct_choice_id])
            ->assertOk()->assertJsonPath('feedback.correct', true)->assertJsonPath('question.choices', $attempt['question']['choices']);
        $this->getJson('/api/v1/attempts/'.$attempt['id'])->assertJsonPath('feedback.selected_choice_id', $revision->correct_choice_id)->assertJsonPath('question.choices', $attempt['question']['choices']);
    }

    public function test_existing_adventures_with_null_choice_order_keep_their_original_choices_and_feedback(): void
    {
        $this->learner();
        $attempt = $this->postJson('/api/v1/attempts', ['skill_id' => Skill::firstOrFail()->id])->assertOk()->json();
        AttemptQuestion::where('attempt_id', $attempt['id'])->update(['choice_order' => null]);
        $revision = QuestionRevision::findOrFail($attempt['question']['id']);
        $original = array_map(fn (array $choice): array => array_intersect_key($choice, array_flip(['id', 'text', 'image_url'])), $revision->choices);
        $this->getJson('/api/v1/attempts/'.$attempt['id'])->assertOk()->assertJsonPath('question.choices', $original);
        $this->postJson('/api/v1/attempts/'.$attempt['id'].'/answers', ['position' => 0, 'question_id' => $revision->id, 'choice_id' => $revision->correct_choice_id])->assertJsonPath('feedback.correct', true);
        $this->getJson('/api/v1/attempts/active')->assertJsonPath('question.choices', $original)->assertJsonPath('feedback.selected_choice_id', $revision->correct_choice_id);
        $this->assertSame(0, AttemptQuestion::whereNotNull('choice_order')->count());
    }

    public function test_every_rank_boundary_and_the_highest_rank_keep_lifetime_points(): void
    {
        foreach ([[0, 'Curious Cub', 100], [99, 'Curious Cub', 100], [100, 'Trail Finder', 250], [249, 'Trail Finder', 250], [250, 'Bright Explorer', 500], [499, 'Bright Explorer', 500], [500, 'Star Adventurer', 1000], [999, 'Star Adventurer', 1000], [1000, 'Quest Champion', null], [1200, 'Quest Champion', null]] as [$points, $title, $next]) {
            $rank = ExplorerRank::forPoints($points);
            $this->assertSame($points, $rank['points']);
            $this->assertSame($title, $rank['title']);
            $this->assertSame($next, $rank['next_min_points']);
        }
    }

    public function test_historical_points_exclude_incomplete_attempts_and_remain_scoped_to_each_child_and_family(): void
    {
        $child = $this->learner();
        foreach ([5, 0, 3] as $score) {
            Attempt::create(['child_profile_id' => $child->id, 'skill_id' => Skill::first()->id, 'status' => 'completed', 'position' => 4, 'score' => $score, 'completed_at' => now()->subDays(5)]);
        }
        foreach (['active', 'superseded'] as $status) {
            Attempt::create(['child_profile_id' => $child->id, 'skill_id' => Skill::first()->id, 'status' => $status, 'position' => 0, 'score' => 5]);
        }
        $sibling = ChildProfile::create(['user_id' => $child->user_id, 'nickname' => 'Sam', 'avatar' => 'bear', 'age_band' => '9-10']);
        Attempt::create(['child_profile_id' => $sibling->id, 'skill_id' => Skill::first()->id, 'status' => 'completed', 'position' => 4, 'score' => 5, 'completed_at' => now()]);
        $this->getJson('/api/v1/children/'.$child->id.'/progress')->assertOk()->assertJsonPath('explorer_rank.points', 46);
        $this->getJson('/api/v1/children/'.$sibling->id.'/progress')->assertForbidden();
        $this->withSession(['mode' => 'adult'])->getJson('/api/v1/children/'.$sibling->id.'/progress')->assertJsonPath('explorer_rank.points', 20);
        $this->postJson('/api/v1/children/'.$sibling->id.'/enter')->assertJsonPath('child.id', $sibling->id)->assertJsonPath('mode', 'child');
        $this->getJson('/api/v1/children/'.$child->id.'/progress')->assertForbidden();
        $this->actingAs(User::factory()->create())->withSession(['mode' => 'adult'])->getJson('/api/v1/children/'.$child->id.'/progress')->assertNotFound();
    }

    public function test_only_completion_earns_points_retries_are_safe_and_replays_earn_new_points(): void
    {
        $child = $this->learner();
        $attempt = $this->postJson('/api/v1/attempts', ['skill_id' => Skill::first()->id])->assertOk()->json();
        $revision = QuestionRevision::findOrFail($attempt['question']['id']);
        $this->postJson('/api/v1/attempts/'.$attempt['id'].'/answers', ['position' => 0, 'question_id' => $revision->id, 'choice_id' => $revision->correct_choice_id])->assertOk();
        $this->getJson('/api/v1/children/'.$child->id.'/progress')->assertJsonPath('explorer_rank.points', 0);
        $completed = $this->complete(3);
        $this->getJson('/api/v1/children/'.$child->id.'/progress')->assertJsonPath('explorer_rank.points', 16);
        $this->postJson('/api/v1/attempts/'.$completed['id'].'/next', ['position' => 4])->assertOk();
        $this->getJson('/api/v1/children/'.$child->id.'/progress')->assertJsonPath('explorer_rank.points', 16);
        $this->complete(0);
        $this->getJson('/api/v1/children/'.$child->id.'/progress')->assertJsonPath('completed', 2)->assertJsonPath('explorer_rank.points', 26);
        $this->assertDatabaseCount('rewards', 2);
    }
}
