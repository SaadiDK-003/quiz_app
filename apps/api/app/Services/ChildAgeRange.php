<?php

namespace App\Services;

enum ChildAgeRange: string
{
    case Preschool = '3-4';
    case Younger = '7-8';
    case Older = '9-10';

    public function roundLength(): int
    {
        return $this === self::Preschool ? 3 : 5;
    }
}
