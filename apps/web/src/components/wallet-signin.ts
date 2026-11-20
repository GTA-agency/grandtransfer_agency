"use client";
import { useState } from "react";
import { useConnect, useConnection, useConnectors, useSignMessage, type Connector } from "wagmi";
import { api, errorMessage } from "@/lib/api";

/**
 * Wallet sign-in: connect a browser wallet, sign the server's one-time challenge, get a session.
 * EIP-6963 wallets (Bitget, MetaMask, Rabby, OKX…) each show up as their own connector; the
 * generic "injected" one is only offered when nothing announced itself.
 */
export function useWalletSignIn(onSignedIn: () => void) {
  const connectors = useConnectors();
  const connection = useConnection();
  const { mutateAsync: connect } = useConnect();
  const { mutateAsync: signMessage } = useSignMessage();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const announced = connectors.filter((c) => c.id !== "injected");
  const hasLegacy =
    typeof window !== "undefined" && Boolean((window as { ethereum?: unknown }).ethereum);
  const choices = announced.length
    ? announced
    : hasLegacy
      ? connectors.filter((c) => c.id === "injected")
      : [];

  const signIn = async (connector: Connector) => {
    setError(null);
    setBusy(connector.uid);
    const name = connector.id === "injected" ? "your wallet" : connector.name;
    try {
      // Already connected (wagmi reconnects wallets used before): reuse that account.
      const address =
        connection.connector?.uid === connector.uid && connection.address
          ? connection.address
          : (await connect({ connector })).accounts[0];
      if (!address) throw new Error(`${name} didn't share an account.`);
      const { message } = await api<{ message: string }>("/api/session/wallet/challenge", {
        body: { address },
      });
      const signature = await signMessage({ account: address, message });
      await api("/api/session/wallet", { body: { address, signature } });
      onSignedIn();
    } catch (err) {
      const m = errorMessage(err);
      setError(
        /reject|denied|cancel/i.test(m) ? `You cancelled it in ${name}.` : m.split("\n")[0]!,
      );
    } finally {
      setBusy(null);
    }
  };

  return { choices, signIn, busy, error };
}

export const walletLabel = (c: Connector) => (c.id === "injected" ? "Browser wallet" : c.name);
