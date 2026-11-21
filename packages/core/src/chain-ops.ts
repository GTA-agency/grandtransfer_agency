import {
  createWalletClient,
  fallback,
  http,
  type Address,
  type Hash,
  type Hex,
  type LocalAccount,
  type PublicClient,
} from "viem";
import { ROBINHOOD_CHAIN_ID, robinhoodChain } from "./chain.ts";

/** The chain operations transfers need. Real implementation below; tests pass a fake. */
export interface ChainOps {
  getChainId(): Promise<number>;
  getBalance(address: Address): Promise<bigint>;
  estimateGas(tx: { from: Address; to: Address; value: bigint; data?: Hex }): Promise<bigint>;
  estimateFees(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }>;
  sendTransaction(
    account: LocalAccount,
    tx: {
      to: Address;
      value: bigint;
      data?: Hex;
      gas: bigint;
      maxFeePerGas: bigint;
      maxPriorityFeePerGas: bigint;
    },
  ): Promise<Hash>;
  /** A broadcast transaction, or undefined if the network doesn't know it (after a short wait). */
  getTransaction(
    hash: Hash,
  ): Promise<
    { from: Address; to: Address | null; value: bigint; chainId: number; input?: Hex } | undefined
  >;
  /** Resolves with the receipt, or rejects on timeout. */
  waitForReceipt(
    hash: Hash,
    timeoutMs: number,
  ): Promise<{
    status: "success" | "reverted";
    gasUsed: bigint;
    effectiveGasPrice: bigint;
    blockNumber: bigint;
  }>;
}

export function createViemChainOps(
  publicClient: PublicClient,
  rpcUrls: readonly string[],
): ChainOps {
  const transport = fallback(rpcUrls.map((url) => http(url, { timeout: 20_000, retryCount: 1 })));
  return {
    getChainId: () => publicClient.getChainId(),
    getBalance: (address) => publicClient.getBalance({ address }),
    estimateGas: ({ from, to, value, data }) =>
      publicClient.estimateGas({ account: from, to, value, ...(data ? { data } : {}) }),
    estimateFees: async () => {
      const f = await publicClient.estimateFeesPerGas();
      return { maxFeePerGas: f.maxFeePerGas, maxPriorityFeePerGas: f.maxPriorityFeePerGas };
    },
    sendTransaction: (account, tx) =>
      createWalletClient({ account, chain: robinhoodChain, transport }).sendTransaction({
        ...tx,
        account,
        chain: robinhoodChain,
      }),
    getTransaction: async (hash) => {
      // Fresh broadcasts can take a moment to reach the node we ask.
      for (let i = 0; i < 10; i++) {
        try {
          const tx = await publicClient.getTransaction({ hash });
          return {
            from: tx.from,
            to: tx.to ?? null,
            value: tx.value,
            chainId: tx.chainId ?? ROBINHOOD_CHAIN_ID,
            input: tx.input,
          };
        } catch {
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
      return undefined;
    },
    waitForReceipt: async (hash, timeoutMs) => {
      const r = await publicClient.waitForTransactionReceipt({ hash, timeout: timeoutMs });
      return {
        status: r.status,
        gasUsed: r.gasUsed,
        effectiveGasPrice: r.effectiveGasPrice,
        blockNumber: r.blockNumber,
      };
    },
  };
}
