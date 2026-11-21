"use client";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { MOBILE_WALLETS, isMobileBrowser } from "@/lib/mobile-wallets";
import { CopyButton } from "./CopyButton";
import { IconArrow, IconX } from "./Icons";
import { Scene } from "./Scene";
import { useWalletSignIn, walletLabel } from "./wallet-signin";

const noSubscribe = () => () => {};
const useIsMobile = () =>
  useSyncExternalStore(
    noSubscribe,
    () => isMobileBrowser(navigator.userAgent, navigator.maxTouchPoints),
    () => false,
  );

/** On a phone there is no extension: open this same page inside the wallet app's browser. */
function MobileWallets({ tone }: { tone: string }) {
  const page = new URL(window.location.href);
  page.hash = "";
  return (
    <>
      <p className="mobile-wallet-note">Open this page in your wallet app:</p>
      {MOBILE_WALLETS.map((w) => (
        <a
          key={w.id}
          className={`btn ${tone} block wallet-btn`}
          href={w.link(page)}
          rel="noreferrer noopener"
        >
          <span>Open in {w.name}</span>
          <IconArrow className="arrow" />
        </a>
      ))}
      <div className="mobile-wallet-other">
        <p>Another wallet? Copy this link and open it in its browser.</p>
        <CopyButton text={page.href} label="Copy this link" />
      </div>
    </>
  );
}

/** Wallet buttons, shared by the modal and the landing's final call to action. */
export function WalletChoices({
  onSignedIn,
  tone = "peach",
}: {
  onSignedIn: () => void;
  tone?: string;
}) {
  const { choices, signIn, busy, error } = useWalletSignIn(onSignedIn);
  const mobile = useIsMobile();
  return (
    <div className="wallet-list">
      {choices.length === 0 && mobile ? (
        <MobileWallets tone={tone} />
      ) : choices.length === 0 ? (
        <div className="no-wallet">
          <strong>No wallet extension found.</strong> Install Bitget Wallet, MetaMask or any EVM
          wallet in this browser, then reload the page.
        </div>
      ) : (
        choices.map((c) => (
          <button
            key={c.uid}
            type="button"
            className={`btn ${tone} block wallet-btn`}
            onClick={() => void signIn(c)}
            disabled={busy !== null}
          >
            {busy === c.uid ? (
              <span className="spinner" />
            ) : c.icon ? (
              <img src={c.icon} alt="" width={22} height={22} className="wallet-icon" />
            ) : null}
            <span>{busy === c.uid ? `Check ${walletLabel(c)}…` : `Connect ${walletLabel(c)}`}</span>
            <IconArrow className="arrow" />
          </button>
        ))
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function ConnectModal({
  onClose,
  onSignedIn,
}: {
  onClose: () => void;
  onSignedIn: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cm-title"
      onClick={onClose}
    >
      <div className="connect-modal" onClick={(e) => e.stopPropagation()}>
        <div className="connect-art">
          <Scene variant="sunset" seed={4} sunSize={0.95} horizon={470} palms="both" />
          <button
            ref={closeRef}
            type="button"
            className="icon-btn connect-close"
            onClick={onClose}
            aria-label="Close"
          >
            <IconX size={15} />
          </button>
        </div>
        <div className="connect-body">
          <p className="eyebrow">Connect your wallet</p>
          <h2 id="cm-title" className="display md">
            Pick your ride
          </h2>
          <p className="muted" style={{ margin: 0 }}>
            You&apos;ll sign a free message to prove it&apos;s you. No transaction, no gas. Your
            keys never leave your wallet.
          </p>
          <WalletChoices onSignedIn={onSignedIn} />
          <p className="legal-note">
            By connecting you agree to the <a href="/terms">Terms of Use</a> and{" "}
            <a href="/privacy">Privacy Policy</a>.
          </p>
        </div>
      </div>
    </div>
  );
}
