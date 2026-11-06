<?php

namespace App\Services;

use App\Models\ChildProfile;
use App\Models\Question;
use App\Models\QuestionRevision;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class AdventureQuestionSelector
{
    /** @return array<int, string> */
    public function choiceOrder(QuestionRevision $revision): array
    {
        return collect($revision->choices)->pluck('id')->shuffle()->all();
    }

    /** @return Collection<int, Question> */
    public function select(ChildProfile $child, int $skillId): Collection
    {
        $pool = Question::where('skill_id', $skillId)->where('status', 'published')->with('latestRevision')->get();
        $history = DB::table('attempt_questions')
            ->join('attempts', 'attempts.id', '=', 'attempt_questions.attempt_id')
            ->join('question_revisions', 'question_revisions.id', '=', 'attempt_questions.question_revision_id')
            ->where('attempts.child_profile_id', $child->id)
            ->whereNotNull('attempt_questions.answered_at')
            ->whereIn('question_revisions.question_id', $pool->pluck('id'))
            ->groupBy('question_revisions.question_id')
            ->selectRaw('question_revisions.question_id, MAX(attempt_questions.answered_at) AS last_checked')
            ->pluck('last_checked', 'question_id');
        $ranked = $pool->shuffle()->sortBy(fn (Question $q): string => $history[$q->id] ?? '')->values();
        $chosen = collect();
        foreach (['starter' => 2, 'growing' => 2, 'challenge' => 1] as $level => $count) {
            $chosen = $chosen->concat($ranked->filter(fn (Question $q): bool => $q->latestRevision->difficulty === $level)->take($count));
        }
        foreach (['starter', 'growing', 'challenge'] as $level) {
            $chosen = $chosen->concat($ranked->filter(fn (Question $q): bool => $q->latestRevision->difficulty === $level && ! $chosen->contains('id', $q->id))->take(5 - $chosen->count()));
        }
        $levels = ['starter' => 0, 'growing' => 1, 'challenge' => 2];

        return $chosen->sortBy(fn (Question $q): int => $levels[$q->latestRevision->difficulty])->values();
    }
}
