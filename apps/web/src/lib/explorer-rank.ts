import type { ExplorerRank } from "@little-quest/api-client";

const ranks = [
  { title: "Curious Cub", min_points: 0 },
  { title: "Trail Finder", min_points: 100 },
  { title: "Bright Explorer", min_points: 250 },
  { title: "Star Adventurer", min_points: 500 },
  { title: "Quest Champion", min_points: 1000 },
];

export function explorerRank(points: number): ExplorerRank {
  let current = ranks[0];
  let next: (typeof ranks)[number] | undefined;
  for (const rank of ranks) {
    if (points < rank.min_points) {
      next = rank;
      break;
    }
    current = rank;
  }
  return {
    points,
    ...current,
    next_title: next?.title ?? null,
    next_min_points: next?.min_points ?? null,
  };
}

export const adventurePoints = (score: number) => 10 + 2 * score;
