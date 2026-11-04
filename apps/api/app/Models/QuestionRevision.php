<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class QuestionRevision extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return ['choices' => 'array', 'answers_reviewed' => 'boolean', 'explanation_reviewed' => 'boolean', 'narration_reviewed' => 'boolean'];
    }
}
