<?php

namespace App\Http\Controllers;

use App\Models\ActivityEvent;
use App\Models\Attempt;
use App\Models\ChildProfile;
use App\Models\Reward;
use App\Models\Skill;
use App\Models\Subject;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Symfony\Component\HttpFoundation\Response;

class FamilyController extends Controller
{
    public function catalog(Request $r): Collection
    {
        $childId = $r->session()->get('child_id');
        $done = $childId ? Attempt::where('child_profile_id', $childId)->where('status', 'completed')->pluck('skill_id')->all() : [];

        return Subject::where('active', true)->orderBy('position')->with(['skills' => fn ($q) => $q->where('active', true)->withCount(['questions' => fn ($q) => $q->where('status', 'published')])])->get()->map(function ($s) use ($done) {
            $data = $s->toArray();
            $data['skills'] = $s->skills->map(fn ($k) => array_merge($k->toArray(), ['question_count' => $k->questions_count, 'completed' => in_array($k->id, $done)]));

            return $data;
        });
    }

    private function data(Request $r): array
    {
        $v = $r->validate(['nickname' => 'required|string|max:40', 'avatar' => 'required|in:fox,bear,bunny,panda,cat,frog', 'age_band' => 'required|in:7-8,9-10', 'starting_skills' => 'nullable|array', 'starting_skills.*' => 'integer|exists:skills,id']);
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
        $child->update($this->data($r));

        return $child;
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

        return ['completed' => $count, 'stars' => $count, 'accuracy' => $count ? (int) round($attempts->sum('score') / ($count * 5) * 100) : 0, 'skills' => $attempts->groupBy('skill_id')->map(fn ($rows) => ['id' => $rows->first()->skill_id, 'name' => $rows->first()->skill->name, 'subject' => $rows->first()->skill->subject->name, 'completed' => $rows->count(), 'accuracy' => (int) round($rows->sum('score') / ($rows->count() * 5) * 100)])->values(), 'recent' => $attempts->sortByDesc('completed_at')->take(10)->map(fn ($a) => ['id' => $a->id, 'skill_name' => $a->skill->name, 'score' => $a->score, 'total' => 5, 'completed_at' => $a->completed_at->toIso8601String()])->values(), 'stickers' => Reward::where('child_profile_id', $child->id)->latest()->get()->map(fn ($x) => ['id' => $x->id, 'name' => $x->name, 'icon' => $x->icon, 'earned_at' => $x->created_at->toIso8601String()])];
    }
}
