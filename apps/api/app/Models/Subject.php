<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Subject extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return ['active' => 'boolean'];
    }

    public function skills(): HasMany
    {
        return $this->hasMany(Skill::class)->orderBy('position');
    }

    public function topics(): HasMany
    {
        return $this->hasMany(Topic::class);
    }
}
