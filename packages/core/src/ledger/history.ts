import { createPublicClient, erc20Abi, http, parseAbiItem, type Address, type Hash } from "viem";
import { robinhoodChain } from "../chain.ts";

export interface HistoryTx {
  hash: Hash;
  from: Address;
  to: Address | null;
  value: bigint;
}

export interface HistoryReceipt {
  status: "success" | "reverted";
  gasUsed: bigint;
  effectiveGasPrice: bigint;
  blockNumber: bigint;
}

/** Read-only chain access for ledger sync. Historical state needs an archive-capable RPC. */
export interface ChainHistory {
  getHeadBlock(): Promise<number>;
  getBalanceAt(address: Address, block: number): Promise<bigint>;
  getNonceAt(address: Address, block: number): Promise<number>;
  getBlock(block: number): Promise<{ timestamp: number; txs: HistoryTx[] }>;
  /** null when the transaction isn't mined yet. */
  getReceipt(hash: Hash): Promise<HistoryReceipt | null>;
  /** Whether the node knows the transaction at all (mined or waiting in its mempool). */
  isKnownTransaction(hash: Hash): Promise<boolean>;
  getTokenBalanceAt?(token: Address, owner: Address, block: number): Promise<bigint>;
  /** ERC-20 transfers to `to` in an inclusive block range. Throws if the range is too wide. */
  getTokenTransfersTo?(
    token: Address,
    to: Address,
    fromBlock: number,
    toBlock: number,
  ): Promise<HistoryTokenLog[]>;
  getBlockTimestamp?(block: number): Promise<number>;
}

export interface HistoryTokenLog {
  hash: Hash;
  logIndex: number;
  blockNumber: number;
  from: Address;
  value: bigint;
}

const TRANSFER = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

/**
 * Archive RPC for history. Verified 2026-11-19: dRPC's public endpoint serves historical
 * balances/nonces (tested 50M blocks back); publicnode requires a paid token for that.
 */
export const DEFAULT_ARCHIVE_RPC_URL = "https://robinhood.drpc.org";

/** ~8 requests/second: stays under public endpoint burst limits. */
const MIN_REQUEST_INTERVAL_MS = 120;

export function createViemHistory(archiveRpcUrl: string = DEFAULT_ARCHIVE_RPC_URL): ChainHistory {
  // Free public endpoints rate-limit bursts. Space requests out, and on errors (incl. 429) retry
  // with exponential backoff: 1s, 2s, 4s … up to ~1 min in total.
  let nextSlot = 0;
  const pace = async () => {
    const now = Date.now();
    const wait = Math.max(0, nextSlot - now);
    nextSlot = Math.max(now, nextSlot) + MIN_REQUEST_INTERVAL_MS;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  };
  const client = createPublicClient({
    chain: robinhoodChain,
    transport: http(archiveRpcUrl, {
      timeout: 20_000,
      retryCount: 6,
      retryDelay: 1_000,
      onFetchRequest: pace,
    }),
  });
  // Log queries fail fast: the caller retries with a narrower range instead of waiting a minute.
  const logsClient = createPublicClient({
    chain: robinhoodChain,
    transport: http(archiveRpcUrl, {
      timeout: 15_000,
      retryCount: 1,
      retryDelay: 800,
      onFetchRequest: pace,
    }),
  });
  return {
    getTokenBalanceAt: (token, owner, block) =>
      logsClient.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [owner],
        blockNumber: BigInt(block),
      }),
    getTokenTransfersTo: async (token, to, fromBlock, toBlock) => {
      const logs = await logsClient.getLogs({
        address: token,
        event: TRANSFER,
        args: { to },
        fromBlock: BigInt(fromBlock),
        toBlock: BigInt(toBlock),
      });
      return logs.map((l) => ({
        hash: l.transactionHash,
        logIndex: l.logIndex,
        blockNumber: Number(l.blockNumber),
        from: l.args.from!,
        value: l.args.value ?? 0n,
      }));
    },
    getBlockTimestamp: async (block) =>
      Number((await client.getBlock({ blockNumber: BigInt(block) })).timestamp),
    getHeadBlock: async () => Number(await client.getBlockNumber()),
    getBalanceAt: (address, block) => client.getBalance({ address, blockNumber: BigInt(block) }),
    getNonceAt: (address, block) =>
      client.getTransactionCount({ address, blockNumber: BigInt(block) }),
    getBlock: async (block) => {
      const b = await client.getBlock({ blockNumber: BigInt(block), includeTransactions: true });
      return {
        timestamp: Number(b.timestamp),
        txs: b.transactions.map((t) => ({
          hash: t.hash,
          from: t.from,
          to: t.to ?? null,
          value: t.value ?? 0n,
        })),
      };
    },
    getReceipt: async (hash) => {
      try {
        const r = await client.getTransactionReceipt({ hash });
        return {
          status: r.status,
          gasUsed: r.gasUsed,
          effectiveGasPrice: r.effectiveGasPrice,
          blockNumber: r.blockNumber,
        };
      } catch (err) {
        if (err instanceof Error && err.name === "TransactionReceiptNotFoundError") return null;
        throw err;
      }
    },
    isKnownTransaction: async (hash) => {
      try {
        await client.getTransaction({ hash });
        return true;
      } catch (err) {
        if (err instanceof Error && err.name === "TransactionNotFoundError") return false;
        throw err;
      }
    },
  };
}
