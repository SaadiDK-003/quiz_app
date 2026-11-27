<?php

namespace App\Services;

use App\Models\Question;
use App\Models\Skill;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class QuestionBankImporter
{
    public function __construct(private BundledQuestionContent $content) {}

    /** @return array{created: int, skipped: int} */
    public function bundled(): array
    {
        return $this->import([...$this->content->read('questions'), ...$this->content->read('preschool-questions')]);
    }

    /**
     * @param  array<mixed>  $rows
     * @return array{created: int, skipped: int}
     */
    public function import(array $rows): array
    {
        Validator::make(['questions' => $rows], ['questions' => 'required|array|list|min:1'])->validate();
        $keys = [];
        foreach ($rows as $row) {
            Validator::make(['question' => $row], [
                'question' => 'required|array:seed_key,skill,prompt,instruction,choices,correct_choice_id,explanation,difficulty,locale,age_bands,image_path,image_alt',
                'question.seed_key' => 'required|string|max:100',
                'question.skill' => 'required|string|max:100',
                'question.age_bands' => 'required|array|list|min:1|max:3',
                'question.age_bands.*' => ['required', 'distinct:strict', Rule::enum(ChildAgeRange::class)],
                'question.prompt' => 'required|string|max:2000',
                'question.instruction' => 'required|string|max:500',
                'question.choices' => 'required|array|list|min:2|max:4',
                'question.choices.*' => 'required|array:id,text,image_url',
                'question.choices.*.id' => 'required|string|max:20|distinct:strict',
                'question.choices.*.text' => 'required|string|max:300',
                'question.choices.*.image_url' => 'sometimes|required|string|max:500',
                'question.image_path' => 'sometimes|required|string|max:500',
                'question.image_alt' => 'required_with:question.image_path|string|max:300',
                'question.correct_choice_id' => 'required|string|max:20',
                'question.explanation' => 'required|string|max:2000',
                'question.difficulty' => 'required|in:starter,growing,challenge',
                'question.locale' => 'required|in:en',
            ])->validate();
            $texts = array_map(fn (array $choice): string => trim($choice['text']), $row['choices']);
            $preschool = in_array(ChildAgeRange::Preschool->value, $row['age_bands'], true);
            $size = count($row['choices']);
            if (isset($keys[$row['seed_key']]) || count(array_unique($texts)) !== $size || ! in_array($row['correct_choice_id'], array_column($row['choices'], 'id'), true)) {
                throw ValidationException::withMessages(['pack' => 'Each bundled question needs a unique identifier, distinct choices and a correct answer from those choices.']);
            }
            $images = array_column($row['choices'], 'image_url');
            $prefix = BundledQuestionContent::PRESCHOOL_MEDIA;
            if ($preschool ? ($size > 3 || ! str_starts_with($row['image_path'] ?? '', $prefix) || count(array_unique($images)) !== $size) : ($size !== 4 || isset($row['image_path']) || $images !== [])) {
                throw ValidationException::withMessages(['pack' => 'Preschool questions need a picture clue and two or three different picture choices. Older bundled questions use four text choices.']);
            }
            foreach ($images as $image) {
                if (! str_starts_with($image, '/storage/'.$prefix)) {
                    throw ValidationException::withMessages(['pack' => 'Bundled picture choices must use the included preschool images.']);
                }
            }
            $keys[$row['seed_key']] = true;
        }

        return DB::transaction(function () use ($rows): array {
            // All importers acquire the same ordered skill locks before checking keys.
            $skills = Skill::whereIn('slug', array_column($rows, 'skill'))->orderBy('id')->lockForUpdate()->get()->pluck('id', 'slug');
            $existing = Question::whereIn('seed_key', array_column($rows, 'seed_key'))->pluck('id', 'seed_key');
            $missing = collect($rows)->reject(fn (array $row): bool => isset($existing[$row['seed_key']]))->pluck('skill')->unique()->diff($skills->keys());
            if ($missing->isNotEmpty()) {
                throw ValidationException::withMessages(['pack' => 'Required learning skills are missing: '.$missing->implode(', ').'. Restore their original slugs before importing.']);
            }
            $created = 0;
            foreach ($rows as $row) {
                $question = Question::firstOrCreate(['seed_key' => $row['seed_key']], ['skill_id' => $skills[$row['skill']] ?? null, 'status' => 'draft']);
                if (! $question->wasRecentlyCreated) {
                    continue;
                }
                if (isset($row['image_path'])) {
                    $this->content->copyImage($row['image_path']);
                    foreach ($row['choices'] as $choice) {
                        $this->content->copyImage(substr($choice['image_url'], strlen('/storage/')));
                    }
                }
                $content = collect($row)->except(['seed_key', 'skill'])->all();
                $question->revisions()->create(array_merge($content, ['version' => 1, 'answers_reviewed' => false, 'explanation_reviewed' => false, 'narration_reviewed' => false]));
                $created++;
            }

            return ['created' => $created, 'skipped' => count($rows) - $created];
        }, attempts: 3);
    }
}
