"use client";
import { useConnection } from "wagmi";

/** The connected extension's own name ("Bitget Wallet", "MetaMask"…). */
export function useWalletName(): string {
  const { connector } = useConnection();
  return connector && connector.id !== "injected" ? connector.name : "Browser wallet";
}
