import {
  ArrowRight,
  Compass,
  Lightbulb,
  PawPrint,
  Star,
  Trophy,
} from "lucide-react";
import type { ExplorerRank } from "@little-quest/api-client";
import {
  earnedExplorerBadges,
  explorerBadges,
  type ExplorerBadge,
} from "@/lib/explorer-rank";

const badgeIcons = {
  paw: PawPrint,
  compass: Compass,
  light: Lightbulb,
  star: Star,
  trophy: Trophy,
};

export function ExplorerBadgeMark({ badge }: { badge: ExplorerBadge }) {
  const Icon = badgeIcons[badge.emblem];
  return (
    <span className={`rank-emblem badge-${badge.emblem}`} aria-hidden="true">
      <Icon size={28} strokeWidth={2.15} />
    </span>
  );
}

export function ExplorerRankCard({
  rank,
  onViewRewards,
}: {
  rank: ExplorerRank;
  onViewRewards?: () => void;
}) {
  const earned = earnedExplorerBadges(rank.points);
  const current = earned.at(-1) ?? explorerBadges[0];
  const next = rank.next_min_points;
  const totalPoints = rank.points.toLocaleString("en");

  return (
    <section className="explorer-rank-card" aria-label="Your explorer journey">
      <ExplorerBadgeMark badge={current} />
      <div className="rank-copy">
        <span className="rank-label">Your explorer badges</span>
        <h2>{rank.title}</h2>
        {next === null ? (
          <p className="badge-complete">
            Journey complete! You earned all {explorerBadges.length} badges.
          </p>
        ) : (
          <>
            <p>
              Next badge: <strong>{rank.next_title}</strong>
            </p>
            <progress
              className="rank-track"
              aria-label={`Points toward the ${rank.next_title} badge`}
              aria-valuetext={`${totalPoints} of ${next.toLocaleString("en")} adventure points`}
              value={rank.points}
              max={next}
            />
          </>
        )}
      </div>
      <div className="rank-points">
        <strong>
          {next === null
            ? totalPoints
            : `${totalPoints} / ${next.toLocaleString("en")}`}
        </strong>
        <span>adventure points</span>
        {onViewRewards && (
          <button className="text-button" onClick={onViewRewards}>
            See my badges <ArrowRight size={16} aria-hidden="true" />
          </button>
        )}
      </div>
    </section>
  );
}
