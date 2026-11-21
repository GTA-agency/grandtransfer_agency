"use client";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { shortAddr } from "@/lib/format";
import type { ChatReplyDto, DraftDto, PaymentLinkDto, ProposalDto } from "@/shared/types";
import { CopyButton } from "./CopyButton";
import { IconSend } from "./Icons";
import { PlanCard, type PlanStatus } from "./PlanCard";
import { Scene } from "./Scene";
import type { SendOutcome } from "./send-flow";

type Item =
  | { id: number; kind: "user" | "agent" | "app" | "error"; text: string }
  | { id: number; kind: "draft"; draft: DraftDto; status: PlanStatus }
  | { id: number; kind: "proposal"; proposal: ProposalDto; status: "open" | "saved" | "dismissed" }
  | { id: number; kind: "link"; link: PaymentLinkDto };

type NewItem = Item extends infer T ? (T extends Item ? Omit<T, "id"> : never) : never;

export interface ThePlanHandle {
  focus(prefill?: string): void;
}

interface Props {
  onOutcome: (draft: DraftDto, outcome: SendOutcome) => void;
  onContactsChanged: () => void;
  /** Today's agent messages when a daily quota applies. */
  aiMessages?: { used: number; limit: number } | null;
  onAnswered?: () => void;
}

const SUGGESTIONS = [
  "What's my balance?",
  "Show my robinhood address",
  "Send 0.0001 ETH to robinhood",
  "Show my $GTA balance",
  "Request 0.01 ETH",
  "Recap this month",
];

let nextId = 1;

