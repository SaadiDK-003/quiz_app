<?php

namespace App\Http\Controllers;

use App\Models\ActivityEvent;
use App\Models\Attempt;
use App\Models\ChildProfile;
use App\Models\Reward;
use App\Models\Skill;
use App\Models\Subject;
use App\Services\ChildAgeRange;
use App\Services\ExplorerRank;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\Response;

class FamilyController extends Controller
{
    public function catalog(Request $r): Collection
    {
        $childId = $r->session()->get('child_id');
        $child = $childId ? $r->user()->children()->find($childId) : null;
        $age = $child ? ChildAgeRange::from($child->age_band) : null;
        $done = $child ? $child->attempts()->where('status', 'completed')->pluck('skill_id')->all() : [];
        $flags = [];
        foreach (ChildAgeRange::cases() as $band) {
            $flags['available_'.strtolower($band->name)] = $band;
        }

        $subjects = Subject::where('active', true)->orderBy('position')->with(['skills' => function ($skills) use ($age, $flags) {
            $skills->where('active', true)->withCount(['questions' => fn (Builder $questions) => $questions
                ->where('status', 'published')->when($age, fn (Builder $query) => $query->forAge($age))]);
            if ($age) {
                $skills->whereHas('questions', fn (Builder $query) => $query->forAge($age));
            } else {
                foreach ($flags as $column => $band) {
                    $skills->withExists(['questions as '.$column => fn (Builder $query) => $query->forAge($band)]);
                }
            }
        }])->get();
        if ($age) {
            $subjects = $subjects->filter(fn (Subject $subject) => $subject->skills->isNotEmpty())->values();
        }

        return $subjects->map(function (Subject $subject) use ($done, $age, $flags): array {
            $data = $subject->toArray();
            $data['skills'] = $subject->skills->map(function (Skill $skill) use ($done, $age, $flags): array {
                $bands = $age ? [$age->value] : collect($flags)
                    ->filter(fn (ChildAgeRange $band, string $column) => $skill->getAttribute($column))
                    ->map(fn (ChildAgeRange $band) => $band->value)->values()->all();

                return array_merge(Arr::except($skill->toArray(), array_keys($flags)), [
                    'question_count' => $skill->questions_count,
                    'completed' => in_array($skill->id, $done, true),
                    'age_bands' => $bands,
                ]);
            });

            return $data;
        });
    }

    private function data(Request $r): array
    {
        $v = $r->validate(['nickname' => 'required|string|max:40', 'avatar' => 'required|in:fox,bear,bunny,panda,cat,frog', 'age_band' => ['required', Rule::enum(ChildAgeRange::class)], 'starting_skills' => 'nullable|array', 'starting_skills.*' => 'integer|exists:skills,id']);
        foreach (($v['starting_skills'] ?? []) as $subject => $skill) {
            abort_unless(Skill::whereKey($skill)->where('subject_id', $subject)->exists(), 422, 'Choose a starting skill within each subject.');
        }

        return $v;
    }

    public function children(Request $r): \Illuminate\Database\Eloquent\Collection
    {
        return $r->user()->children()->get();
    }

    public function store(Request $r): JsonResponse
    {
        abort_if($r->user()->children()->count() >= 10, 422, 'A family can have up to ten explorers.');

        return response()->json($r->user()->children()->create($this->data($r)), 201);
    }

    public function update(Request $r, ChildProfile $child): ChildProfile
    {
        abort_unless($child->user_id === $r->user()->id, 404);
        $data = $this->data($r);

        return DB::transaction(function () use ($child, $data): ChildProfile {
            $profile = ChildProfile::lockForUpdate()->findOrFail($child->id);
            if ($profile->age_band !== $data['age_band']) {
                $age = ChildAgeRange::from($data['age_band']);
                foreach ($profile->attempts()->where('status', 'active')->lockForUpdate()->get() as $attempt) {
                    if (! $attempt->fitsAge($age)) {
                        $attempt->update(['status' => 'superseded']);
                    }
                }
            }
            $profile->update($data);

            return $profile;
        });
    }

    public function destroy(Request $r, ChildProfile $child): Response
    {
        abort_unless($child->user_id === $r->user()->id, 404);
        $child->delete();

        return response()->noContent();
    }

    public function enter(Request $r, ChildProfile $child): array
    {
        abort_unless($child->user_id === $r->user()->id, 404);
        $r->session()->regenerate();
        $r->session()->put(['mode' => 'child', 'child_id' => $child->id]);
        ActivityEvent::create(['child_profile_id' => $child->id, 'event' => 'visit']);

        return app(AuthController::class)->session($r);
    }

    public function progress(Request $r, ChildProfile $child): array
    {
        abort_unless($child->user_id === $r->user()->id, 404);
        if ($r->session()->get('mode') === 'child') {
            abort_unless((int) $r->session()->get('child_id') === $child->id, 403);
        }
        $attempts = $child->attempts()->where('status', 'completed')->with('skill.subject')->get();
        $count = $attempts->count();

        return [
            'completed' => $count,
            'stars' => $count,
            'accuracy' => $count ? (int) round($attempts->sum('score') / $attempts->sum('total') * 100) : 0,
            'explorer_rank' => ExplorerRank::forPoints(10 * $count + 2 * (int) $attempts->sum('score')),
            'skills' => $attempts->groupBy('skill_id')->map(fn ($rows) => [
                'id' => $rows->first()->skill_id,
                'name' => $rows->first()->skill->name,
                'subject' => $rows->first()->skill->subject->name,
                'completed' => $rows->count(),
                'accuracy' => (int) round($rows->sum('score') / $rows->sum('total') * 100),
            ])->values(),
            'recent' => $attempts->sortByDesc('completed_at')->take(10)->map(fn (Attempt $attempt) => [
                'id' => $attempt->id,
                'skill_name' => $attempt->skill->name,
                'score' => $attempt->score,
                'total' => $attempt->total,
                'completed_at' => $attempt->completed_at->toIso8601String(),
            ])->values(),
            'stickers' => Reward::where('child_profile_id', $child->id)->latest()->get()->map(fn (Reward $reward) => [
                'id' => $reward->id,
                'name' => $reward->name,
                'icon' => $reward->icon,
                'earned_at' => $reward->created_at->toIso8601String(),
            ]),
        ];
    }
}
