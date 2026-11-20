"use client";
import { useEffect, useRef } from "react";
import { trimEth } from "@/lib/format";
import { usdLabel, useEthUsd } from "@/lib/usd";
import { IconExternal } from "./Icons";
import { Scene } from "./Scene";

export type ResultView =
  | {
      kind: "win" | "road";
      amountEth: string;
      to: string;
      hash: string;
      explorerUrl: string;
      feeEth: string | null;
    }
  | { kind: "lose"; reason: string; hash?: string; explorerUrl?: string };

export function ResultOverlay({ view, onClose }: { view: ResultView; onClose: () => void }) {
  const usd = useEthUsd();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const title =
    view.kind === "win" ? "Clean getaway" : view.kind === "road" ? "On the road" : "Busted";
  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="result-title"
      onClick={onClose}
    >
      <div className={`result ${view.kind}`} onClick={(e) => e.stopPropagation()}>
        <div className="result-art">
          <Scene
            variant={view.kind === "lose" ? "busted" : view.kind === "road" ? "gold" : "sunset"}
            seed={view.kind === "lose" ? 13 : 5}
            sunSize={0.9}
            horizon={430}
          />
          <h2 id="result-title" className="result-title">
            {title}
          </h2>
        </div>
        <div className="result-body">
          {view.kind === "lose" ? (
            <>
              <p style={{ margin: 0, color: "var(--cream)", fontSize: 16 }}>{view.reason}</p>
              {(view.hash || !/nothing was sent/i.test(view.reason)) && (
                <p className="faint" style={{ margin: 0, fontSize: 13 }}>
                  {view.hash ? "A transaction was broadcast, check it below." : "Nothing was sent."}
                </p>
              )}
            </>
          ) : (
            <>
              <div>
                <div className="amount">
                  {view.amountEth} ETH
                  {usdLabel(view.amountEth, usd) && (
                    <span className="usd-inline big">{usdLabel(view.amountEth, usd)}</span>
                  )}
                </div>
                <div className="muted">
                  to <strong style={{ color: "var(--cream)" }}>{view.to}</strong>
                  {view.feeEth && <> · gas {trimEth(view.feeEth, 9)} ETH</>}
                </div>
              </div>
              {view.kind === "road" && (
                <p style={{ margin: 0, color: "var(--gold)" }}>
                  Sent, still waiting for the network to confirm it. It'll settle on the next sync.
                </p>
              )}
              <div className="mono faint break" style={{ fontSize: 12 }}>
                {view.hash}
              </div>
            </>
          )}
          <div className="plan-actions">
            {view.explorerUrl && (
              <a
                className="btn peach"
                href={view.explorerUrl}
                target="_blank"
                rel="noreferrer noopener"
              >
                View on Blockscout <IconExternal size={14} />
              </a>
            )}
            <button ref={closeRef} type="button" className="btn ghost" onClick={onClose}>
              {view.kind === "lose" ? "Close" : "Back to the city"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
