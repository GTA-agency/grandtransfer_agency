import { getAddress, zeroAddress, type Address } from "viem";
import { GTA_TOKEN } from "../chain.ts";
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
  /** $GTA arrivals added to the books. */
  tokenIncoming: number;
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

/** The widest log query the free archive RPC accepts (checked 2026-11-22). */
const TOKEN_LOG_WINDOW = 100;

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
    const report = await this.syncEth(walletInput, opts);
    await this.syncToken(report, opts);
    return report;
  }

  /**
   * Incoming $GTA. Free RPCs serve only 100 blocks of logs per query, so like the ETH scan this
   * compares the wallet's token balance and nonce at two blocks: no change means nothing to read.
   * A range that changed is halved down to 100 blocks, and only those logs are read. A failure
   * here never affects the ETH result; the next sync continues from the checkpoint.
   */
  private async syncToken(report: SyncReport, opts: SyncOptions): Promise<void> {
    const h = this.deps.history;
    const { getTokenTransfersTo, getBlockTimestamp, getTokenBalanceAt } = h;
    if (!getTokenTransfersTo || !getBlockTimestamp || !getTokenBalanceAt) return;
    const wallet = report.wallet;
    const token = GTA_TOKEN;
    const budget = (opts.maxRpcCalls ?? Infinity) - report.rpcCalls;
    let calls = 0;
    const spend = (n = 1) => {
      if (calls + n > budget) throw new SyncPaused();
      calls += n;
    };
    const point = async (block: number): Promise<Point> => {
      spend(2);
      const [balance, nonce] = await Promise.all([
        getTokenBalanceAt(token.address, wallet, block),
        h.getNonceAt(wallet, block),
      ]);
      return { balance, nonce };
    };
    const readLogs = async (from: number, to: number) => {
      spend();
      const logs = await getTokenTransfersTo(token.address, wallet, from, to);
      // Zero-value transfers are how address-poisoning spam gets into a wallet's history.
      const real = logs.filter(
        (l) => l.value > 0n && l.from.toLowerCase() !== wallet.toLowerCase(),
      );
      const times = new Map<number, number>();
      for (const b of new Set(real.map((l) => l.blockNumber))) {
        spend();
        times.set(b, await getBlockTimestamp(b));
      }
      for (const l of real) {
        const added = this.deps.ledger.recordTokenIncoming({
          hash: `token:${l.hash}:${l.logIndex}`,
          wallet,
          counterparty: getAddress(l.from),
          contactName: this.deps.contacts?.findByAddress(l.from)?.name,
          token: {
            address: token.address,
            symbol: token.symbol,
            decimals: token.decimals,
            amountUnits: l.value,
          },
          blockNumber: l.blockNumber,
          timestamp: times.get(l.blockNumber)! * 1000,
        });
        if (added) report.tokenIncoming += 1;
      }
    };
    const scan = async (a: number, pa: Point, b: number, pb: Point): Promise<void> => {
      if (pa.balance !== pb.balance || pa.nonce !== pb.nonce) {
        if (b - a <= TOKEN_LOG_WINDOW) {
          await readLogs(a + 1, b);
        } else {
          const mid = Math.floor((a + b) / 2);
          const pm = await point(mid);
          await scan(a, pa, mid, pm);
          await scan(mid, pm, b, pb);
          return; // the right half already saved b
        }
      }
      this.saveTokenCheckpoint(wallet, token.address, b, pb);
    };

    try {
      spend();
      const head = (await h.getHeadBlock()) - (opts.confirmations ?? 2);
      const row = this.deps.db
        .prepare(
          "SELECT last_block, balance_units, nonce FROM token_sync WHERE wallet = ? AND token = ?",
        )
        .get(wallet, token.address) as
        { last_block: number; balance_units: string; nonce: number } | undefined;
      if (!row) {
        this.saveTokenCheckpoint(wallet, token.address, head, await point(head));
        return;
      }
      const start = row.last_block;
      if (head <= start) return;
      // With a call budget, take a range the halving can finish within it, so each sync advances.
      let end = head;
      if (Number.isFinite(budget)) {
        const depth = Math.max(0, Math.floor((budget - calls - 6) / 2));
        end = Math.min(head, start + TOKEN_LOG_WINDOW * 2 ** Math.min(depth, 24));
      }
      const startPoint = { balance: BigInt(row.balance_units), nonce: row.nonce };
      await scan(start, startPoint, end, await point(end));
      if (end < head) report.partial = true;
    } catch (err) {
      if (err instanceof SyncPaused) report.partial = true;
      /* otherwise network trouble: the checkpoint is where it was */
    } finally {
      report.rpcCalls += calls;
    }
  }

  private saveTokenCheckpoint(wallet: Address, token: Address, block: number, p: Point): void {
    this.deps.db
      .prepare(
        `INSERT INTO token_sync (wallet, token, last_block, balance_units, nonce, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(wallet, token) DO UPDATE SET last_block = excluded.last_block,
           balance_units = excluded.balance_units, nonce = excluded.nonce,
           updated_at = excluded.updated_at`,
      )
      .run(wallet, token, block, p.balance.toString(), p.nonce, (this.deps.now ?? Date.now)());
  }

  private async syncEth(walletInput: Address, opts: SyncOptions): Promise<SyncReport> {
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
      tokenIncoming: 0,
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
