"use client";
import { CoinSpinner } from "./CoinSpinner";
import { Footer } from "./Footer";
import { Fx, useParallax, useRevealAll } from "./motion";
import { NavPill } from "./NavPill";
import { Scene } from "./Scene";

const X_URL = "https://x.com/grandtransferHQ";
const BAND = ["$GTA", "Coming soon", "Robinhood Chain", "Stay tuned"];

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

const STEPS = [
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

/** /token: $GTA, announced but not launched yet. */
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
        <section ref={heroRef} className="tk-hero parallax" aria-labelledby="tk-title">
          <Scene variant="sunset" seed={5} palms="both" sunSize={1.35} sunX={0.5} horizon={330} />
          <div className="vignette" />
          <div className="tk-glow" aria-hidden="true" />
          <p className="tk-giant" aria-hidden="true">
            $GTA
          </p>
          <Fx />

          <div className="tk-body">
            <span className="hero-badge">
              <span className="dot" /> Launching on Robinhood Chain
            </span>
            <CoinSpinner className="tk-coin" />
            <h1 id="tk-title" className="tk-title">
              <span className="sr-only">$GTA: </span>
              <span className="tk-soon">Coming soon</span>
            </h1>
            <p className="tk-sub">
              The official token of Grand Transfer Agent is on its way. The launch time and the
              contract address drop on X first.
            </p>
            <div className="tk-actions">
              <a className="btn hot" href={X_URL} rel="noreferrer noopener">
                Follow @grandtransferHQ <span className="arrow">→</span>
              </a>
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
            <p className="eyebrow">Before the drop</p>
            <h2 id="tk-steps-title" className="display lg">
              Be ready when it lands
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

        <aside className="tk-warning reveal" aria-labelledby="tk-warning-title">
          <div className="tk-tape" aria-hidden="true" />
          <div className="tk-warning-body">
            <h2 id="tk-warning-title">Heads up: there is no $GTA yet</h2>
            <p>
              Anyone selling $GTA today, or sending you a contract address in DMs, is not us. The
              only official address will be posted on this page and on{" "}
              <a href={X_URL} rel="noreferrer noopener">
                @grandtransferHQ
              </a>
              . We will never ask for your recovery phrase.
            </p>
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
