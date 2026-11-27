<?php

namespace App\Services;

use App\Models\Question;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

class QuestionContent
{
    public function validate(array $input): array
    {
        $v = Validator::make($input, ['skill_id' => 'required|integer|exists:skills,id', 'prompt' => 'required|string|max:2000', 'instruction' => 'required|string|max:500', 'choices' => 'required|array|list|min:2|max:4', 'choices.*.id' => 'required|string|max:20|distinct', 'choices.*.text' => 'required|string|max:300', 'choices.*.image_url' => 'nullable|string|max:500', 'correct_choice_id' => 'required|string|max:20', 'explanation' => 'required|string|max:2000', 'difficulty' => 'required|in:starter,growing,challenge', 'locale' => 'required|in:en', 'status' => 'required|in:draft,published,archived', 'image_path' => 'nullable|string|max:500', 'image_alt' => 'nullable|string|max:300', 'audio_path' => 'nullable|string|max:500', 'answers_reviewed' => 'required|boolean', 'explanation_reviewed' => 'required|boolean', 'narration_reviewed' => 'sometimes|boolean', 'age_bands' => 'sometimes|array|list|max:3', 'age_bands.*' => ['required', 'distinct:strict', Rule::enum(ChildAgeRange::class)]])->validate();
        $v['age_bands'] ??= [];
        abort_unless(in_array($v['correct_choice_id'], array_column($v['choices'], 'id'), true), 422, 'Choose a correct answer from the cards.');
        foreach (['audio_path', 'image_path'] as $field) {
            if (! empty($v[$field])) {
                abort_unless(str_starts_with($v[$field], 'media/') && ! str_contains($v[$field], '..') && Storage::disk('public')->exists($v[$field]), 422, 'Please upload the media file first.');
            }
        }
        foreach (['audio_path' => ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/ogg', 'video/ogg'], 'image_path' => ['image/png', 'image/jpeg', 'image/webp']] as $field => $types) {
            if (! empty($v[$field])) {
                abort_unless(in_array(Storage::disk('public')->mimeType($v[$field]), $types, true), 422, 'Upload the correct image or audio file type.');
            }
        }
        foreach ($v['choices'] as $choice) {
            if (! empty($choice['image_url'])) {
                $path = substr($choice['image_url'], strlen('/storage/'));
                abort_unless(str_starts_with($choice['image_url'], '/storage/media/') && ! str_contains($choice['image_url'], '..') && Storage::disk('public')->exists($path), 422, 'Upload answer pictures through the media library.');
                abort_unless(in_array(Storage::disk('public')->mimeType($path), ['image/png', 'image/jpeg', 'image/webp'], true), 422, 'Answer pictures must be images.');
            }
        }
        $hasNarration = ! empty($v['audio_path']);
        $v['narration_reviewed'] = $hasNarration && ($v['narration_reviewed'] ?? false);
        if ($v['status'] === 'published') {
            $this->validateAgeEligibility($v);
            abort_unless($v['answers_reviewed'] && $v['explanation_reviewed'], 422, 'Review the question, answers and explanation before publishing.');
            abort_if($hasNarration && ! $v['narration_reviewed'], 422, 'Listen to the attached narration and mark it reviewed before publishing.');
            abort_if(! empty($v['image_path']) && empty($v['image_alt']), 422, 'Describe the illustration before publishing.');
        }

        return $v;
    }

    public function validateAgeEligibility(array $data): void
    {
        $ages = $data['age_bands'] ?? [];
        abort_if($ages === [], 422, 'Choose an age range for this question.');

        if (in_array(ChildAgeRange::Preschool->value, $ages, true)) {
            $images = array_filter(array_column($data['choices'], 'image_url'));
            abort_unless(! empty($data['image_path']) && ! empty($data['image_alt']) && count($data['choices']) <= 3 && count(array_unique($images)) === count($data['choices']), 422, 'Ages 3–4 need a picture clue with a description and two or three different picture choices.');
        }
    }

    public function save(array $v, ?Question $question = null): array
    {
        return DB::transaction(function () use ($v, $question) {
            if ($question?->exists) {
                $question = Question::lockForUpdate()->findOrFail($question->id);
            } else {
                $question = Question::create(['skill_id' => $v['skill_id'], 'status' => 'draft']);
            }
            $version = ($question->revisions()->max('version') ?? 0) + 1;
            $question->update(['skill_id' => $v['skill_id'], 'status' => $v['status']]);
            $data = collect($v)->except(['skill_id', 'status'])->all();
            $question->revisions()->create(array_merge($data, ['version' => $version]));

            return $this->present($question->load(['latestRevision', 'skill']));
        });
    }

    public function present(Question $q): array
    {
        return array_merge($q->latestRevision->toArray(), ['id' => $q->id, 'skill_id' => $q->skill_id, 'skill_name' => $q->skill->name, 'status' => $q->status]);
    }
}
