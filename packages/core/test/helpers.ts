import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import type { Address, Hash, Hex } from "viem";
import type { ChainOps } from "../src/index.ts";

/** Cheap scrypt so tests run fast. Never use outside tests. */
export const TEST_SCRYPT = { N: 1024, r: 8, p: 1 };

/** Well-known test vector (Hardhat/Anvil default). Never use with real funds. */
export const TEST_MNEMONIC = "test test test test test test test test test test test junk";
export const TEST_MNEMONIC_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
export const TEST_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const dirs: string[] = [];
export function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "gta-test-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

export interface FakeChain extends ChainOps {
  chainId: number;
  balances: Map<string, bigint>;
  sent: { from: Address; to: Address; value: bigint; gas: bigint; data?: Hex }[];
  receiptStatus: "success" | "reverted" | "timeout";
  /** Transactions the "network" knows, by hash (for getTransaction). */
  known: Map<
    string,
    { from: Address; to: Address | null; value: bigint; chainId: number; input?: Hex }
  >;
}

export function fakeChain(overrides: Partial<FakeChain> = {}): FakeChain {
  const chain: FakeChain = {
    chainId: 4663,
    balances: new Map(),
    sent: [],
    receiptStatus: "success",
    known: new Map(),
    getChainId: async () => chain.chainId,
    getBalance: async (a) => chain.balances.get(a.toLowerCase()) ?? 0n,
    estimateGas: async () => 21_000n,
    estimateFees: async () => ({ maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 1_000_000n }),
    sendTransaction: async (account, tx) => {
      chain.sent.push({
        from: account.address,
        to: tx.to,
        value: tx.value,
        gas: tx.gas,
        ...(tx.data ? { data: tx.data } : {}),
      });
      return `0x${chain.sent.length.toString(16).padStart(64, "0")}` as Hash;
    },
    getTransaction: async (hash) => chain.known.get(hash.toLowerCase()),
    waitForReceipt: async () => {
      if (chain.receiptStatus === "timeout") throw new Error("timeout");
      return {
        status: chain.receiptStatus,
        gasUsed: 21_000n,
        effectiveGasPrice: 500_000_000n,
        blockNumber: 123n,
      };
    },
    ...overrides,
  };
  return chain;
}
