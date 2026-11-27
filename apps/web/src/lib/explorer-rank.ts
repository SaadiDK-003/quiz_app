import type { ExplorerRank } from "@little-quest/api-client";

export const explorerBadges = [
  { title: "Curious Cub", min_points: 0, emblem: "paw" },
  { title: "Trail Finder", min_points: 100, emblem: "compass" },
  { title: "Bright Explorer", min_points: 250, emblem: "light" },
  { title: "Star Adventurer", min_points: 500, emblem: "star" },
  { title: "Quest Champion", min_points: 1000, emblem: "trophy" },
] as const;

export type ExplorerBadge = (typeof explorerBadges)[number];

export function earnedExplorerBadges(points: number) {
  return explorerBadges.filter((badge) => badge.min_points <= points);
}

export function explorerRank(points: number): ExplorerRank {
  const earned = earnedExplorerBadges(points);
  const current = earned.at(-1) ?? explorerBadges[0];
  const next = explorerBadges[earned.length];
  return {
    points,
    title: current.title,
    min_points: current.min_points,
    next_title: next?.title ?? null,
    next_min_points: next?.min_points ?? null,
  };
}

export const adventurePoints = (score: number) => 10 + 2 * score;
