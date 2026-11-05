<?php

namespace App\Services;

use App\Models\Question;
use App\Models\Skill;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;
use JsonException;

class QuestionBankImporter
{
    /** @return array{created: int, skipped: int} */
    public function bundled(): array
    {
        try {
            $rows = json_decode(file_get_contents(database_path('content/questions.json')), true, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException $e) {
            throw ValidationException::withMessages(['pack' => 'The bundled question pack is not valid JSON.']);
        }

        if (! is_array($rows)) {
            throw ValidationException::withMessages(['pack' => 'The bundled question pack must be a list of questions.']);
        }

        return $this->import($rows);
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
                'question' => 'required|array:seed_key,skill,prompt,instruction,choices,correct_choice_id,explanation,difficulty,locale',
                'question.seed_key' => 'required|string|max:100',
                'question.skill' => 'required|string|max:100',
                'question.prompt' => 'required|string|max:2000',
                'question.instruction' => 'required|string|max:500',
                'question.choices' => 'required|array|list|size:4',
                'question.choices.*' => 'required|array:id,text',
                'question.choices.*.id' => 'required|string|max:20|distinct:strict',
                'question.choices.*.text' => 'required|string|max:300',
                'question.correct_choice_id' => 'required|string|max:20',
                'question.explanation' => 'required|string|max:2000',
                'question.difficulty' => 'required|in:starter,growing,challenge',
                'question.locale' => 'required|in:en',
            ])->validate();
            $texts = array_map(fn (array $choice): string => trim($choice['text']), $row['choices']);
            if (isset($keys[$row['seed_key']]) || count(array_unique($texts)) !== 4 || ! in_array($row['correct_choice_id'], array_column($row['choices'], 'id'), true)) {
                throw ValidationException::withMessages(['pack' => 'Each bundled question needs a unique identifier, four different choices, and a correct answer from those choices.']);
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
                $content = collect($row)->except(['seed_key', 'skill'])->all();
                $question->revisions()->create(array_merge($content, ['version' => 1, 'answers_reviewed' => false, 'explanation_reviewed' => false, 'narration_reviewed' => false]));
                $created++;
            }

            return ['created' => $created, 'skipped' => count($rows) - $created];
        }, attempts: 3);
    }
}
