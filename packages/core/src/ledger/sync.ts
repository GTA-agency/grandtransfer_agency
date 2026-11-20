import { getAddress, zeroAddress, type Address } from "viem";
import type { AddressBook } from "../contacts.ts";
import type { Database } from "../db.ts";
import type { LedgerStore } from "../ledger-store.ts";
import type { ChainHistory } from "./history.ts";

export interface SyncReport {
  wallet: Address;
  /** True when this was the first sync and only a starting checkpoint was saved. */
  initialized: boolean;
  fromBlock: number;
  toBlock: number;
  incoming: number;
  outgoingExternal: number;
  internalIncoming: number;
  settledPending: number;
  /** Our pending sends the network dropped (never mined, no longer known): marked failed. */
  dropped: number;
  /** Blocks where the balance dropped for no visible reason (should be 0 for a normal wallet). */
  unexplained: number;
  /** True when the call budget ran out first: progress up to `toBlock` is saved, sync again. */
  partial: boolean;
  rpcCalls: number;
}

interface Point {
  balance: bigint;
  nonce: number;
}

/** A send still unmined and unknown to the node after this long is treated as dropped. */
export const DROP_AFTER_MS = 30 * 60_000;

/** Thrown inside a sync when its call budget is spent; caught by sync() itself. */
class SyncPaused extends Error {}

export interface SyncOptions {
  /** Start (or restart) scanning from this block. Default: continue from the checkpoint. */
  fromBlock?: number;
  /** Stay this many blocks behind the head. Default 2. */
  confirmations?: number;
  /**
   * Stop after this many RPC calls and save progress (hosts like Cloudflare Workers cap outgoing
   * requests per invocation). The next sync continues from there. Default: no limit.
   */
  maxRpcCalls?: number;
}

/**
 * Finds incoming ETH (and sends made outside this app) without an explorer API.
 *
 * Plain ETH transfers emit no logs, and scanning every block is far too slow on a fast L2.
 * Instead we compare the wallet's balance and nonce at two blocks with what the ledger already
 * explains for that range. If they match, nothing is missing. If not, the range is split in half
 * and each half is checked, down to single blocks, which are then read in full.
 * Cost: roughly 2·log2(range) RPC calls per new transaction.
 */
export class LedgerSync {
  constructor(
    private readonly deps: {
      db: Database;
      ledger: LedgerStore;
      history: ChainHistory;
      contacts?: AddressBook;
      now?: () => number;
    },
  ) {}

  getCheckpoint(
    wallet: Address,
  ): { lastBlock: number; balance: bigint; nonce: number } | undefined {
    const row = this.deps.db
      .prepare("SELECT last_block, balance_wei, nonce FROM sync_state WHERE wallet = ?")
      .get(wallet) as unknown as
      { last_block: number; balance_wei: string; nonce: number } | undefined;
    return row
      ? { lastBlock: row.last_block, balance: BigInt(row.balance_wei), nonce: row.nonce }
      : undefined;
  }

