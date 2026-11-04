<?php

namespace App\Console\Commands;

use App\Models\ActivityEvent;
use Illuminate\Console\Command;

class PilotReport extends Command
{
    protected $signature = 'pilot:report';

    protected $description = 'Show aggregate pilot starts, completions, repeat visitors and errors';

    public function handle(): int
    {
        $counts = ActivityEvent::selectRaw('event, count(*) as total')->groupBy('event')->pluck('total', 'event');
        $repeat = ActivityEvent::where('event', 'visit')->select('child_profile_id')->groupBy('child_profile_id')->havingRaw('count(*) > 1')->get()->count();
        $this->table(['Metric', 'Count'], [['Starts', $counts['started'] ?? 0], ['Completions', $counts['completed'] ?? 0], ['Visits', $counts['visit'] ?? 0], ['Returning explorers', $repeat], ['Errors', $counts['error'] ?? 0]]);

        return self::SUCCESS;
    }
}
