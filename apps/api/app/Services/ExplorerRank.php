<?php

namespace App\Services;

class ExplorerRank
{
    private const LEVELS = [
        ['title' => 'Curious Cub', 'min_points' => 0],
        ['title' => 'Trail Finder', 'min_points' => 100],
        ['title' => 'Bright Explorer', 'min_points' => 250],
        ['title' => 'Star Adventurer', 'min_points' => 500],
        ['title' => 'Quest Champion', 'min_points' => 1000],
    ];

    /** @return array{points: int, title: string, min_points: int, next_title: string|null, next_min_points: int|null} */
    public static function forPoints(int $points): array
    {
        $current = self::LEVELS[0];
        $next = null;
        foreach (self::LEVELS as $level) {
            if ($points < $level['min_points']) {
                $next = $level;
                break;
            }
            $current = $level;
        }

        return ['points' => $points, ...$current, 'next_title' => $next['title'] ?? null, 'next_min_points' => $next['min_points'] ?? null];
    }
}
