"use client";
import { useState } from "react";
import type { SessionDto } from "@/shared/types";
import { ConnectModal, WalletChoices } from "./ConnectModal";
import { DemoChat } from "./DemoChat";
import { Footer } from "./Footer";
import { LogoSpinner } from "./LogoSpinner";
import { NavPill } from "./NavPill";
import { IconArrow, IconKey, IconLock, IconTerminal, StarShape } from "./Icons";
import { Fx, useParallax, useRevealAll } from "./motion";
import { Scene } from "./Scene";

const LANDING_LINKS = [
  { href: "#demo", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#steps", label: "Three steps" },
  { href: "#safety", label: "Safety" },
];

/** The public front page: what the agent does, how it stays safe, and the way in (connect). */
export function Landing({ info, onSignedIn }: { info: SessionDto; onSignedIn: () => void }) {
  const [connectOpen, setConnectOpen] = useState(false);
  const heroRef = useParallax<HTMLElement>();
  const finaleRef = useParallax<HTMLElement>();
  useRevealAll();

  const open = () => setConnectOpen(true);

  return (
    <>
      <NavPill
        links={LANDING_LINKS}
        actions={
          <button type="button" className="btn hot" onClick={open}>
            Connect wallet <span className="arrow">→</span>
          </button>
        }
      />

      <main id="top" className="shell">
        {/* ---------------- hero ---------------- */}
        <section ref={heroRef} className="lp-hero parallax" aria-labelledby="hero-title">
          <Scene variant="sunset" seed={7} sunX={0.5} sunSize={1.3} horizon={540} palms="both" />
          <div className="vignette" />
          <div className="hero-shade" aria-hidden="true" />
          <Fx />
          <div className="lp-hero-body">
            <div className="hero-copy">
              <span className="hero-badge">
                <span className="dot" /> AI wallet agent · Robinhood Chain
              </span>
              <h1 id="hero-title" className="hero-tagline">
                <span>
                  You call <br className="m-br" />
                  the shots.
                </span>{" "}
                <span className="hot">
                  The agent <br className="m-br" />
                  makes the run.
                </span>
              </h1>
              <p className="hero-sub">
                Tell it what you need in plain words. It plans the run, you give the go, your wallet
                signs it, and every move lands in the books.
              </p>
              <div className="hero-ctas">
                <button type="button" className="btn hot big" onClick={open}>
                  Connect wallet <IconArrow className="arrow" />
                </button>
                <a className="btn glass big" href="#demo">
                  Watch it work
                </a>
              </div>
              <div className="lp-platforms">
                <span>
                  <IconLock size={14} /> Web
                </span>
                <span>
                  <IconTerminal size={14} /> CLI
                </span>
                <span>
                  <span className="dot" style={{ color: "var(--mint)" }} /> Mainnet
                </span>
              </div>
            </div>
            <LogoSpinner className="lp-logo3d" />
          </div>
        </section>
        <a className="scroll-cue" href="#demo" aria-label="Scroll to how it works">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </a>

        {/* ---------------- demo ---------------- */}
        <section id="demo" className="section plan-wrap reveal" aria-labelledby="demo-title">
          <Scene variant="sunset" seed={11} palms="left" sunX={0.52} sunSize={1.15} horizon={560} />
          <div className="plan-shade" aria-hidden="true" />
          <div className="plan-grid">
            <div className="plan-intro">
              <p className="eyebrow">Watch it work</p>
              <h2 id="demo-title" className="display lg">
                One message.
                <br />
                One clean run.
              </h2>
              <p className="muted" style={{ maxWidth: 440, margin: 0 }}>
                Tell the agent what you want in plain words. It finds the address in your crew,
                checks your limits, estimates gas and lays out the plan. Nothing moves until you say
                so, and your own wallet signs it.
              </p>
              <p className="sr-only">
                Demo: the user types &ldquo;send 0.01 eth to robinhood&rdquo;, the agent shows a
                plan with recipient, amount, gas and total, the user confirms, and the run ends with
                Clean getaway.
              </p>
              <div>
                <button type="button" className="btn lime" onClick={open}>
                  Try it with your wallet <IconArrow className="arrow" />
                </button>
              </div>
            </div>
            <DemoChat />
          </div>
        </section>

        {/* ---------------- features ---------------- */}
        <section id="features" className="section" aria-labelledby="features-title">
          <p className="eyebrow reveal">Features</p>
          <h2 id="features-title" className="display lg reveal" style={{ marginBottom: 22 }}>
            Everything a clean run needs
          </h2>

          <article className="wide-card lift reveal">
            <div className="wide-art">
              <Scene
                variant="night"
                seed={21}
                palms="right"
                sunX={0.78}
                sunSize={0.8}
                horizon={560}
              />
              <BooksArt />
            </div>
            <div className="wide-text">
              <p className="eyebrow">The books</p>
              <h3 className="display md">Every run on the record</h3>
              <p className="muted">
                Incoming and outgoing transfers are logged automatically, straight from the chain.
                Tag them, add notes, get daily, weekly and monthly recaps. Export to CSV.
              </p>
            </div>
          </article>

          <article className="wide-card flip lift reveal">
            <div className="wide-art">
              <Scene variant="gold" seed={9} palms="left" sunX={0.3} sunSize={0.85} horizon={560} />
              <StarsArt />
            </div>
            <div className="wide-text">
              <p className="eyebrow">Wanted level</p>
              <h3 className="display md">Limits that keep you clean</h3>
              <p className="muted">
                Per-run and daily caps are enforced in code, not by the AI. New recipients get a
                loud warning and an extra star. Bigger runs light up more stars.
              </p>
            </div>
          </article>

          <div className="feature-grid">
            <article className="art-card lift reveal">
              <div className="art-top">
                <Scene variant="sunset" seed={3} palms="both" sunSize={0.8} horizon={540} />
                <div className="crew-list demo-crew" aria-hidden="true">
                  {[
                    ["robinhood", "0x8F3a…91C2", "var(--mint)"],
                    ["savings vault", "0x2b7c…4E18", "var(--peach)"],
                    ["kevin", "0x5163…E89F", "var(--pink)"],
                  ].map(([n, a, col]) => (
                    <div key={n} className="crew-item">
                      <div className="crew-avatar" style={{ background: col }}>
                        {n![0]}
                      </div>
                      <div className="crew-text">
                        <div className="crew-name">{n}</div>
                        <div className="crew-addr">{a}</div>
                      </div>
                      <span className="btn small hot">Send</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="art-bottom">
                <p className="eyebrow">Contacts</p>
                <h3 className="display md">Your crew on speed dial</h3>
                <p className="muted" style={{ margin: 0 }}>
                  Save addresses by name. Ask &ldquo;show my robinhood address&rdquo; or send by
                  name. No copy-pasting long hex strings.
                </p>
              </div>
            </article>
            <article className="art-card lift reveal" style={{ ["--d" as string]: "0.1s" }}>
              <div className="art-top">
                <Scene
                  variant="ocean"
                  seed={14}
                  palms="right"
                  sunX={0.25}
                  sunSize={0.8}
                  horizon={540}
                />
                <TerminalArt />
              </div>
              <div className="art-bottom">
                <p className="eyebrow">Web + CLI</p>
                <h3 className="display md">Run it your way</h3>
                <p className="muted" style={{ margin: 0 }}>
                  Use the web app with your browser wallet, or stay in the terminal with the{" "}
                  <span className="mono">gta</span> command. Same agent, same safety checks.
                </p>
              </div>
            </article>
          </div>
        </section>

        {/* ---------------- steps ---------------- */}
        <section id="steps" className="section" aria-labelledby="steps-title">
          <p className="eyebrow reveal">How it works</p>
          <h2 id="steps-title" className="display lg reveal" style={{ marginBottom: 22 }}>
            Three steps. No sweat.
          </h2>
          <ol className="steps">
            {[
              [
                "01",
                "Say it",
                "Type what you want in plain words: send ETH, show an address, recap your month.",
              ],
              [
                "02",
                "Check the plan",
                "The agent drafts the run: recipient, amount, gas and wanted level. Nothing moves yet.",
              ],
              [
                "03",
                "Clean getaway",
                "Confirm and your wallet signs it on Robinhood Chain. It lands in The Books automatically.",
              ],
            ].map(([n, t, d], i) => (
              <li key={n} className="step lift reveal" style={{ ["--d" as string]: `${i * 0.1}s` }}>
                <span className="step-n">{n}</span>
                <h3 className="display sm">{t}</h3>
                <p className="muted">{d}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ---------------- safety ---------------- */}
        <section id="safety" className="section safety reveal" aria-labelledby="safety-title">
          <div className="safety-head">
            <IconKey size={30} style={{ color: "var(--pink)" }} />
            <div>
              <p className="eyebrow">Safety model</p>
              <h2 id="safety-title" className="display lg">
                Keys stay home
              </h2>
            </div>
          </div>
          <div className="safety-grid">
            {[
              [
                "The AI only plans",
                "It can look up contacts and draft a transfer. There is no tool that sends money.",
              ],
              [
                "Your wallet signs",
                "Every send is signed in your own wallet. This app never holds a private key.",
              ],
              [
                "Limits in code",
                `Max ${info.limits.maxTxEth} ETH per run and ${info.limits.maxDailyEth} ETH per day, checked again right before signing.`,
              ],
              [
                "Checked on chain",
                "After your wallet sends, the transaction is verified against the plan you confirmed.",
              ],
            ].map(([t, d]) => (
              <div key={t} className="safety-item">
                <span className="safety-dot" aria-hidden="true" />
                <div>
                  <h3>{t}</h3>
                  <p className="muted">{d}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ---------------- finale ---------------- */}
        <section
          ref={finaleRef}
          className="section finale parallax reveal"
          aria-labelledby="finale-title"
        >
          <Scene variant="sunset" seed={2} palms="both" sunSize={0.95} sunX={0.5} horizon={590} />
          <div className="vignette" />
          <Fx />
          <div className="finale-body">
            <p className="pill mint">Ready?</p>
            <h2 id="finale-title" className="display xl">
              Start your first run
            </h2>
            <p className="finale-sub">
              Connect your wallet on Robinhood Chain. Signing in is a free message, not a
              transaction.
            </p>
            <div className="finale-wallets">
              <WalletChoices onSignedIn={onSignedIn} tone="lime" />
            </div>
          </div>
        </section>
      </main>
      <Footer variant="landing" onConnect={open} />
      {connectOpen && (
        <ConnectModal onClose={() => setConnectOpen(false)} onSignedIn={onSignedIn} />
      )}
    </>
  );
}

/** Example chart for the Books card (made-up numbers, drawn in the chart colors). */
function BooksArt() {
  const bars = [
    [34, 18],
    [52, 30],
    [40, 44],
    [70, 26],
    [58, 40],
    [86, 34],
    [64, 52],
    [96, 38],
  ];
  return (
    <div className="books-art" aria-hidden="true">
      <div className="books-chips">
        <div className="stat-chip">
          <div className="k">Net this month</div>
          <div className="v">+0.42 ETH</div>
        </div>
        <div className="stat-chip">
          <div className="k">Gas spent</div>
          <div className="v">0.0004 ETH</div>
        </div>
      </div>
      <svg viewBox="0 0 320 130" className="books-bars">
        {bars.map(([a, b], i) => (
          <g key={i} style={{ ["--i" as string]: i }}>
            <rect
              className="grow"
              x={14 + i * 38}
              y={120 - a!}
              width="12"
              height={a}
              rx="4"
              fill="var(--chart-in)"
            />
            <rect
              className="grow"
              x={28 + i * 38}
              y={120 - b!}
              width="12"
              height={b}
              rx="4"
              fill="var(--chart-out)"
            />
          </g>
        ))}
        <line x1="6" x2="314" y1="120.5" y2="120.5" stroke="rgb(255 255 255 / 0.2)" />
      </svg>
      <span className="example-tag">Example</span>
    </div>
  );
}

function StarsArt() {
  return (
    <div className="stars-art" aria-hidden="true">
      <div className="big-stars cycle">
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} style={{ ["--i" as string]: i }}>
            <StarShape filled={i < 2} />
          </span>
        ))}
      </div>
      <div className="stars-caption">Run size: small · daily limit 38% used</div>
    </div>
  );
}

function TerminalArt() {
  const lines = [
    ["$", "gta send 0.01 robinhood"],
    ["", "THE PLAN  0.01 ETH → robinhood (0x8F3a…91C2)"],
    ["", "gas ~0.00002 ETH · wanted ★☆☆☆☆"],
    ["?", "Type yes to send: yes"],
    ["✓", "CLEAN GETAWAY  tx 0x4c1e…a7d8"],
  ];
  return (
    <div className="terminal" aria-hidden="true">
      <div className="terminal-bar">
        <i style={{ background: "#ff6b85" }} />
        <i style={{ background: "#ffd27a" }} />
        <i style={{ background: "#9fe3c8" }} />
      </div>
      <div className="terminal-body">
        {lines.map(([p, t], i) => (
          <div key={i} className="t-line" style={{ ["--i" as string]: i }}>
            <span className={p === "✓" ? "t-ok" : "t-p"}>{p}</span> {t}
          </div>
        ))}
      </div>
    </div>
  );
}
