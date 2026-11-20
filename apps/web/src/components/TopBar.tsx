"use client";
import { shortAddr } from "@/lib/format";
import { useWalletName } from "@/lib/wallet-name";
import { IconX } from "./Icons";
import { NavPill } from "./NavPill";

interface Props {
  address: string;
  onStart: () => void;
  onDisconnect: () => void;
}

const LINKS = [
  { href: "#plan", label: "The Plan" },
  { href: "#crew", label: "Crew" },
  { href: "#books", label: "The Books" },
  { href: "#runs", label: "Latest Runs" },
];

export function TopBar({ address, onStart, onDisconnect }: Props) {
  const walletName = useWalletName();
  return (
    <NavPill
      links={LINKS}
      actions={
        <>
          <span className="wallet-chip" title={address}>
            <span className="mode">{walletName}</span>
            <span className="addr mono">{shortAddr(address)}</span>
            <button
              type="button"
              className="icon-btn"
              onClick={onDisconnect}
              aria-label="Disconnect wallet"
              title="Disconnect"
            >
              <IconX size={14} />
            </button>
          </span>
          <button type="button" className="btn hot" onClick={onStart}>
            Start a Run <span className="arrow">→</span>
          </button>
        </>
      }
    />
  );
}
