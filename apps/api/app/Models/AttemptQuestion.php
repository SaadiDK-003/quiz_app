<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AttemptQuestion extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return ['correct' => 'boolean', 'answered_at' => 'datetime', 'choice_order' => 'array'];
    }

    /** @return array<int, array{id: string, text: string, image_url?: string|null}> */
    public function orderedChoices(): array
    {
        $choices = $this->revision->choices;
        if ($this->choice_order === null) {
            return $choices;
        }

        $byId = array_column($choices, null, 'id');

        return array_map(fn (string $id): array => $byId[$id], $this->choice_order);
    }

    public function revision(): BelongsTo
    {
        return $this->belongsTo(QuestionRevision::class, 'question_revision_id');
    }
}
