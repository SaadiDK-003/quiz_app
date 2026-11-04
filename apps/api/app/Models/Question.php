<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Question extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [];
    }

    public function skill(): BelongsTo
    {
        return $this->belongsTo(Skill::class);
    }

    public function revisions(): HasMany
    {
        return $this->hasMany(QuestionRevision::class);
    }

    public function latestRevision(): HasOne
    {
        return $this->hasOne(QuestionRevision::class)->latestOfMany();
    }
}
