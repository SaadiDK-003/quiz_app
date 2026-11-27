<?php

use App\Services\BundledQuestionContent;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('question_revisions', function (Blueprint $table) {
            $table->json('age_bands')->default('[]');
        });
        Schema::table('attempts', function (Blueprint $table) {
            $table->unsignedTinyInteger('total')->default(5);
        });

        $bundled = app(BundledQuestionContent::class);
        $bank = array_column($bundled->read('questions'), null, 'seed_key');
        DB::table('question_revisions')
            ->join('questions', 'questions.id', '=', 'question_revisions.question_id')
            ->whereNotNull('questions.seed_key')
            ->select('question_revisions.*', 'questions.seed_key')
            ->chunkById(200, function ($revisions) use ($bank) {
                foreach ($revisions as $revision) {
                    $original = $bank[$revision->seed_key] ?? null;
                    if ($original && $this->matchesBundledContent($revision, $original)) {
                        DB::table('question_revisions')->where('id', $revision->id)
                            ->update(['age_bands' => json_encode($original['age_bands'], JSON_THROW_ON_ERROR)]);
                    }
                }
            }, 'question_revisions.id', 'id');
        $bundled->addPreschoolSkills();
    }

    private function matchesBundledContent(object $revision, array $original): bool
    {
        foreach (['prompt', 'instruction', 'correct_choice_id', 'explanation', 'locale', 'difficulty'] as $field) {
            if ($original[$field] !== $revision->$field) {
                return false;
            }
        }

        $choices = json_decode($revision->choices, true, flags: JSON_THROW_ON_ERROR);
        foreach ($choices as &$choice) {
            if (array_key_exists('image_url', $choice) && $choice['image_url'] === null) {
                unset($choice['image_url']);
            }
        }

        return $revision->image_path === null && $choices == $original['choices'];
    }

    public function down(): void
    {
        Schema::table('attempts', fn (Blueprint $table) => $table->dropColumn('total'));
        Schema::table('question_revisions', fn (Blueprint $table) => $table->dropColumn('age_bands'));
    }
};
