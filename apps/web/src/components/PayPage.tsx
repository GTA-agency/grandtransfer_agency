"use client";
import { useCallback, useEffect, useState } from "react";
import { buildPaymentLink, type PaymentRequest } from "@gta/core/pay";
import { api, errorMessage, onLocked } from "@/lib/api";
import { fmtToken } from "@/lib/format";
import { usdLabel, useEthUsd } from "@/lib/usd";
import type { DraftDto, SessionDto } from "@/shared/types";
import { WalletChoices } from "./ConnectModal";
import { CopyButton } from "./CopyButton";
import { Footer } from "./Footer";
import { IconArrow, IconExternal } from "./Icons";
import { NavPill } from "./NavPill";
import { PlanCard, type PlanStatus } from "./PlanCard";
import { Providers } from "./Providers";
import { Scene } from "./Scene";
import type { SendOutcome } from "./send-flow";
import { ToastProvider } from "./Toast";

function PayFlow({ request }: { request: PaymentRequest }) {
  const usd = useEthUsd();
  const [info, setInfo] = useState<SessionDto | null>(null);
  const [draft, setDraft] = useState<DraftDto | null>(null);
  const [status, setStatus] = useState<PlanStatus>("open");
  const [outcome, setOutcome] = useState<SendOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<SessionDto>("/api/session").then(setInfo, (e: unknown) => setError(errorMessage(e)));
  }, []);
  useEffect(() => {
    load();
    return onLocked(load);
  }, [load]);

  const review = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ draft: DraftDto }>("/api/transfers/prepare", {
        body: {
          to: request.to,
          amountEth: request.amount,
          ...(request.asset === "gta" ? { asset: "gta" } : {}),
        },
      });
      setStatus("open");
      setOutcome(null);
      setDraft(r.draft);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const symbol = request.asset === "gta" ? "GTA" : "ETH";
  const amountUsd = request.asset === "eth" ? usdLabel(request.amount, usd) : null;
  const signedIn = info?.session?.address;
  const ownLink = signedIn?.toLowerCase() === request.to.toLowerCase();
  const sent = outcome?.kind === "sent" ? outcome.result : null;

  return (
    <div className="pay-card">
      <p className="eyebrow">Payment request</p>
      <div className="pay-amount">
        {fmtToken(request.amount, 18)} <small>{symbol}</small>
      </div>
      {amountUsd && <div className="balance-usd">{amountUsd}</div>}
      <dl className="plan-rows pay-rows">
        <dt>Pay to</dt>
        <dd className="mono">{request.to}</dd>
        <dt>Network</dt>
        <dd>Robinhood Chain · 4663</dd>
        {request.asset === "gta" && (
          <>
            <dt>Token</dt>
            <dd>Official $GTA</dd>
          </>
        )}
      </dl>

      {!sent && (
        <div className="warn-box" role="note">
          <div>
            <strong>Anyone can create a link like this.</strong> Only pay if you know who sent it
            and the address is theirs.
          </div>
        </div>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {!info ? (
        <span className="spinner" aria-label="Loading" />
      ) : !signedIn ? (
        <>
          <p className="pay-next">Connect your wallet to review this payment.</p>
          <WalletChoices onSignedIn={load} tone="hot" />
        </>
      ) : ownLink ? (
        <div className="pay-own">
          <p>This link pays your own wallet. Send it to whoever owes you.</p>
          <div className="pay-link-row">
            <span className="mono">{buildPaymentLink(window.location.origin, request)}</span>
            <CopyButton
              text={buildPaymentLink(window.location.origin, request)}
              label="Copy payment link"
            />
          </div>
        </div>
      ) : draft ? (
        <PlanCard
          draft={draft}
          status={status}
          onFinished={(s, o) => {
            setStatus(s);
            if (o) setOutcome(o);
          }}
        />
      ) : (
        <button
          type="button"
          className="btn hot block"
          onClick={() => void review()}
          disabled={busy}
        >
          {busy ? <span className="spinner" /> : null}
          {busy ? "Building the plan…" : "Review the plan"}
          {!busy && <IconArrow className="arrow" />}
        </button>
      )}

      {sent && (
        <p className="pay-done" role="status">
          {sent.status === "confirmed"
            ? "Paid."
            : sent.status === "pending"
              ? "Sent, waiting for the network."
              : "The transaction failed. The funds did not move."}{" "}
          <a href={sent.explorerUrl} target="_blank" rel="noreferrer noopener">
            View transaction <IconExternal size={12} />
          </a>
        </p>
      )}
      {outcome?.kind === "busted" && (
        <p className="form-error" role="alert">
          {outcome.reason}
        </p>
      )}
      {draft && (status === "expired" || status === "aborted" || outcome?.kind === "busted") && (
        <button
          type="button"
          className="btn ghost block"
          onClick={() => void review()}
          disabled={busy}
        >
          Review again
        </button>
      )}
    </div>
  );
}

/** /pay: someone asked for a payment. The payer reviews the plan and signs with their own wallet. */
export function PayPage({ request }: { request: PaymentRequest | null }) {
  return (
    <Providers>
      <ToastProvider>
        <NavPill
          links={[]}
          homeHref="/"
          actions={
            <a className="btn hot" href="/">
              Open the app <span className="arrow">→</span>
            </a>
          }
        />
        <main id="top" className="shell">
          <section className="pay-hero" aria-label="Payment request">
            <Scene variant="sunset" seed={9} palms="both" sunSize={1.2} sunX={0.5} horizon={430} />
            <div className="vignette" />
            {request ? (
              <PayFlow request={request} />
            ) : (
              <div className="pay-card">
                <p className="eyebrow">Payment request</p>
                <h1 className="pay-bad">This link isn&apos;t valid</h1>
                <p className="pay-next">Ask the person who sent it for a new one.</p>
                <a className="btn ghost block" href="/">
                  Go to the app
                </a>
              </div>
            )}
          </section>
        </main>
        <Footer variant="page" />
      </ToastProvider>
    </Providers>
  );
}
