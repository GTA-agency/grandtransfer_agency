import { trimEth } from "@/lib/format";
import type { OverviewDto } from "@/shared/types";
import { StarShape } from "./Icons";
import { Scene } from "./Scene";

/** Daily use shown as wanted stars: each star is 20% of the 24-hour limit. */
export function LimitsCard({ overview }: { overview: OverviewDto | null }) {
  const pct = overview?.dailyUsedPct ?? 0;
  const sent = overview ? overview.sentLast24hEth !== "0" : false;
  const lit = !sent ? 0 : Math.min(5, Math.max(1, Math.ceil(pct / 20)));
  return (
    <article
      className="art-card lift reveal"
      style={{ ["--d" as string]: "0.1s" }}
      aria-labelledby="limits-title"
    >
      <div className="art-top">
        <Scene variant="gold" seed={9} palms="right" sunX={0.3} sunSize={0.9} horizon={540} />
        <div className="limits-art">
          <div
            className="big-stars"
            role="img"
            aria-label={`${lit} of 5 stars: ${pct}% of the daily limit used`}
          >
            {[0, 1, 2, 3, 4].map((i) => (
              <StarShape key={i} filled={i < lit} />
            ))}
          </div>
          <div className="limit-bars">
            <div className="row">
              <div className="top">
                <span className="muted">Sent in the last 24h</span>
                <strong>
                  {overview ? trimEth(overview.sentLast24hEth) : "…"} /{" "}
                  {overview?.limits.maxDailyEth ?? "…"} ETH
                </strong>
              </div>
              <div className="meter" aria-hidden="true">
                <span style={{ width: `${sent ? Math.max(pct, 2) : 0}%` }} />
              </div>
            </div>
            <div className="row">
              <div className="top">
                <span className="muted">Max per run</span>
                <strong>{overview?.limits.maxTxEth ?? "…"} ETH</strong>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="art-bottom">
        <p className="eyebrow">Wanted level</p>
        <h2 id="limits-title" className="display md">
          Limits that keep you clean
        </h2>
        <p className="muted" style={{ margin: 0 }}>
          Per-run and daily caps are enforced in code, not by the AI. New recipients get a loud
          warning and an address check. Bigger runs light up more stars.
        </p>
      </div>
    </article>
  );
}
