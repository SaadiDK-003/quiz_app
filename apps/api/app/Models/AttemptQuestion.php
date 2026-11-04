<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AttemptQuestion extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return ['correct' => 'boolean', 'answered_at' => 'datetime'];
    }

    public function revision(): BelongsTo
    {
        return $this->belongsTo(QuestionRevision::class, 'question_revision_id');
    }
}
