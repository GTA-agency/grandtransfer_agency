"use client";
import { useEffect, useState } from "react";
import { fmtToken, shortAddr, trimEth } from "@/lib/format";
import { usdLabel, useEthUsd } from "@/lib/usd";
import { useWalletName } from "@/lib/wallet-name";
import type { DraftDto } from "@/shared/types";
import { IconArrow, IconExternal, Stars } from "./Icons";
import { useSendFlow, type SendOutcome } from "./send-flow";

export type PlanStatus = "open" | "sent" | "aborted" | "busted" | "expired";

interface Props {
  draft: DraftDto;
  status: PlanStatus;
  onFinished: (status: PlanStatus, outcome?: SendOutcome) => void;
}

function useCountdown(until: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return Math.max(0, Math.round((until - now) / 1000));
}

/** The confirmation card. Nothing is signed until the user presses Confirm here. */
export function PlanCard({ draft, status, onFinished }: Props) {
  const send = useSendFlow();
  const walletName = useWalletName();
  const usd = useEthUsd();
  const token = draft.token;
  const amountUsd = token ? null : usdLabel(draft.amountEth, usd);
  const totalUsd = token ? null : usdLabel(draft.totalEth, usd);
  const [busy, setBusy] = useState(false);
  const left = useCountdown(draft.expiresAt);
  const open = status === "open";

  useEffect(() => {
    if (open && left === 0) onFinished("expired");
  }, [open, left, onFinished]);

  const confirm = async () => {
    setBusy(true);
    const outcome = await send(draft);
    setBusy(false);
    onFinished(outcome.kind === "sent" ? "sent" : "busted", outcome);
  };

  const label = {
    open: null,
    sent: <span className="pill lime">Sent</span>,
    aborted: <span className="pill">Aborted</span>,
    busted: <span className="pill red">Busted</span>,
    expired: <span className="pill">Expired</span>,
  }[status];

  return (
    <section
      className={`plan-card${draft.isNewRecipient && open ? " new" : ""}${open ? "" : " closed"}`}
      aria-label="Transfer plan, waiting for your confirmation"
    >
      <div className="title-row">
        <p className="eyebrow">The plan</p>
        {label ?? <Stars level={draft.wantedLevel} />}
      </div>
      <dl className="plan-rows">
        <dt>To</dt>
        <dd className="strong">{draft.contactName ?? "Unknown address"}</dd>
        <dt>Address</dt>
        <dd className="mono">{draft.to}</dd>
        <dt>Amount</dt>
        <dd className="strong">
          {token ? `${fmtToken(token.amount, 18)} ${token.symbol}` : `${draft.amountEth} ETH`}
          {amountUsd && <span className="usd-inline">{amountUsd}</span>}
        </dd>
        {token && (
          <>
            <dt>Token</dt>
            <dd>
              Official ${token.symbol} · <span className="mono">{shortAddr(token.address)}</span>
            </dd>
          </>
        )}
        <dt>Est. gas</dt>
        <dd>{trimEth(draft.estimatedFeeEth, 9)} ETH max</dd>
        {!token && (
          <>
            <dt className="total">Total</dt>
            <dd className="total strong">
              {trimEth(draft.totalEth, 9)} ETH
              {totalUsd && <span className="usd-inline">{totalUsd}</span>}
            </dd>
          </>
        )}
        <dt>Network</dt>
        <dd>Robinhood Chain · 4663</dd>
        <dt>Signs with</dt>
        <dd>{walletName}</dd>
      </dl>

      {open && draft.isNewRecipient && (
        <div className="warn-box" role="alert">
          <div>
            <strong>⚠ New recipient.</strong> You've never sent here and it isn't a contact. Check
            every character.{" "}
            <a href={draft.explorerAddressUrl} target="_blank" rel="noreferrer noopener">
              Look it up <IconExternal size={12} />
            </a>
          </div>
        </div>
      )}

      {open && (
        <>
          <div className="plan-actions">
            <button type="button" className="btn lime" onClick={confirm} disabled={busy}>
              {busy ? <span className="spinner" /> : null}
              {busy ? `Waiting for ${walletName}…` : `Confirm in ${walletName}`}
              {!busy && <IconArrow className="arrow" />}
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => onFinished("aborted")}
              disabled={busy}
            >
              Abort
            </button>
          </div>
          <div className="plan-meta">
            <span>Nothing moves until you confirm.</span>
            <span>
              Plan expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
            </span>
          </div>
        </>
      )}
    </section>
  );
}
