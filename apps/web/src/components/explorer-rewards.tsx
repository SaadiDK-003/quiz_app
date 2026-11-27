import { useEffect, useRef } from "react";
import { ArrowRight, BookOpen, Check, LockKeyhole, Star } from "lucide-react";
import type { Progress } from "@little-quest/api-client";
import { earnedExplorerBadges, explorerBadges } from "@/lib/explorer-rank";
import { ExplorerBadgeMark } from "./explorer-rank-card";

function collectStickers(stickers: Progress["stickers"]) {
  const collection = new Map<
    string,
    { name: string; icon: string; count: number }
  >();
  for (const sticker of stickers) {
    const key = JSON.stringify([sticker.name, sticker.icon]);
    const group = collection.get(key);
    if (group) group.count += 1;
    else
      collection.set(key, { name: sticker.name, icon: sticker.icon, count: 1 });
  }
  return collection;
}

export function ExplorerRewards({
  progress,
  onExplore,
  busy,
}: {
  progress: Progress;
  onExplore: () => void;
  busy: boolean;
}) {
  const points = progress.explorer_rank.points;
  const earned = earnedExplorerBadges(points);
  const stickers = collectStickers(progress.stickers);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: "center" });
  }, []);

  return (
    <>
      <div className="page-heading">
        <div>
          <h1 ref={heading} tabIndex={-1}>
            My rewards
          </h1>
          <p>
            Finish adventures to collect stickers and earn points for badges.
          </p>
        </div>
      </div>
      <section
        className="reward-section"
        aria-labelledby="explorer-badges-heading"
      >
        <div className="reward-section-heading">
          <h2 id="explorer-badges-heading">Explorer badges</h2>
          <p>
            {earned.length === explorerBadges.length
              ? "Journey complete! You earned every badge."
              : `${earned.length} of ${explorerBadges.length} badges earned`}
          </p>
        </div>
        <ol className="badge-grid">
          {explorerBadges.map((badge) => {
            const unlocked = badge.min_points <= points;
            return (
              <li
                className={`badge-tile ${unlocked ? "badge-earned" : "badge-locked"}`}
                key={badge.emblem}
              >
                <ExplorerBadgeMark badge={badge} />
                <h3>{badge.title}</h3>
                <p className="badge-status">
                  {unlocked ? (
                    <>
                      <Check size={16} aria-hidden="true" /> Earned
                    </>
                  ) : (
                    <>
                      <LockKeyhole size={15} aria-hidden="true" />{" "}
                      {badge.min_points.toLocaleString("en")} points to unlock
                    </>
                  )}
                </p>
              </li>
            );
          })}
        </ol>
      </section>
      <section
        className="reward-section"
        aria-labelledby="adventure-stickers-heading"
      >
        <div className="reward-section-heading">
          <h2 id="adventure-stickers-heading">Adventure stickers</h2>
          <p>
            {progress.stickers.length}{" "}
            {progress.stickers.length === 1 ? "sticker" : "stickers"} earned
          </p>
        </div>
        {stickers.size === 0 ? (
          <div className="empty-state">
            <h3>Your first sticker is waiting!</h3>
            <button
              className="button primary"
              onClick={onExplore}
              disabled={busy}
            >
              Let’s explore <ArrowRight size={18} aria-hidden="true" />
            </button>
          </div>
        ) : (
          <ul className="sticker-grid reward-stickers">
            {Array.from(stickers, ([key, sticker]) => {
              const Icon = sticker.icon === "book" ? BookOpen : Star;
              return (
                <li
                  className={`sticker-card ${sticker.icon === "book" ? "sticker-1" : "sticker-0"}`}
                  key={key}
                >
                  <span aria-hidden="true">
                    <Icon size={36} />
                  </span>
                  <h3>{sticker.name}</h3>
                  <p>
                    Earned {sticker.count}{" "}
                    {sticker.count === 1 ? "time" : "times"}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
