"use client";
import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import type { ContactDto, DraftDto } from "@/shared/types";
import { IconArrow, IconX } from "./Icons";
import { PlanCard, type PlanStatus } from "./PlanCard";
import type { SendOutcome } from "./send-flow";

/** Send straight from a contact: amount → the same plan card as in chat. No AI involved. */
export function QuickSend({
  contact,
  onClose,
  onOutcome,
}: {
  contact: ContactDto;
  onClose: () => void;
  onOutcome: (d: DraftDto, o: SendOutcome) => void;
}) {
  const [amount, setAmount] = useState("");
  const [draft, setDraft] = useState<DraftDto | null>(null);
  const [status, setStatus] = useState<PlanStatus>("open");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const plan = async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await api<{ draft: DraftDto }>("/api/transfers/prepare", {
        body: { to: contact.name, amountEth: amount.trim() },
      });
      setDraft(r.draft);
      setStatus("open");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qs-title"
      onClick={onClose}
    >
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <p className="eyebrow">Quick run</p>
            <h2 id="qs-title" className="display md">
              Send to {contact.name}
            </h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <IconX size={15} />
          </button>
        </div>
        {!draft || status !== "open" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void plan();
            }}
            style={{ display: "grid", gap: 12 }}
          >
            <div className="field">
              <label htmlFor="qs-amount">Amount in ETH</label>
              <input
                id="qs-amount"
                className="input"
                inputMode="decimal"
                placeholder="0.0001"
                autoFocus
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {draft && status !== "open" && (
              <p className="faint" style={{ margin: 0 }}>
                Previous plan: {status}.
              </p>
            )}
            <button type="submit" className="btn lime" disabled={busy || !amount.trim()}>
              {busy ? <span className="spinner" /> : null} Plan the run{" "}
              <IconArrow className="arrow" />
            </button>
          </form>
        ) : (
          <PlanCard
            draft={draft}

            status={status}
            onFinished={(s, outcome) => {
              setStatus(s);
              if (outcome) {
                onOutcome(draft, outcome);
                onClose();
              }
            }}
          />
        )}
      </div>
    </div>
  );
}