  async sync(walletInput: Address, opts: SyncOptions = {}): Promise<SyncReport> {
    const wallet = getAddress(walletInput);
    let rpcCalls = 0;
    const h = this.deps.history;
    const budget = opts.maxRpcCalls ?? Infinity;
    const count = <T>(p: Promise<T>) => {
      if (rpcCalls >= budget) {
        void p.catch(() => undefined);
        throw new SyncPaused();
      }
      rpcCalls += 1;
      return p;
    };
    const report: SyncReport = {
      wallet,
      initialized: false,
      fromBlock: 0,
      toBlock: 0,
      incoming: 0,
      outgoingExternal: 0,
      internalIncoming: 0,
      settledPending: 0,
      dropped: 0,
      unexplained: 0,
      partial: false,
      rpcCalls: 0,
    };

    // 1. Settle our own sends that were still pending; give up on ones the network dropped.
    const now = (this.deps.now ?? Date.now)();
    for (const { hash, timestamp } of this.deps.ledger.pendingOutgoingSince(wallet)) {
      if (rpcCalls + 4 >= budget) break; // leave room for the scan itself
      const r = await count(h.getReceipt(hash));
      if (r) {
        this.deps.ledger.markSettled(
          hash,
          r.status === "success" ? "confirmed" : "failed",
          r.gasUsed * r.effectiveGasPrice,
          r.blockNumber,
        );
        report.settledPending += 1;
      } else if (now - timestamp > DROP_AFTER_MS && !(await count(h.isKnownTransaction(hash)))) {
        this.deps.ledger.markDropped(hash);
        report.dropped += 1;
      }
    }

    const head = (await count(h.getHeadBlock())) - (opts.confirmations ?? 2);
    const points = new Map<number, Promise<Point>>();
    const point = (block: number): Promise<Point> => {
      let p = points.get(block);
      if (!p) {
        p = Promise.all([
          count(h.getBalanceAt(wallet, block)),
          count(h.getNonceAt(wallet, block)),
        ]).then(([balance, nonce]) => ({ balance, nonce }));
        points.set(block, p);
      }
      return p;
    };

    // 2. Where to start.
    const saved = this.getCheckpoint(wallet);
    let start: number;
    let startPoint: Point;
    if (opts.fromBlock !== undefined) {
      start = Math.max(0, Math.min(opts.fromBlock, head));
      startPoint = await point(start);
      // Save the starting point right away: if this sync pauses on its call budget, the next one
      // must continue from here, not treat the wallet as new.
      this.saveCheckpoint(wallet, start, startPoint);
    } else if (saved) {
      start = saved.lastBlock;
      startPoint = { balance: saved.balance, nonce: saved.nonce };
      points.set(start, Promise.resolve(startPoint));
    } else {
      // First sync of a wallet: history before today is not scanned unless fromBlock is given.
      start = head;
      startPoint = await point(start);
      this.saveCheckpoint(wallet, start, startPoint);
      return { ...report, initialized: true, fromBlock: start, toBlock: start, rpcCalls };
    }

    // With a call budget, scan a window small enough that the bisection reaches a checkpoint
    // within it (about two calls per halving), so every sync makes progress.
    let end = head;
    if (Number.isFinite(budget)) {
      const depth = Math.max(1, Math.floor((budget - 8) / 2));
      end = Math.min(head, start + 2 ** depth);
    }
    report.fromBlock = start;
    report.toBlock = Math.max(start, end);
    report.partial = end < head;
    if (end <= start) return { ...report, rpcCalls };

    const unexplained = (a: number, pa: Point, b: number, pb: Point) => {
      const f = this.deps.ledger.knownFlows(wallet, a, b);
      const expected = pa.balance + f.inWei - f.outWei - f.feeWei;
      return pb.balance !== expected || pb.nonce !== pa.nonce + f.minedOut;
    };

    const processBlock = async (b: number, pa: Point, pb: Point) => {
      const block = await count(h.getBlock(b));
      const timestamp = block.timestamp * 1000;
      const w = wallet.toLowerCase();
      for (const tx of block.txs) {
        const isIn = tx.to?.toLowerCase() === w && tx.value > 0n;
        const isOut = tx.from.toLowerCase() === w;
        if (!isIn && !isOut) continue;
        const receipt = await count(h.getReceipt(tx.hash));
        if (!receipt) continue;
        const ok = receipt.status === "success";

        if (isIn && ok && !this.deps.ledger.has(tx.hash, wallet, "in")) {
          if (
            this.deps.ledger.insertSynced({
              hash: tx.hash,
              direction: "in",
              wallet,
              counterparty: getAddress(tx.from),
              contactName: this.deps.contacts?.findByAddress(tx.from)?.name,
              amountWei: tx.value,
              feeWei: undefined,
              status: "confirmed",
              blockNumber: b,
              timestamp,
              source: "sync",
            })
          )
            report.incoming += 1;
        }

        if (isOut) {
          const fee = receipt.gasUsed * receipt.effectiveGasPrice;
          if (this.deps.ledger.has(tx.hash, wallet, "out")) {
            // Our own send; make sure it carries its block and fee.
            this.deps.ledger.markSettled(tx.hash, ok ? "confirmed" : "failed", fee, BigInt(b));
          } else if (
            this.deps.ledger.insertSynced({
              hash: tx.hash,
              direction: "out",
              wallet,
              counterparty: tx.to ? getAddress(tx.to) : zeroAddress,
              contactName: tx.to ? this.deps.contacts?.findByAddress(tx.to)?.name : undefined,
              amountWei: tx.value,
              feeWei: fee,
              status: ok ? "confirmed" : "failed",
              blockNumber: b,
              timestamp,
              source: "sync",
            })
          ) {
            report.outgoingExternal += 1;
          }
        }
      }

      // Anything left is ETH that arrived through a contract call (no tx addressed to us).
      const f = this.deps.ledger.knownFlows(wallet, b - 1, b);
      const residual = pb.balance - (pa.balance + f.inWei - f.outWei - f.feeWei);
      if (residual > 0n) {
        if (
          this.deps.ledger.insertSynced({
            hash: `internal:${b}`,
            direction: "in",
            wallet,
            counterparty: zeroAddress,
            contactName: undefined,
            amountWei: residual,
            feeWei: undefined,
            status: "confirmed",
            blockNumber: b,
            timestamp,
            source: "internal",
          })
        )
          report.internalIncoming += 1;
      } else if (residual < 0n) {
        report.unexplained += 1;
      }
    };

    // Depth-first, left to right: when scan(a, b) returns, everything up to b is recorded, so the
    // checkpoint can move to b. An interrupted sync (rate limit, network) resumes from there.
    const scan = async (a: number, pa: Point, b: number, pb: Point): Promise<void> => {
      if (unexplained(a, pa, b, pb)) {
        if (b - a === 1) {
          await processBlock(b, pa, pb);
        } else {
          const mid = Math.floor((a + b) / 2);
          const pm = await point(mid);
          await scan(a, pa, mid, pm);
          await scan(mid, pm, b, pb);
          return; // the right half already saved b
        }
      }
      this.saveCheckpoint(wallet, b, pb);
    };

    try {
      const endPoint = await point(end);
      await scan(start, startPoint, end, endPoint);
      this.saveCheckpoint(wallet, end, endPoint);
    } catch (err) {
      if (!(err instanceof SyncPaused)) throw err;
      report.partial = true;
      report.toBlock = this.getCheckpoint(wallet)?.lastBlock ?? start;
    }
    return { ...report, rpcCalls };
  }

  private saveCheckpoint(wallet: Address, block: number, p: Point): void {
    this.deps.db
      .prepare(
        `INSERT INTO sync_state (wallet, last_block, balance_wei, nonce, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(wallet) DO UPDATE SET last_block = excluded.last_block,
           balance_wei = excluded.balance_wei, nonce = excluded.nonce, updated_at = excluded.updated_at`,
      )
      .run(wallet, block, p.balance.toString(), p.nonce, Date.now());
  }
}
