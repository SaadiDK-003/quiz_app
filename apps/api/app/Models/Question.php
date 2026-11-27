<?php

namespace App\Models;

use App\Services\ChildAgeRange;
use Illuminate\Database\Eloquent\Builder;
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

    public function scopeForAge(Builder $query, ChildAgeRange $age): Builder
    {
        return $query->whereHas('latestRevision', fn (Builder $revision) => $revision->whereJsonContains('age_bands', $age->value));
    }
}
