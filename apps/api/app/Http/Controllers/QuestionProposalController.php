<?php

namespace App\Http\Controllers;

use App\Models\Question;
use App\Models\Skill;
use App\Services\QuestionContent;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use stdClass;

class QuestionProposalController extends Controller
{
    public function __construct(private QuestionContent $questions) {}

    public function index(Request $request): Collection
    {
        $query = $this->query()->leftJoin('users', 'question_proposals.author_id', '=', 'users.id')
            ->select('question_proposals.*', 'users.name as author_name');
        if ($request->user()->role !== 'admin') {
            $query->where('author_id', $request->user()->id);
        }
        $skills = Skill::pluck('name', 'id');

        return $query->orderByDesc('question_proposals.updated_at')->orderByDesc('question_proposals.id')
            ->get()->map(fn (stdClass $proposal) => $this->present($proposal, $skills));
    }

    public function store(Request $request): JsonResponse
    {
        $target = $request->validate([
            'question_id' => 'nullable|integer|exists:questions,id',
            'question_version' => 'required_with:question_id|nullable|integer|min:1',
        ]);
        $content = $this->draftContent($request);
        $id = DB::transaction(function () use ($request, $target, $content) {
            $questionId = $target['question_id'] ?? null;
            $version = isset($target['question_version']) ? (int) $target['question_version'] : null;
            if ($questionId !== null) {
                $question = Question::whereKey($questionId)->lockForUpdate()->firstOrFail();
                abort_unless($question->latestRevision?->version === $version, 409, 'The question changed. Refresh the quiz library and start your draft from the current version.');
            }

            return $this->query()->insertGetId([
                'question_id' => $questionId,
                'base_version' => $questionId === null ? null : $version,
                'author_id' => $request->user()->id,
                'content' => json_encode($content, JSON_THROW_ON_ERROR),
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        });

        return response()->json(['id' => $id], 201);
    }

    public function update(Request $request, int $proposal): array
    {
        $data = $request->validate(['version' => 'required|integer|min:1']);
        $content = $this->draftContent($request);
        DB::transaction(function () use ($request, $proposal, $data, $content) {
            $draft = $this->ownedDraft($request, $proposal, (int) $data['version']);
            $this->query()->where('id', $proposal)->update([
                'content' => json_encode($content, JSON_THROW_ON_ERROR),
                'version' => $draft->version + 1,
                'updated_at' => now(),
            ]);
        });

        return ['id' => $proposal];
    }

    public function submit(Request $request, int $proposal): array
    {
        $data = $request->validate(['version' => 'required|integer|min:1']);
        DB::transaction(function () use ($request, $proposal, $data) {
            $draft = $this->ownedDraft($request, $proposal, (int) $data['version']);
            $this->questions->validateAgeEligibility(json_decode($draft->content, true, flags: JSON_THROW_ON_ERROR));
            $this->query()->where('id', $proposal)->update([
                'state' => 'in_review',
                'version' => $draft->version + 1,
                'review_note' => null,
                'reviewer_id' => null,
                'updated_at' => now(),
            ]);
        });

        return ['id' => $proposal];
    }

    public function review(Request $request, int $proposal): array
    {
        $data = $request->validate([
            'version' => 'required|integer|min:1',
            'decision' => 'required|in:publish,return',
            'review_note' => 'required_if:decision,return|nullable|string|max:1000',
            'question_version' => 'nullable|integer|min:1',
            'answers_reviewed' => 'required_if:decision,publish|boolean',
            'explanation_reviewed' => 'required_if:decision,publish|boolean',
            'narration_reviewed' => 'sometimes|boolean',
        ]);

        return DB::transaction(function () use ($request, $proposal, $data) {
            $draft = $this->query()->where('id', $proposal)->lockForUpdate()->first();
            abort_unless($draft, 404);
            abort_unless($draft->state === 'in_review' && $draft->version === (int) $data['version'], 409, 'This draft changed. Refresh the review queue before continuing.');

            $questionId = $draft->question_id;
            if ($data['decision'] === 'publish') {
                $question = $questionId === null ? null : Question::whereKey($questionId)->lockForUpdate()->firstOrFail();
                $comparedVersion = isset($data['question_version']) ? (int) $data['question_version'] : null;
                abort_unless($question?->latestRevision?->version === $comparedVersion, 409, 'The current question changed. Refresh and compare it again before publishing.');
                $payload = array_merge(json_decode($draft->content, true, flags: JSON_THROW_ON_ERROR), [
                    'status' => 'published',
                    'answers_reviewed' => $data['answers_reviewed'],
                    'explanation_reviewed' => $data['explanation_reviewed'],
                    'narration_reviewed' => $data['narration_reviewed'] ?? false,
                ]);
                $questionId = $this->questions->save($this->questions->validate($payload), $question)['id'];
            }

            $this->query()->where('id', $proposal)->update([
                'question_id' => $questionId,
                'reviewer_id' => $request->user()->id,
                'review_note' => $data['review_note'] ?? null,
                'state' => $data['decision'] === 'publish' ? 'published' : 'changes_requested',
                'version' => $draft->version + 1,
                'updated_at' => now(),
            ]);

            return ['id' => $proposal];
        });
    }

    private function query(): Builder
    {
        return DB::table('question_proposals');
    }

    private function draftContent(Request $request): array
    {
        return $this->questions->validate(array_merge([
            'audio_path' => null,
            'image_path' => null,
            'image_alt' => null,
        ], $request->all(), [
            'status' => 'draft',
            'answers_reviewed' => false,
            'explanation_reviewed' => false,
            'narration_reviewed' => false,
        ]));
    }

    private function ownedDraft(Request $request, int $id, int $version): stdClass
    {
        $draft = $this->query()->where('id', $id)->where('author_id', $request->user()->id)->lockForUpdate()->first();
        abort_unless($draft, 404);
        abort_unless(in_array($draft->state, ['draft', 'changes_requested'], true) && $draft->version === $version, 409, 'This draft changed or is already under review. Refresh your drafts before continuing.');

        return $draft;
    }

    private function present(stdClass $proposal, Collection $skills): array
    {
        $content = json_decode($proposal->content, true, flags: JSON_THROW_ON_ERROR);

        return [
            'id' => $proposal->id,
            'question_id' => $proposal->question_id,
            'base_version' => $proposal->base_version,
            'version' => $proposal->version,
            'state' => $proposal->state,
            'author_name' => $proposal->author_name,
            'review_note' => $proposal->review_note,
            'question' => array_merge(['age_bands' => []], $content, [
                'id' => $proposal->question_id ?? 0,
                'version' => $proposal->base_version ?? 0,
                'skill_name' => $skills[$content['skill_id']] ?? '',
            ]),
        ];
    }
}
