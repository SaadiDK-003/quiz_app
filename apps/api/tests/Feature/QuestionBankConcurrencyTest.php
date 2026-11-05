<?php

namespace Tests\Feature;

use App\Models\Question;
use App\Services\QuestionBankImporter;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\Concurrency;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class QuestionBankConcurrencyTest extends TestCase
{
    use DatabaseMigrations;

    public function test_parallel_imports_create_one_revision_per_question(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            $this->markTestSkipped('Parallel import locking is verified in the isolated PostgreSQL test database.');
        }
        $this->seed();
        Question::query()->delete();

        $results = Concurrency::driver('process')->run([
            static fn (): array => app(QuestionBankImporter::class)->bundled(),
            static fn (): array => app(QuestionBankImporter::class)->bundled(),
        ]);

        $created = array_column($results, 'created');
        sort($created);
        $this->assertSame([0, 360], $created);
        $this->assertSame(360, array_sum(array_column($results, 'skipped')));
        $this->assertDatabaseCount('questions', 360);
        $this->assertDatabaseCount('question_revisions', 360);
    }
}
