"use client";
import { IconKey } from "./Icons";

const REPO = "https://github.com/GTA-agency/grandtransfer_agency";

interface Props {
  /** Landing page (signed out) or the dashboard (signed in): the links point to that page's sections. */
  variant?: "landing" | "app";
  onConnect?: () => void;
  onStartRun?: () => void;
  onDisconnect?: () => void;
}

export function Footer({ variant = "landing", onConnect, onStartRun, onDisconnect }: Props) {
  const product =
    variant === "app"
      ? [
          ["The Plan", "#plan"],
          ["Crew", "#crew"],
          ["The Books", "#books"],
          ["Latest Runs", "#runs"],
        ]
      : [
          ["How it works", "#demo"],
          ["Features", "#features"],
          ["Three steps", "#steps"],
          ["Safety", "#safety"],
        ];
  return (
    <footer className="footer shell">
      <img src="/logo.png" alt="" width={1378} height={1015} />
      <div className="keys-home">
        <IconKey size={22} style={{ color: "var(--pink)", flex: "none" }} />
        <span className="display">Keys stay home</span>
        <p>
          Your keys stay in your own wallet. The app and the AI only plan; your wallet signs every
          send.
        </p>
      </div>

      <nav className="footer-cols" aria-label="Footer">
        <div className="footer-col">
          <h2>Product</h2>
          {product.map(([label, href]) => (
            <a key={href} href={href}>
              {label}
            </a>
          ))}
        </div>
        <div className="footer-col">
          <h2>Account</h2>
          {variant === "app" ? (
            <>
              <button type="button" onClick={onStartRun}>
                Start a run
              </button>
              <button type="button" onClick={onDisconnect}>
                Disconnect
              </button>
            </>
          ) : (
            <button type="button" onClick={onConnect}>
              Connect wallet
            </button>
          )}
        </div>
        <div className="footer-col">
          <h2>Follow</h2>
          <a href="https://x.com/grandtransferHQ" rel="noreferrer noopener">
            X @grandtransferHQ
          </a>
          <a href={REPO} rel="noreferrer noopener">
            GitHub
          </a>
          <a href="https://www.npmjs.com/package/grand-transfer-agent" rel="noreferrer noopener">
            npm
          </a>
        </div>
        <div className="footer-col">
          <h2>Legal</h2>
          <a href="/terms">Terms</a>
          <a href="/privacy">Privacy</a>
        </div>
      </nav>

      <p className="disclaimer">
        Grand Transfer Agent is an independent project and is not affiliated with Rockstar Games,
        Take-Two Interactive or Robinhood. Transfers on Robinhood Chain are final.
      </p>
    </footer>
  );
}
