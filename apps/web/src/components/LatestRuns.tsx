import { fmtDate, shortAddr, trimEth } from "@/lib/format";
import type { EntryDto } from "@/shared/types";
import { StatusPill } from "./Books";
import { Scene, type SceneVariant } from "./Scene";

export function LatestRuns({ entries }: { entries: EntryDto[] | null }) {
  return (
    <section id="runs" className="section" aria-labelledby="runs-title">
      <div className="section-head">
        <div>
          <p className="eyebrow">Activity</p>
          <h2 id="runs-title" className="display lg">
            Latest runs
          </h2>
        </div>
      </div>
      {entries && entries.length === 0 ? (
        <div className="empty-runs">No runs yet. Your first send or a sync will show up here.</div>
      ) : (
        <div className="runs">
          {(entries ?? []).slice(0, 6).map((e, i) => {
            const variant: SceneVariant =
              e.status === "failed"
                ? "busted"
                : e.direction === "in"
                  ? "ocean"
                  : i % 2
                    ? "gold"
                    : "sunset";
            const who =
              e.contactName ?? (e.source === "internal" ? "a contract" : shortAddr(e.counterparty));
            return (
              <a
                key={`${e.hash}-${e.direction}`}
                className="run-card reveal"
                href={e.explorerUrl}
                target="_blank"
                rel="noreferrer noopener"
              >
                <div className="run-art">
                  <Scene
                    variant={variant}
                    seed={20 + i}
                    palms={i % 2 ? "left" : "right"}
                    sunX={i % 2 ? 0.68 : 0.32}
                    sunSize={0.9}
                    horizon={500}
                    skyline={e.direction === "in"}
                  />
                  <div className="run-amt">
                    {e.direction === "in" ? "+" : "-"}
                    {trimEth(e.amountEth)} ETH
                  </div>
                </div>
                <div className="run-body">
                  <div className="title">
                    {e.direction === "in" ? "Received from" : "Sent to"} {who}
                  </div>
                  <div className="meta">
                    <span>{fmtDate(e.timestamp)}</span>
                    <StatusPill e={e} />
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      )}
    </section>
  );
}