export const ThePlan = forwardRef<ThePlanHandle, Props>(function ThePlan(
  { onOutcome, onContactsChanged, aiMessages, onAnswered },
  ref,
) {
  const [items, setItems] = useState<Item[]>([
    {
      id: 0,
      kind: "agent",
      text: "Hey. Tell me what you want in plain words: send ETH or $GTA, check if a contract is real, request a payment, recap your month. I'll lay out the plan; nothing moves until you confirm.",
    },
  ]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    focus(prefill) {
      if (prefill !== undefined) setText(prefill);
      inputRef.current?.focus({ preventScroll: true });
    },
  }));

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items, busy]);

  const push = (...add: NewItem[]) =>
    setItems((cur) => [...cur, ...add.map((a) => ({ ...a, id: nextId++ }) as Item)]);
  const patch = (id: number, change: Partial<Item>) =>
    setItems((cur) => cur.map((it) => (it.id === id ? ({ ...it, ...change } as Item) : it)));

  const submit = async (raw: string) => {
    const msg = raw.trim();
    if (!msg || busy) return;
    setText("");
    push({ kind: "user", text: msg });
    setBusy(true);
    try {
      const r = await api<ChatReplyDto>("/api/chat", { body: { text: msg } });
      const add: NewItem[] = [{ kind: "agent", text: r.message }];
      if (r.draft) add.push({ kind: "draft", draft: r.draft, status: "open" });
      if (r.contactProposal)
        add.push({ kind: "proposal", proposal: r.contactProposal, status: "open" });
      if (r.paymentLink) add.push({ kind: "link", link: r.paymentLink });
      push(...add);
      onAnswered?.();
    } catch (err) {
      push({ kind: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
      inputRef.current?.focus({ preventScroll: true });
    }
  };

  const finishDraft = useCallback(
    (item: Extract<Item, { kind: "draft" }>) => (status: PlanStatus, outcome?: SendOutcome) => {
      patch(item.id, { status });
      if (status === "aborted") {
        void api("/api/chat/note", { body: { outcome: "aborted" } }).catch(() => {});
        push({ kind: "app", text: "Run aborted. Nothing was sent." });
      }
      if (status === "expired")
        push({ kind: "app", text: "That plan expired. Ask again for fresh gas prices." });
      if (outcome) onOutcome(item.draft, outcome);
    },
    [onOutcome],
  );

  const saveContact = async (item: Extract<Item, { kind: "proposal" }>) => {
    try {
      await api("/api/contacts/confirm", { body: { proposalId: item.proposal.id } });
      patch(item.id, { status: "saved" });
      push({ kind: "app", text: `Saved ${item.proposal.name} to your crew.` });
      onContactsChanged();
    } catch (err) {
      push({ kind: "error", text: errorMessage(err) });
    }
  };

  return (
    <section id="plan" className="section plan-wrap reveal" aria-labelledby="plan-title">
      <Scene
        variant="sunset"
        seed={11}
        palms="left"
        sunX={0.52}
        sunSize={1.15}
        horizon={560}
        stars
      />
      <div className="plan-shade" aria-hidden="true" />
      <div className="plan-grid">
        <div className="plan-intro">
          <p className="eyebrow">The plan · chat with your agent</p>
          <h2 id="plan-title" className="display lg">
            One message.
            <br />
            One clean run.
          </h2>
          <p className="muted" style={{ maxWidth: 440, margin: 0 }}>
            Tell the agent what you want in plain words. It finds the address in your crew, checks
            your limits, estimates gas and lays out the plan. The agent can only plan; you hold the
            confirm button.
          </p>
          <div className="suggestions" aria-label="Try one of these">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                className="suggestion"
                onClick={() => void submit(s)}
                disabled={busy}
              >
                {s}
              </button>
            ))}
            <button
              type="button"
              className="suggestion"
              onClick={() => {
                setText("Is this the real $GTA? 0x");
                inputRef.current?.focus({ preventScroll: true });
              }}
              disabled={busy}
            >
              Check a contract
            </button>
          </div>
        </div>

        <div className="phone">
          <div className="phone-screen">
            <div className="phone-head">
              <div className="avatar-logo" aria-hidden="true">
                <img src="/gta-pp.png" alt="" width={192} height={192} />
              </div>
              <div style={{ flex: 1 }}>
                <div className="who">Grand Transfer Agent</div>
                <div className="status">
                  <span className="dot" /> {busy ? "planning…" : "online"}
                  {aiMessages && (
                    <span className="quota" title="Agent messages left today (resets 00:00 UTC)">
                      · {Math.max(0, aiMessages.limit - aiMessages.used)}/{aiMessages.limit} left
                      today
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                className="btn ghost small"
                onClick={async () => {
                  await api("/api/chat", { method: "DELETE" }).catch(() => {});
                  setItems((cur) => cur.slice(0, 1));
                }}
              >
                New chat
              </button>
            </div>
            <div
              className="messages"
              ref={listRef}
              role="log"
              aria-live="polite"
              aria-label="Conversation"
            >
              {items.map((it) => {
                if (it.kind === "draft") {
                  return (
                    <PlanCard
                      key={it.id}
                      draft={it.draft}

                      status={it.status}
                      onFinished={finishDraft(it)}
                    />
                  );
                }
                if (it.kind === "link") {
                  return (
                    <div key={it.id} className="plan-card">
                      <div className="title-row">
                        <p className="eyebrow">Payment link</p>
                        <span className="pill mint">
                          {it.link.amount} {it.link.asset.toUpperCase()}
                        </span>
                      </div>
                      <div className="pay-link-row">
                        <span className="mono">{it.link.url}</span>
                        <CopyButton text={it.link.url} label="Copy payment link" />
                      </div>
                      <p className="plan-note">
                        Pays your wallet. They review it and sign with their own wallet.
                      </p>
                    </div>
                  );
                }
                if (it.kind === "proposal") {
                  return (
                    <div key={it.id} className="plan-card">
                      <div className="title-row">
                        <p className="eyebrow">Save to your crew?</p>
                        {it.status === "saved" && <span className="pill lime">Saved</span>}
                        {it.status === "dismissed" && <span className="pill">Dismissed</span>}
                      </div>
                      <dl className="plan-rows">
                        <dt>Name</dt>
                        <dd className="strong">{it.proposal.name}</dd>
                        <dt>Address</dt>
                        <dd className="mono">{it.proposal.address}</dd>
                      </dl>
                      {it.status === "open" && (
                        <div className="plan-actions">
                          <button
                            type="button"
                            className="btn mint"
                            onClick={() => void saveContact(it)}
                          >
                            Save {it.proposal.name}
                          </button>
                          <button
                            type="button"
                            className="btn ghost"
                            onClick={() => patch(it.id, { status: "dismissed" })}
                          >
                            Dismiss
                          </button>
                        </div>
                      )}
                    </div>
                  );
                }
                return (
                  <div key={it.id} className={`bubble ${it.kind}`}>
                    {it.text}
                  </div>
                );
              })}
              {busy && (
                <div className="bubble agent typing" aria-label="The agent is typing">
                  <span />
                  <span />
                  <span />
                </div>
              )}
            </div>
            <form
              className="composer"
              onSubmit={(e) => {
                e.preventDefault();
                void submit(text);
              }}
            >
              <label htmlFor="chat-input" className="sr-only">
                Message the agent
              </label>
              <input
                id="chat-input"
                ref={inputRef}
                className="input"
                placeholder="Tell the agent what to do…"
                value={text}
                maxLength={2000}
                autoComplete="off"
                onChange={(e) => setText(e.target.value)}
              />
              <button
                type="submit"
                className="send-btn"
                disabled={busy || !text.trim()}
                aria-label="Send message"
              >
                <IconSend size={18} />
              </button>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
});

export const describeTarget = (d: DraftDto) => d.contactName ?? shortAddr(d.to);
