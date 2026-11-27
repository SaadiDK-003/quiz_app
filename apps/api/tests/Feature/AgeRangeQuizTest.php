<?php

namespace Tests\Feature;

use App\Models\Attempt;
use App\Models\Question;
use App\Models\QuestionRevision;
use App\Models\Skill;
use App\Models\User;
use App\Services\ChildAgeRange;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class AgeRangeQuizTest extends TestCase
{
    use RefreshDatabase;

    private User $parent;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
        $this->seed();
        $this->parent = User::factory()->create();
        $this->actingAs($this->parent);
    }

    private function profile(string $age): array
    {
        return ['nickname' => 'Jo', 'avatar' => 'fox', 'age_band' => $age];
    }

    private function createChild(string $age): int
    {
        return $this->withSession(['mode' => 'adult', 'child_id' => null])
            ->postJson('/api/v1/children', $this->profile($age))->assertCreated()->json('id');
    }

    private function changeAge(int $id, string $age): void
    {
        $this->withSession(['mode' => 'adult', 'child_id' => null])->putJson("/api/v1/children/$id", $this->profile($age))
            ->assertOk()->assertJsonPath('age_band', $age);
    }

    private function enter(int $id): void
    {
        $this->withSession(['mode' => 'adult', 'child_id' => null])->postJson("/api/v1/children/$id/enter")->assertOk();
    }

    private function skill(string $slug): Skill
    {
        return Skill::where('slug', $slug)->firstOrFail();
    }

    private function start(Skill $skill): array
    {
        return $this->postJson('/api/v1/attempts', ['skill_id' => $skill->id])->assertOk()->json();
    }

    private function answer(array $attempt, bool $correct = true): array
    {
        $revision = QuestionRevision::findOrFail($attempt['question']['id']);
        $choice = $correct ? $revision->correct_choice_id : collect($revision->choices)->firstWhere('id', '!=', $revision->correct_choice_id)['id'];

        return $this->postJson("/api/v1/attempts/{$attempt['id']}/answers", [
            'position' => $attempt['position'],
            'question_id' => $revision->id,
            'choice_id' => $choice,
        ])->assertOk()->assertJsonPath('feedback.correct', $correct)->json();
    }

    private function advance(array $attempt): array
    {
        return $this->postJson("/api/v1/attempts/{$attempt['id']}/next", ['position' => $attempt['position']])->assertOk()->json();
    }

    private function catalogCounts(): array
    {
        return collect($this->getJson('/api/v1/catalog?age_band=9-10')->assertOk()->json())
            ->flatMap(fn (array $subject) => $subject['skills'])->pluck('question_count', 'slug')->all();
    }

    public function test_learner_catalog_and_selection_respect_the_saved_age_and_latest_revision(): void
    {
        $shapes = $this->skill('match-shapes');
        $placeValue = $this->skill('place-value');
        $shared = $placeValue->questions()->forAge(ChildAgeRange::Younger)->forAge(ChildAgeRange::Older)->take(5)->get();
        $olderOnly = $placeValue->questions()->forAge(ChildAgeRange::Older)->whereNotIn('id', $shared->modelKeys())->take(5)->get();
        foreach ($olderOnly as $question) {
            $question->latestRevision->update(['age_bands' => ['9-10']]);
        }
        Question::whereKey(array_merge($shared->modelKeys(), $olderOnly->modelKeys()))->update(['status' => 'published']);
        $changed = $shared->first();
        $changed->revisions()->create([
            ...Arr::except($changed->latestRevision->toArray(), ['id', 'created_at', 'updated_at']),
            'version' => 2,
            'age_bands' => ['9-10'],
        ]);

        $young = $this->createChild('7-8');
        $this->enter($young);
        $this->assertSame(4, $this->catalogCounts()['place-value']);
        $this->assertArrayNotHasKey('match-shapes', $this->catalogCounts());
        $this->postJson('/api/v1/attempts', ['skill_id' => $placeValue->id])->assertUnprocessable();
        $this->postJson('/api/v1/attempts', ['skill_id' => $shapes->id])->assertUnprocessable();

        $preschool = $this->createChild('3-4');
        $this->enter($preschool);
        $this->assertSame(0, $this->catalogCounts()['match-shapes']);
        $this->assertArrayNotHasKey('place-value', $this->catalogCounts());
        $this->postJson('/api/v1/attempts', ['skill_id' => $placeValue->id])->assertUnprocessable();

        $older = $this->createChild('9-10');
        $this->enter($older);
        $this->assertSame(10, $this->catalogCounts()['place-value']);
        $this->assertSame(5, $this->start($placeValue)['total']);
    }

    public function test_picture_round_scores_three_questions_saves_feedback_and_awards_one_reward(): void
    {
        $id = $this->createChild('3-4');
        $skill = $this->skill('match-animals');
        $skill->questions()->update(['status' => 'published']);
        $this->enter($id);
        $attempt = $this->start($skill);
        $this->assertSame(3, $attempt['total']);
        $this->assertCount(3, $attempt['question']['choices']);
        $this->assertNotEmpty($attempt['question']['image_alt']);
        $this->assertNull($attempt['question']['audio_url']);

        foreach ($attempt['question']['choices'] as $choice) {
            Storage::disk('public')->assertExists(substr($choice['image_url'], strlen('/storage/')));
        }
        $attempt = $this->answer($attempt);
        $this->getJson('/api/v1/attempts/active')->assertExactJson($attempt);
        $attempt = $this->advance($attempt);
        $attempt = $this->advance($this->answer($attempt, false));
        $last = $this->answer($attempt);
        $result = $this->advance($last);
        $this->assertSame('completed', $result['status']);
        $this->assertSame(2, $result['score']);
        $this->assertSame($result, $this->advance($last));
        $this->assertDatabaseCount('rewards', 1);

        $this->getJson("/api/v1/children/$id/progress")->assertOk()->assertJsonPath('accuracy', 67)
            ->assertJsonPath('skills.0.accuracy', 67)->assertJsonPath('recent.0.total', 3)
            ->assertJsonPath('explorer_rank.points', 14);

        $this->changeAge($id, '9-10');
        $this->assertDatabaseHas('attempts', ['id' => $result['id'], 'status' => 'completed', 'score' => 2, 'total' => 3]);
        $this->assertDatabaseCount('rewards', 1);
        $olderSkill = $this->skill('place-value');
        $olderSkill->questions()->update(['status' => 'published']);
        $this->enter($id);
        $attempt = $this->start($olderSkill);
        for ($i = 0; $i < 5; $i++) {
            $attempt = $this->advance($this->answer($attempt, $i < 4));
        }
        $this->getJson("/api/v1/children/$id/progress")->assertOk()->assertJsonPath('accuracy', 75)
            ->assertJsonPath('completed', 2)->assertJsonPath('explorer_rank.points', 32);
    }

    public function test_age_change_resumes_a_compatible_snapshot_and_closes_an_incompatible_one(): void
    {
        $id = $this->createChild('7-8');
        $skill = $this->skill('place-value');
        $skill->questions()->forAge(ChildAgeRange::Younger)->forAge(ChildAgeRange::Older)->update(['status' => 'published']);
        $this->enter($id);
        $attempt = $this->answer($this->advance($this->answer($this->start($skill))));
        $this->assertSame(1, $attempt['position']);

        $this->changeAge($id, '9-10');
        $this->enter($id);
        $this->getJson('/api/v1/attempts/active')->assertExactJson($attempt);

        $this->changeAge($id, '3-4');
        $this->enter($id);
        $this->assertSame('null', $this->getJson('/api/v1/attempts/active')->assertOk()->getContent());
        $this->getJson("/api/v1/attempts/{$attempt['id']}")->assertConflict();
        $this->postJson("/api/v1/attempts/{$attempt['id']}/next", ['position' => 1])->assertConflict();
        $saved = Attempt::findOrFail($attempt['id']);
        $this->assertSame('superseded', $saved->status);
        $this->assertSame(2, $saved->items()->whereNotNull('answered_at')->count());

        $pictureSkill = $this->skill('match-shapes');
        $pictureSkill->questions()->update(['status' => 'published']);
        $next = $this->start($pictureSkill);
        $this->assertSame(0, $next['position']);
        $this->assertSame(3, $next['total']);
    }

    public function test_preschool_publishing_checks_apply_to_administrators_and_moderator_drafts(): void
    {
        $question = $this->skill('match-shapes')->questions()->with('latestRevision')->firstOrFail();
        $payload = [
            ...$question->latestRevision->toArray(),
            'skill_id' => $question->skill_id,
            'answers_reviewed' => true,
            'explanation_reviewed' => true,
            'status' => 'published',
        ];
        $this->parent->forceFill(['role' => 'admin'])->save();
        $adminUrl = "/api/v1/admin/questions/{$question->id}";
        $this->withSession(['mode' => 'adult'])->putJson($adminUrl, [...$payload, 'age_bands' => []])->assertUnprocessable();
        $this->putJson($adminUrl, [...$payload, 'image_alt' => null])->assertUnprocessable();
        $this->putJson($adminUrl, [...$payload, 'age_bands' => ['5-6']])->assertUnprocessable();
        $this->putJson($adminUrl, $payload)->assertOk()->assertJsonPath('age_bands', ['3-4']);

        $this->parent->forceFill(['role' => 'parent', 'can_moderate' => true])->save();
        $proposal = $this->postJson('/api/v1/studio/proposals', [
            ...$payload,
            'question_id' => null,
            'image_path' => null,
            'image_alt' => null,
            'status' => 'draft',
        ])->assertCreated()->json('id');
        $this->postJson("/api/v1/studio/proposals/$proposal/submit", ['version' => 1])->assertUnprocessable();
        $this->assertDatabaseHas('question_proposals', ['id' => $proposal, 'state' => 'draft']);
    }
}
