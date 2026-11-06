import { Sparkles, Trophy } from "lucide-react";
import type { ExplorerRank } from "@little-quest/api-client";

export function ExplorerRankCard({ rank }: { rank: ExplorerRank }) {
  const next = rank.next_min_points;
  const percent =
    next === null
      ? 100
      : Math.min(
          100,
          Math.max(
            0,
            ((rank.points - rank.min_points) / (next - rank.min_points)) * 100,
          ),
        );
  return (
    <section className="explorer-rank-card" aria-label="Your explorer journey">
      <span className="rank-emblem" aria-hidden="true">
        <Trophy size={28} />
      </span>
      <div className="rank-copy">
        <span className="rank-label">YOUR EXPLORER JOURNEY</span>
        <h2>
          {rank.title} <Sparkles size={19} aria-hidden="true" />
        </h2>
        <p>
          {next === null
            ? "Keep exploring. Every adventure helps you grow!"
            : `${next - rank.points} more points to become a ${rank.next_title}.`}
        </p>
        <div
          className="rank-track"
          role="progressbar"
          aria-label={
            rank.next_title
              ? `Progress toward ${rank.next_title}`
              : "Quest Champion reached"
          }
          aria-valuemin={rank.min_points}
          aria-valuemax={next ?? rank.points}
          aria-valuenow={rank.points}
          aria-valuetext={
            next === null
              ? `${rank.points} adventure points. Highest rank reached.`
              : `${rank.points} adventure points. Next rank at ${next}.`
          }
        >
          <span style={{ width: `${percent}%` }} />
        </div>
      </div>
      <div className="rank-points">
        <strong>{rank.points.toLocaleString("en")}</strong>
        <span>adventure points</span>
      </div>
    </section>
  );
}
