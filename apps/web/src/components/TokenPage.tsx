"use client";
import { useState } from "react";
import { GTA_HOLDER_PERK } from "@gta/core/chain";
import { fmtToken } from "@/lib/format";
import { TOKEN_CA, TOKEN_EXPLORER_URL, TOKEN_LIVE } from "@/shared/token";
import { CoinSpinner } from "./CoinSpinner";
import { Footer } from "./Footer";
import { Fx, useParallax, useRevealAll } from "./motion";
import { NavPill } from "./NavPill";
import { Scene } from "./Scene";

const X_URL = "https://x.com/grandtransferHQ";
const BAND = TOKEN_LIVE
  ? ["$GTA", "Live on Robinhood Chain", "Check the address", "Stay safe"]
  : ["$GTA", "Coming soon", "Robinhood Chain", "Stay tuned"];

function Band({ tone, reverse = false }: { tone: "hot" | "mint"; reverse?: boolean }) {
  const items = [...BAND, ...BAND, ...BAND];
  return (
    <div className={`tk-band ${tone}${reverse ? " reverse" : ""}`} aria-hidden="true">
      <div className="tk-band-track">
        {[0, 1].map((copy) => (
          <span key={copy} className="tk-band-run">
            {items.map((t, i) => (
              <span key={i}>
                {t}
                <i>✦</i>
              </span>
            ))}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The official address, in full, with a copy button. */
function ContractAddress() {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(TOKEN_CA);
      setState("copied");
    } catch {
      setState("failed");
    }
    window.setTimeout(() => setState("idle"), 2000);
  };
  return (
    <div className="tk-ca">
      <span className="tk-ca-label">Official CA</span>
      <code>{TOKEN_CA}</code>
      <button type="button" onClick={copy}>
        {state === "copied" ? "Copied" : state === "failed" ? "Select it" : "Copy"}
      </button>
      <span className="sr-only" role="status">
        {state === "copied" ? "Contract address copied" : ""}
      </span>
    </div>
  );
}

const STEPS: { n: string; title: string; body: string; href?: string; cta?: string }[] = TOKEN_LIVE
  ? [
      {
        n: "01",
        title: "Match the address",
        body: "Compare it with the official address at the top of this page, character by character.",
      },
      {
        n: "02",
        title: "Check our X",
        body: "The same address is pinned on @grandtransferHQ.",
        href: X_URL,
        cta: "Open X",
      },
      {
        n: "03",
        title: "Keep your phrase private",
        body: "We never DM first and we will never ask for your recovery phrase.",
      },
    ]
  : [
      {
        n: "01",
        title: "Follow @grandtransferHQ",
        body: "The launch time drops on X before anything goes live.",
        href: X_URL,
        cta: "Follow on X",
      },
      {
        n: "02",
        title: "Turn on notifications",
        body: "Tap the bell on our profile so you see the announcement the minute it lands.",
      },
      {
        n: "03",
        title: "Check the address",
        body: "Only trust the contract address posted on this page and on our X account.",
      },
    ];

/** /token: $GTA, coming soon until TOKEN_CA is set, then the official address. */
export function TokenPage() {
  const heroRef = useParallax<HTMLElement>();
  useRevealAll();

  return (
    <>
      <NavPill
        links={[]}
        homeHref="/"
        tokenActive
        actions={
          <a className="btn hot" href="/">
            Open the app <span className="arrow">→</span>
          </a>
        }
      />

      <main id="top" className="shell tk">
        <section
          ref={heroRef}
          className={`tk-hero parallax${TOKEN_LIVE ? " live" : ""}`}
          aria-labelledby="tk-title"
        >
          <Scene variant="sunset" seed={5} palms="both" sunSize={1.35} sunX={0.5} horizon={330} />
          <div className="vignette" />
          <div className="tk-glow" aria-hidden="true" />
          <p className="tk-giant" aria-hidden="true">
            $GTA
          </p>
          <Fx />

          <div className="tk-body">
            <span className="hero-badge">
              <span className="dot" />{" "}
              {TOKEN_LIVE ? "Live on Robinhood Chain" : "Launching on Robinhood Chain"}
            </span>
            <CoinSpinner className="tk-coin" />
            <h1 id="tk-title" className="tk-title">
              <span className="sr-only">$GTA: </span>
              <span className="tk-soon">{TOKEN_LIVE ? "Now live" : "Coming soon"}</span>
            </h1>
            {TOKEN_LIVE ? (
              <>
                <ContractAddress />
                <p className="tk-sub">
                  This is the only official $GTA address. Check it here before you do anything.
                </p>
              </>
            ) : (
              <p className="tk-sub">
                The official token of Grand Transfer Agent is on its way. The launch time and the
                contract address drop on X first.
              </p>
            )}
            <div className="tk-actions">
              {TOKEN_LIVE ? (
                <a className="btn hot" href={TOKEN_EXPLORER_URL} rel="noreferrer noopener">
                  View on explorer <span className="arrow">→</span>
                </a>
              ) : (
                <a className="btn hot" href={X_URL} rel="noreferrer noopener">
                  Follow @grandtransferHQ <span className="arrow">→</span>
                </a>
              )}
              <a className="btn ghost tk-ghost" href="/">
                Try the agent
              </a>
            </div>
          </div>

          <div className="tk-bands">
            <Band tone="mint" reverse />
            <Band tone="hot" />
          </div>
        </section>

        <section className="tk-steps" aria-labelledby="tk-steps-title">
          <header className="tk-steps-head reveal">
            <p className="eyebrow">{TOKEN_LIVE ? "Stay safe" : "Before the drop"}</p>
            <h2 id="tk-steps-title" className="display lg">
              {TOKEN_LIVE ? "Check before you act" : "Be ready when it lands"}
            </h2>
          </header>
          <ol className="tk-step-list">
            {STEPS.map((s) => (
              <li key={s.n} className="tk-step reveal">
                <span className="tk-step-n" aria-hidden="true">
                  {s.n}
                </span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
                {s.href && (
                  <a href={s.href} rel="noreferrer noopener" className="tk-step-link">
                    {s.cta} <span aria-hidden="true">→</span>
                  </a>
                )}
              </li>
            ))}
          </ol>
        </section>

        {TOKEN_LIVE && (
          <section className="tk-perk reveal" aria-labelledby="tk-perk-title">
            <p className="eyebrow">Holder perk</p>
            <h2 id="tk-perk-title">More time with your agent</h2>
            <p>
              Hold {fmtToken(GTA_HOLDER_PERK.minTokens)}+ $GTA in the wallet you connect and get{" "}
              {GTA_HOLDER_PERK.messagesPerDay} agent messages a day.
            </p>
          </section>
        )}

        <aside className="tk-warning reveal" aria-labelledby="tk-warning-title">
          <div className="tk-tape" aria-hidden="true" />
          <div className="tk-warning-body">
            <h2 id="tk-warning-title">
              {TOKEN_LIVE ? "Only one address is ours" : "Heads up: there is no $GTA yet"}
            </h2>
            {TOKEN_LIVE ? (
              <p>
                Any other contract using the $GTA name is not us, even if it looks the same. Ignore
                airdrops, &quot;claim&quot; links and DMs. Questions go to{" "}
                <a href={X_URL} rel="noreferrer noopener">
                  @grandtransferHQ
                </a>
                . We will never ask for your recovery phrase.
              </p>
            ) : (
              <p>
                Anyone selling $GTA today, or sending you a contract address in DMs, is not us. The
                only official address will be posted on this page and on{" "}
                <a href={X_URL} rel="noreferrer noopener">
                  @grandtransferHQ
                </a>
                . We will never ask for your recovery phrase.
              </p>
            )}
          </div>
        </aside>

        <p className="tk-disclaimer">
          $GTA is not an investment product. Nothing on this page is financial advice, and no
          returns are promised. Crypto prices can drop to zero.
        </p>
      </main>
      <Footer variant="page" />
    </>
  );
}
