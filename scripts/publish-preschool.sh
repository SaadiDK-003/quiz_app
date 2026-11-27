#!/usr/bin/env bash
set -euo pipefail

root=/opt/webostics-quiz
project=webostics_quiz
state=$root/shared/current.json
lock=$root/shared/deploy.lock

fail() { printf 'Quiz preschool publishing: %s\n' "$1" >&2; exit 1; }

[[ -f $root/.managed-by-webostics-quiz && $(cat "$root/.managed-by-webostics-quiz") == "$project" ]] ||
  fail 'The managed Quiz deployment was not found on this server.'
[[ -f $lock && ! -L $lock ]] || fail 'The Quiz deployment lock was not found.'
exec 9< "$lock"
flock -n 9 || fail 'A Quiz deployment or backup is running. Retry when it finishes.'
[[ ! -e $root/shared/pending.json ]] || fail 'Finish the pending Quiz deployment before publishing.'
[[ -f $state && ! -L $state ]] || fail 'No successful Quiz deployment was found.'

config=$(python3 - "$root" "$state" <<'PY'
import json
import sys
from pathlib import Path

try:
    with open(sys.argv[2], encoding="utf-8") as source:
        state = json.load(source)
    config = Path(state["config"])
    deployments = Path(sys.argv[1]) / "shared/deployments"
    if (state.get("project") != "webostics_quiz" or config.name != "compose.json"
            or config.parent.parent != deployments or config.resolve(strict=True) != config
            or not config.is_file()):
        raise ValueError()
except (OSError, RuntimeError, KeyError, ValueError, TypeError):
    sys.exit("Quiz preschool publishing: the active Quiz configuration could not be found.")
print(config)
PY
)

docker compose --env-file /dev/null --project-name "$project" \
  --project-directory "$root" --file "$config" exec -T --user www-data api php <<'PHP'
<?php

use App\Models\Question;
use App\Services\BundledQuestionContent;
use App\Services\QuestionBankImporter;
use App\Services\QuestionContent;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

require 'vendor/autoload.php';
$app = require 'bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

try {
    if (! class_exists(BundledQuestionContent::class) || ! Schema::hasColumn('question_revisions', 'age_bands')) {
        fwrite(STDERR, "Deploy the age-based Quiz release before publishing preschool questions.\n");
        exit(1);
    }

    $bundle = app(BundledQuestionContent::class);
    $pack = $bundle->read('preschool-questions');
    $content = app(QuestionContent::class);

    [$published, $alreadyPublished, $skipped] = DB::transaction(function () use ($bundle, $pack, $content): array {
        app(QuestionBankImporter::class)->import($pack);
        $questions = Question::whereIn('seed_key', array_column($pack, 'seed_key'))
            ->orderBy('id')->lockForUpdate()->with(['latestRevision', 'skill'])->get()->keyBy('seed_key');

        $published = 0;
        $alreadyPublished = 0;
        $skipped = [];
        foreach ($pack as $row) {
            $question = $questions->get($row['seed_key']);
            $data = Arr::except($row, ['seed_key', 'skill']);
            $revision = $question->latestRevision;
            if ($question->status === 'archived' || $question->skill->slug !== $row['skill']
                || $revision->audio_path || $revision->only(array_keys($data)) != $data) {
                $skipped[] = $row['seed_key'];
                continue;
            }
            $bundle->copyImage($data['image_path']);
            foreach ($data['choices'] as $choice) {
                $bundle->copyImage(substr($choice['image_url'], strlen('/storage/')));
            }
            if ($question->status === 'published') {
                $alreadyPublished++;
                continue;
            }
            $content->save($content->validate([
                ...$data,
                'skill_id' => $question->skill_id,
                'status' => 'published',
                'answers_reviewed' => true,
                'explanation_reviewed' => true,
            ]), $question);
            $published++;
        }

        return [$published, $alreadyPublished, $skipped];
    });

    printf("Preschool questions: %d published, %d already published, %d kept for manual review.\n", $published, $alreadyPublished, count($skipped));
    if ($skipped !== []) {
        echo "Edited or archived questions left as they were:\n", implode("\n", $skipped), "\n";
    }
} catch (ValidationException $error) {
    fwrite(STDERR, implode("\n", Arr::flatten($error->errors()))."\n");
    exit(1);
} catch (HttpExceptionInterface $error) {
    fwrite(STDERR, $error->getMessage()."\n");
    exit(1);
} catch (Throwable $error) {
    report($error);
    fwrite(STDERR, "Preschool publishing failed. Check the Quiz API logs for details.\n");
    exit(1);
}
PHP
