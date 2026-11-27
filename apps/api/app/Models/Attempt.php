<?php

namespace App\Models;

use App\Services\ChildAgeRange;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Attempt extends Model
{
    protected $guarded = [];

    protected $attributes = ['total' => 5];

    protected function casts(): array
    {
        return ['completed_at' => 'datetime', 'total' => 'integer'];
    }

    public function skill(): BelongsTo
    {
        return $this->belongsTo(Skill::class);
    }

    public function items(): HasMany
    {
        return $this->hasMany(AttemptQuestion::class)->orderBy('position');
    }

    public function fitsAge(ChildAgeRange $age): bool
    {
        return $this->total === $age->roundLength()
            && $this->items()->whereHas('revision', fn ($revision) => $revision->whereJsonContains('age_bands', $age->value))->count() === $this->total;
    }
}
