import { fmtDate, shortAddr, trimEth, fmtToken } from "@/lib/format";
import type { NotifyState } from "@/lib/incoming";
import type { EntryDto } from "@/shared/types";
import { StatusPill } from "./Books";
import { Scene, type SceneVariant } from "./Scene";

const NOTIFY_LABEL: Record<NotifyState, string> = {
  on: "🔔 Notifications on",
  off: "🔕 Notify me of incoming ETH",
  blocked: "🔕 Notifications blocked in browser settings",
  unsupported: "",
};

export function LatestRuns({
  entries,
  notify,
  onToggleNotify,
}: {
  entries: EntryDto[] | null;
  notify?: NotifyState;
  onToggleNotify?: () => void;
}) {
  return (
    <section id="runs" className="section" aria-labelledby="runs-title">
      <div className="section-head">
        <div>
          <p className="eyebrow">Activity</p>
          <h2 id="runs-title" className="display lg">
            Latest runs
          </h2>
        </div>
        {notify && notify !== "unsupported" && (
          <button
            type="button"
            className={`btn small ${notify === "on" ? "mint" : "ghost"}`}
            onClick={onToggleNotify}
            disabled={notify === "blocked"}
            aria-pressed={notify === "on"}
            title="While this page is open, new incoming ETH shows up as a notification"
          >
            {NOTIFY_LABEL[notify]}
          </button>
        )}
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
                    {e.token
                      ? `${fmtToken(e.token.amount)} ${e.token.symbol}`
                      : `${trimEth(e.amountEth)} ETH`}
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
