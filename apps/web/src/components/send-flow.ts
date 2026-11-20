"use client";
import { useCallback } from "react";
import { useConnection, useSendTransaction, useSwitchChain } from "wagmi";
import { EXPLORER_URL, ROBINHOOD_CHAIN_ID } from "@gta/core/chain";
import { api } from "@/lib/api";
import type { DraftDto, ExternalTxDto, ResultDto } from "@/shared/types";

export type SendOutcome =
  | { kind: "sent"; result: ResultDto }
  | { kind: "busted"; reason: string; hash?: string; explorerUrl?: string };

/** Short reason from a wallet error, e.g. when the wallet refuses to add Robinhood Chain. */
function walletError(err: unknown): string {
  const e = err as { shortMessage?: string } | undefined;
  return e?.shortMessage ? ` (${e.shortMessage.split("\n")[0]})` : "";
}

function rejectedInWallet(err: unknown): boolean {
  const e = err as
    { name?: string; code?: number; shortMessage?: string; message?: string } | undefined;
  const text = `${e?.name ?? ""} ${e?.shortMessage ?? ""} ${e?.message ?? ""}`;
  return e?.code === 4001 || /UserRejected|rejected|denied/i.test(text);
}

/**
 * Sends a confirmed plan with the browser wallet (Bitget, MetaMask…). The server re-checks
 * limits and balance and hands back the exact transaction; the wallet signs and broadcasts it;
 * the server then verifies it on chain against the plan. The server never signs anything.
 */
export function useSendFlow() {
  const { address, chainId } = useConnection();
  const { mutateAsync: switchChain } = useSwitchChain();
  const { mutateAsync: sendTransaction } = useSendTransaction();

  return useCallback(
    async (draft: DraftDto): Promise<SendOutcome> => {
      try {
        if (!address || address.toLowerCase() !== draft.from.toLowerCase()) {
          return {
            kind: "busted",
            reason:
              "Your wallet is on a different account than this session. Switch back and plan again.",
          };
        }
        // Authorize first: limits and balance are checked again before the wallet opens.
        const { tx } = await api<{ tx: ExternalTxDto }>("/api/transfers/authorize", {
          body: { draftId: draft.id, confirmed: true },
        });
        if (chainId !== ROBINHOOD_CHAIN_ID) await switchChain({ chainId: ROBINHOOD_CHAIN_ID });
        let hash: `0x${string}`;
        try {
          hash = await sendTransaction({
            chainId: ROBINHOOD_CHAIN_ID,
            to: tx.to,
            value: BigInt(tx.value),
            gas: BigInt(tx.gas),
            maxFeePerGas: BigInt(tx.maxFeePerGas),
            maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGas),
          });
        } catch (err) {
          return {
            kind: "busted",
            reason: rejectedInWallet(err)
              ? "You rejected it in your wallet. Nothing was sent."
              : `Your wallet couldn't send it${walletError(err)}. Nothing was sent.`,
          };
        }
        try {
          const r = await api<{ result: ResultDto }>("/api/transfers/record", {
            body: { draftId: draft.id, hash },
          });
          return { kind: "sent", result: r.result };
        } catch (err) {
          return {
            kind: "busted",
            reason: `Your wallet sent a transaction, but it couldn't be checked against the plan: ${err instanceof Error ? err.message : "unknown error"}`,
            hash,
            explorerUrl: `${EXPLORER_URL}/tx/${hash}`,
          };
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : "Something went wrong.";
        return {
          kind: "busted",
          reason: rejectedInWallet(err)
            ? "You rejected it in your wallet. Nothing was sent."
            : reason,
        };
      }
    },
    [address, chainId, switchChain, sendTransaction],
  );
}
