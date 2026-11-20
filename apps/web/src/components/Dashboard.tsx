"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection, useDisconnect } from "wagmi";
import { api } from "@/lib/api";
import { shortAddr } from "@/lib/format";
import type { ContactDto, DraftDto, OverviewDto, SessionDto } from "@/shared/types";
import { Books } from "./Books";
import { Crew } from "./Crew";
import { Footer } from "./Footer";
import { Hero } from "./Hero";
import { LatestRuns } from "./LatestRuns";
import { LimitsCard } from "./LimitsCard";
import { QuickSend } from "./QuickSend";
import { ResultOverlay, type ResultView } from "./ResultOverlay";
import type { SendOutcome } from "./send-flow";
import { ThePlan, type ThePlanHandle } from "./ThePlan";
import { useRevealAll } from "./motion";
import { TopBar } from "./TopBar";

export function Dashboard({
  session,
  onLocked,
}: {
  session: NonNullable<SessionDto["session"]>;
  onLocked: () => void;
}) {
  const [overview, setOverview] = useState<OverviewDto | null>(null);
  const [contacts, setContacts] = useState<ContactDto[] | null>(null);
  const [result, setResult] = useState<ResultView | null>(null);
  const [quick, setQuick] = useState<ContactDto | null>(null);
  const [booksVersion, setBooksVersion] = useState(0);
  const planRef = useRef<ThePlanHandle>(null);
  useRevealAll();
  const { address: mmAddress } = useConnection();
  const { mutate: disconnect } = useDisconnect();

  const loadOverview = useCallback(() => {
    api<OverviewDto>("/api/overview").then(setOverview, () => {});
  }, []);
  const loadContacts = useCallback(() => {
    api<{ contacts: ContactDto[] }>("/api/contacts").then(
      (r) => setContacts(r.contacts),
      () => {},
    );
  }, []);

  useEffect(() => {
    loadOverview();
    loadContacts();
    const t = setInterval(loadOverview, 30_000);
    return () => clearInterval(t);
  }, [loadOverview, loadContacts]);

  // A browser-wallet session belongs to one account: switching accounts in the wallet locks the app.
  useEffect(() => {
    if (mmAddress && mmAddress.toLowerCase() !== session.address.toLowerCase()) {
      void api("/api/session/lock", { body: {} }).finally(onLocked);
    }
  }, [mmAddress, session, onLocked]);

  const lock = async () => {
    await api("/api/session/lock", { body: {} }).catch(() => {});
    disconnect();
    onLocked();
  };

  const startRun = () => {
    document.getElementById("plan")?.scrollIntoView({ behavior: "smooth", block: "start" });
    planRef.current?.focus();
  };

  const onOutcome = useCallback(
    (draft: DraftDto, o: SendOutcome) => {
      const to = draft.contactName ?? shortAddr(draft.to);
      if (o.kind === "sent") {
        setResult({
          kind:
            o.result.status === "confirmed"
              ? "win"
              : o.result.status === "pending"
                ? "road"
                : "lose",
          amountEth: draft.amountEth,
          to,
          hash: o.result.hash,
          explorerUrl: o.result.explorerUrl,
          feeEth: o.result.feeEth,
          ...(o.result.status === "failed"
            ? {
                reason:
                  "The transaction was mined but reverted. Gas was spent; the ETH did not move.",
              }
            : {}),
        } as ResultView);
      } else if (o.kind === "busted") {
        setResult({
          kind: "lose",
          reason: o.reason,
          ...(o.hash ? { hash: o.hash, explorerUrl: o.explorerUrl } : {}),
        });
      }
      loadOverview();
      setBooksVersion((v) => v + 1);
    },
    [loadOverview],
  );

  return (
    <>
      <TopBar address={session.address} onStart={startRun} onDisconnect={() => void lock()} />
      <main id="top" className="shell">
        <Hero overview={overview} onStart={startRun} />
        <ThePlan
          ref={planRef}
          onOutcome={onOutcome}
          onContactsChanged={loadContacts}
          aiMessages={overview?.aiMessages ?? null}
          onAnswered={loadOverview}
        />
        <section className="section" aria-label="Crew and limits">
          <p className="eyebrow reveal">Features</p>
          <h2 className="display lg reveal" style={{ marginBottom: 20 }}>
            Everything a clean run needs
          </h2>
          <div className="feature-grid">
            <Crew contacts={contacts} onChanged={loadContacts} onSend={setQuick} />
            <LimitsCard overview={overview} />
          </div>
        </section>
        <Books version={booksVersion} onSynced={loadOverview} />
        <LatestRuns entries={overview?.recent ?? null} />
      </main>
      <Footer />
      {quick && <QuickSend contact={quick} onClose={() => setQuick(null)} onOutcome={onOutcome} />}
      {result && <ResultOverlay view={result} onClose={() => setResult(null)} />}
    </>
  );
}
