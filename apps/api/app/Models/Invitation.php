<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Invitation extends Model
{
    public const LEGACY_FAMILY = 'legacy_family';

    public const FAMILY_SIGNUP = 'family_signup';

    public const MODERATOR = 'moderator';

    protected $guarded = [];

    protected function casts(): array
    {
        return ['expires_at' => 'datetime', 'used_at' => 'datetime'];
    }
}
