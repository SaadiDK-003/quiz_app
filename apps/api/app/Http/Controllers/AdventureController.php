<?php

namespace App\Http\Controllers;

use App\Models\ActivityEvent;
use App\Models\Attempt;
use App\Models\AttemptQuestion;
use App\Models\ChildProfile;
use App\Models\Question;
use App\Models\Reward;
use App\Models\Skill;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\Response;

class AdventureController extends Controller
{
    private function own(Request $r, Attempt $a): void
    {
        abort_unless($a->child_profile_id === (int) $r->session()->get('child_id'), 404);
    }

    public function show(Request $r, Attempt $attempt): array
    {
        $this->own($r, $attempt);

        return $this->present($attempt);
    }

    public function active(Request $r): Response
    {
        $a = Attempt::where('child_profile_id', $r->session()->get('child_id'))->where('status', 'active')->first();

        return $a ? response()->json($this->present($a)) : response('null', 200, ['Content-Type' => 'application/json']);
    }

    public function start(Request $r): array
    {
        $v = $r->validate(['skill_id' => 'required|integer|exists:skills,id']);

        return DB::transaction(function () use ($r, $v) {
            $child = ChildProfile::lockForUpdate()->findOrFail($r->session()->get('child_id'));
            $old = Attempt::where('child_profile_id', $child->id)->where('status', 'active')->first();
            if ($old) {
                return $this->present($old);
            }
            $skill = Skill::with('subject')->findOrFail($v['skill_id']);
            abort_unless($skill->active && $skill->subject->active, 422, 'This skill is taking a little rest.');
            $questions = Question::where('skill_id', $skill->id)->where('status', 'published')->with('latestRevision')->inRandomOrder()->limit(5)->get();
            abort_unless($questions->count() === 5, 422, 'This adventure is still being prepared. Try another skill soon.');
            $a = Attempt::create(['child_profile_id' => $child->id, 'skill_id' => $skill->id, 'position' => 0, 'status' => 'active', 'score' => 0]);
            foreach ($questions as $position => $q) {
                AttemptQuestion::create(['attempt_id' => $a->id, 'question_revision_id' => $q->latestRevision->id, 'position' => $position]);
            }ActivityEvent::create(['child_profile_id' => $child->id, 'attempt_id' => $a->id, 'event' => 'started']);

            return $this->present($a);
        });
    }

    public function answer(Request $r, Attempt $attempt): array
    {
        $this->own($r, $attempt);
        $v = $r->validate(['position' => 'required|integer|min:0|max:4', 'question_id' => 'required|integer', 'choice_id' => 'required|string|max:20']);

        return DB::transaction(function () use ($v, $attempt) {
            $a = Attempt::lockForUpdate()->findOrFail($attempt->id);
            if ($a->status === 'completed') {
                return $this->present($a);
            }abort_unless($a->position === $v['position'], 409, 'Your adventure has moved on. Resume to continue.');
            $item = $a->items()->where('position', $a->position)->with('revision')->firstOrFail();
            abort_unless($item->question_revision_id === $v['question_id'], 409, 'Please resume the current question.');
            abort_unless(in_array($v['choice_id'], array_column($item->revision->choices, 'id'), true), 422, 'Choose one of the answer cards.');
            if (! $item->answered_at) {
                $item->update(['selected_choice_id' => $v['choice_id'], 'correct' => $v['choice_id'] === $item->revision->correct_choice_id, 'answered_at' => now()]);
            }

            return $this->present($a);
        });
    }

    public function next(Request $r, Attempt $attempt): array
    {
        $this->own($r, $attempt);
        $v = $r->validate(['position' => 'required|integer|min:0|max:4']);

        return DB::transaction(function () use ($v, $attempt) {
            $a = Attempt::lockForUpdate()->findOrFail($attempt->id);
            if ($a->status === 'completed' || $a->position !== $v['position']) {
                return $this->present($a);
            }
            $item = $a->items()->where('position', $a->position)->firstOrFail();
            abort_unless($item->answered_at, 422, 'Choose an answer before moving on.');
            if ($a->position === 4) {
                $a->update(['status' => 'completed', 'score' => $a->items()->where('correct', true)->count(), 'completed_at' => now()]);
                Reward::firstOrCreate(['attempt_id' => $a->id], ['child_profile_id' => $a->child_profile_id, 'name' => $a->skill->name.' explorer', 'icon' => $a->skill->subject->slug === 'maths' ? 'star' : 'book']);
                ActivityEvent::create(['child_profile_id' => $a->child_profile_id, 'attempt_id' => $a->id, 'event' => 'completed']);
            } else {
                $a->increment('position');
            }

            return $this->present($a->fresh());
        });
    }

    public function error(Request $r): Response
    {
        $v = $r->validate(['code' => 'required|in:connection,audio,request']);
        ActivityEvent::create(['child_profile_id' => $r->session()->get('child_id'), 'event' => 'error', 'metadata' => $v]);

        return response()->noContent();
    }

    public function present(Attempt $a): array
    {
        $a->loadMissing('skill.subject');
        $item = $a->items()->where('position', $a->position)->with('revision')->first();
        $q = $item?->revision;
        $complete = $a->status === 'completed';

        return ['id' => $a->id, 'skill_id' => $a->skill_id, 'skill_name' => $a->skill->name, 'subject_slug' => $a->skill->subject->slug, 'status' => $a->status, 'position' => $a->position, 'total' => 5, 'answered' => $a->items()->whereNotNull('answered_at')->count(), 'score' => $complete ? $a->score : 0, 'question' => $complete ? null : ['id' => $q->id, 'prompt' => $q->prompt, 'instruction' => $q->instruction, 'choices' => array_map(fn (array $choice): array => Arr::only($choice, ['id', 'text', 'image_url']), $q->choices), 'image_url' => $q->image_path ? Storage::disk('public')->url($q->image_path) : null, 'image_alt' => $q->image_alt, 'audio_url' => $q->audio_path ? Storage::disk('public')->url($q->audio_path) : null], 'feedback' => ! $complete && $item->answered_at ? ['correct' => $item->correct, 'explanation' => $q->explanation, 'correct_choice_id' => $q->correct_choice_id, 'selected_choice_id' => $item->selected_choice_id] : null, 'reward' => $complete ? $a->skill->name.' explorer' : null];
    }
}
