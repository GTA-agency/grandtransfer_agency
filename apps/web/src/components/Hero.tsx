"use client";
import { useWalletName } from "@/lib/wallet-name";
import { shortAddr, trimEth } from "@/lib/format";
import { usdLabel, useEthUsd } from "@/lib/usd";
import type { OverviewDto } from "@/shared/types";
import { CopyButton } from "./CopyButton";
import { IconExternal } from "./Icons";
import { Fx, useParallax } from "./motion";
import { Scene } from "./Scene";

export function Hero({ overview, onStart }: { overview: OverviewDto | null; onStart: () => void }) {
  const o = overview;
  const walletName = useWalletName();
  const usd = useEthUsd();
  const balanceUsd = usdLabel(o?.balanceEth, usd);
  const sentUsd = usdLabel(o?.sentLast24hEth, usd);
  const ref = useParallax<HTMLElement>();
  return (
    <section ref={ref} className="hero parallax" aria-labelledby="balance-title">
      <Scene variant="sunset" seed={7} sunX={0.7} sunSize={1.1} palms="right" />
      <div className="vignette" />
      <Fx />
      <div className="hero-body">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span className="pill mint">
            <span className="dot" /> Robinhood Chain · 4663
          </span>
          <span className="pill">{walletName}</span>
        </div>
        <div>
          <p className="eyebrow" id="balance-title">
            Your balance
          </p>
          <div className="balance" aria-live="polite">
            {o ? (o.balanceEth !== null ? trimEth(o.balanceEth, 6) : "—") : "…"}
            <small>ETH</small>
          </div>
          {balanceUsd && <div className="balance-usd">{balanceUsd}</div>}
          {o?.balanceError && (
            <p className="form-error" style={{ marginTop: 8 }}>
              {o.balanceError}
            </p>
          )}
        </div>
        {o && (
          <div className="addr-row">
            <div className="addr-box">
              <span className="mono" title={o.address}>
                <span className="addr-full">{o.address}</span>
              </span>
              <CopyButton text={o.address} />
              <a
                className="icon-btn"
                href={o.explorerUrl}
                target="_blank"
                rel="noreferrer noopener"
                aria-label="Open on Blockscout"
                title="Open on Blockscout"
              >
                <IconExternal size={14} />
              </a>
            </div>
          </div>
        )}
        <div className="hero-stats">
          <div className="stat-chip">
            <div className="k">Sent last 24h</div>
            <div className="v">
              {o ? trimEth(o.sentLast24hEth) : "…"}{" "}
              <span style={{ fontSize: 13, color: "var(--text-2)" }}>
                / {o?.limits.maxDailyEth ?? "…"}
              </span>
            </div>
            {sentUsd && o?.sentLast24hEth !== "0" && <div className="chip-usd">{sentUsd}</div>}
            <div className="meter" aria-hidden="true">
              <span
                style={{
                  width: `${o && o.sentLast24hEth !== "0" ? Math.max(o.dailyUsedPct, 2) : 0}%`,
                }}
              />
            </div>
          </div>
          <div className="stat-chip">
            <div className="k">Max per run</div>
            <div className="v">{o?.limits.maxTxEth ?? "…"} ETH</div>
          </div>
        </div>
        <div>
          <button type="button" className="btn hot" onClick={onStart}>
            Start a run <span className="arrow">→</span>
          </button>
        </div>
      </div>
      <span className="sr-only">{o ? `Address ${shortAddr(o.address)}` : ""}</span>
    </section>
  );
}
