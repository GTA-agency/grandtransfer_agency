import type { Address, Hash } from "viem";
import { inTransaction, type Database } from "./db.ts";

export type LedgerStatus = "pending" | "confirmed" | "failed";
export type LedgerSource = "agent" | "sync" | "internal";

export interface LedgerEntry {
  /** Tx hash, or `internal:<block>` for ETH received through a contract call (no own tx). */
  hash: Hash;
  direction: "in" | "out";
  counterparty: Address;
  contactName: string | undefined;
  amountWei: bigint;
  feeWei: bigint | undefined;
  status: LedgerStatus;
  blockNumber: number | undefined;
  timestamp: number;
  category: string | undefined;
  note: string | undefined;
  source: LedgerSource;
  /** Set when this run moved a token instead of ETH (amountWei is then 0). */
  token?: LedgerToken;
}

export interface LedgerToken {
  address: Address;
  symbol: string;
  decimals: number;
  amountUnits: bigint;
}

/**
 * The real transaction hash of a ledger row. Incoming tokens are stored as
 * `token:<tx hash>:<log index>` because one transaction can carry several transfers.
 */
export function ledgerTxHash(hash: string): string | undefined {
  if (hash.startsWith("internal:")) return undefined;
  return hash.startsWith("token:") ? hash.split(":")[1] : hash;
}

export interface LedgerSummary {
  inWei: bigint;
  outWei: bigint;
  feeWei: bigint;
  count: number;
}

interface LedgerRow {
  tx_hash: string;
  direction: "in" | "out";
  counterparty: string;
  contact_name: string | null;
  amount_wei: string;
  fee_wei: string | null;
  status: LedgerStatus;
  block_number: number | null;
  timestamp: number;
  category: string | null;
  note: string | null;
  source: LedgerSource;
}

const COLUMNS =
  "tx_hash, direction, counterparty, contact_name, amount_wei, fee_wei, status, block_number, timestamp, category, note, source";

export const toEntry = (r: LedgerRow): LedgerEntry => ({
  hash: r.tx_hash as Hash,
  direction: r.direction,
  counterparty: r.counterparty as Address,
  contactName: r.contact_name ?? undefined,
  amountWei: BigInt(r.amount_wei),
  feeWei: r.fee_wei === null ? undefined : BigInt(r.fee_wei),
  status: r.status,
  blockNumber: r.block_number ?? undefined,
  timestamp: r.timestamp,
  category: r.category ?? undefined,
  note: r.note ?? undefined,
  source: r.source,
});

export interface SyncedEntry {
  hash: string;
  direction: "in" | "out";
  wallet: Address;
  counterparty: Address;
  contactName: string | undefined;
  amountWei: bigint;
  feeWei: bigint | undefined;
  status: "confirmed" | "failed";
  blockNumber: number;
  timestamp: number;
  source: "sync" | "internal";
}

/** Ledger rows: outgoing sends from transfers, incoming and external entries from sync. */
export class LedgerStore {
  constructor(private readonly db: Database) {}

  recordOutgoingPending(entry: {
    hash: Hash;
    wallet: Address;
    to: Address;
    contactName: string | undefined;
    amountWei: bigint;
    timestamp: number;
    token?: LedgerToken;
  }): void {
    inTransaction(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO ledger (tx_hash, direction, wallet, counterparty, contact_name, amount_wei, status, timestamp, source)
           VALUES (?, 'out', ?, ?, ?, ?, 'pending', ?, 'agent')`,
        )
        .run(
          entry.hash,
          entry.wallet,
          entry.to,
          entry.contactName ?? null,
          entry.amountWei.toString(),
          entry.timestamp,
        );
      if (entry.token) {
        this.db
          .prepare(
            `INSERT INTO token_transfers (tx_hash, wallet, token, symbol, decimals, amount_units)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            entry.hash,
            entry.wallet,
            entry.token.address,
            entry.token.symbol,
            entry.token.decimals,
            entry.token.amountUnits.toString(),
          );
      }
    });
  }

  /** Record a token arrival found in the logs. Returns false if it's already in the books. */
  recordTokenIncoming(e: {
    hash: string;
    wallet: Address;
    counterparty: Address;
    contactName: string | undefined;
    token: LedgerToken;
    blockNumber: number;
    timestamp: number;
  }): boolean {
    return inTransaction(this.db, () => {
      const added = this.insertSynced({
        hash: e.hash,
        direction: "in",
        wallet: e.wallet,
        counterparty: e.counterparty,
        contactName: e.contactName,
        amountWei: 0n,
        feeWei: undefined,
        status: "confirmed",
        blockNumber: e.blockNumber,
        timestamp: e.timestamp,
        source: "sync",
      });
      if (added) {
        this.db
          .prepare(
            `INSERT OR IGNORE INTO token_transfers (tx_hash, wallet, token, symbol, decimals, amount_units)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            e.hash,
            e.wallet,
            e.token.address,
            e.token.symbol,
            e.token.decimals,
            e.token.amountUnits.toString(),
          );
      }
      return added;
    });
  }

  /** Token units sent since `sinceMs`, pending or confirmed (failed ones don't count). */
  sumTokenOutgoingSince(wallet: Address, token: Address, sinceMs: number): bigint {
    const rows = this.db
      .prepare(
        `SELECT t.amount_units FROM token_transfers t
         JOIN ledger l ON l.tx_hash = t.tx_hash AND lower(l.wallet) = lower(t.wallet) AND l.direction = 'out'
         WHERE lower(t.wallet) = lower(?) AND lower(t.token) = lower(?)
           AND l.status != 'failed' AND l.timestamp >= ?`,
      )
      .all(wallet, token, sinceMs) as unknown as { amount_units: string }[];
    return rows.reduce((sum, r) => sum + BigInt(r.amount_units), 0n);
  }

  private withTokens(wallet: Address, entries: LedgerEntry[]): LedgerEntry[] {
    if (entries.length === 0) return entries;
    const rows = this.db
      .prepare(
        "SELECT tx_hash, token, symbol, decimals, amount_units FROM token_transfers WHERE lower(wallet) = lower(?)",
      )
      .all(wallet) as unknown as {
      tx_hash: string;
      token: string;
      symbol: string;
      decimals: number;
      amount_units: string;
    }[];
    if (rows.length === 0) return entries;
    const byHash = new Map(rows.map((r) => [r.tx_hash, r]));
    return entries.map((e) => {
      const t =
        e.direction === "out" || e.hash.startsWith("token:") ? byHash.get(e.hash) : undefined;
      if (!t) return e;
      return {
        ...e,
        token: {
          address: t.token as Address,
          symbol: t.symbol,
          decimals: t.decimals,
          amountUnits: BigInt(t.amount_units),
        },
      };
    });
  }

  markSettled(
    hash: Hash,
    status: "confirmed" | "failed",
    feeWei: bigint,
    blockNumber: bigint,
  ): void {
    this.db
      .prepare(
        "UPDATE ledger SET status = ?, fee_wei = ?, block_number = ? WHERE tx_hash = ? AND direction = 'out'",
      )
      .run(status, feeWei.toString(), Number(blockNumber), hash);
  }

  /** Insert an entry found by sync. Returns false if it was already recorded (idempotent). */
  insertSynced(e: SyncedEntry): boolean {
    const res = this.db
      .prepare(
        `INSERT OR IGNORE INTO ledger (tx_hash, direction, wallet, counterparty, contact_name, amount_wei,
           fee_wei, status, block_number, timestamp, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        e.hash,
        e.direction,
        e.wallet,
        e.counterparty,
        e.contactName ?? null,
        e.amountWei.toString(),
        e.feeWei === undefined ? null : e.feeWei.toString(),
        e.status,
        e.blockNumber,
        e.timestamp,
        e.source,
      );
    return Number(res.changes) > 0;
  }

  has(hash: string, wallet: Address, direction: "in" | "out"): boolean {
    return (
      this.db
        .prepare(
          "SELECT 1 FROM ledger WHERE tx_hash = ? AND lower(wallet) = lower(?) AND direction = ?",
        )
        .get(hash, wallet, direction) !== undefined
    );
  }

  /** Outgoing entries still waiting for a receipt. */
  /** Pending sends with the time they were sent. */
  pendingOutgoingSince(wallet: Address): { hash: Hash; timestamp: number }[] {
    return (
      this.db
        .prepare(
          "SELECT tx_hash, timestamp FROM ledger WHERE direction = 'out' AND status = 'pending' AND lower(wallet) = lower(?)",
        )
        .all(wallet) as unknown as { tx_hash: string; timestamp: number }[]
    ).map((r) => ({ hash: r.tx_hash as Hash, timestamp: r.timestamp }));
  }

  /** A send the network never mined and no longer knows: it moved no ETH and cost no gas. */
  markDropped(hash: Hash): void {
    this.db
      .prepare(
        "UPDATE ledger SET status = 'failed', fee_wei = '0' WHERE tx_hash = ? AND direction = 'out' AND status = 'pending'",
      )
      .run(hash);
  }

  pendingOutgoing(wallet: Address): Hash[] {
    return (
      this.db
        .prepare(
          "SELECT tx_hash FROM ledger WHERE direction = 'out' AND status = 'pending' AND lower(wallet) = lower(?)",
        )
        .all(wallet) as unknown as { tx_hash: string }[]
    ).map((r) => r.tx_hash as Hash);
  }

  /**
   * What the ledger already explains about blocks (fromExclusive, toInclusive]:
   * money in, money out, fees paid and how many of our transactions were mined (nonce increments).
   */
  knownFlows(
    wallet: Address,
    fromExclusive: number,
    toInclusive: number,
  ): { inWei: bigint; outWei: bigint; feeWei: bigint; minedOut: number } {
    const rows = this.db
      .prepare(
        `SELECT direction, amount_wei, fee_wei, status FROM ledger
         WHERE lower(wallet) = lower(?) AND block_number > ? AND block_number <= ? AND status != 'pending'`,
      )
      .all(wallet, fromExclusive, toInclusive) as unknown as Pick<
      LedgerRow,
      "direction" | "amount_wei" | "fee_wei" | "status"
    >[];
    const f = { inWei: 0n, outWei: 0n, feeWei: 0n, minedOut: 0 };
    for (const r of rows) {
      if (r.direction === "in") {
        if (r.status === "confirmed") f.inWei += BigInt(r.amount_wei);
        continue;
      }
      f.minedOut += 1;
      if (r.fee_wei) f.feeWei += BigInt(r.fee_wei);
      if (r.status === "confirmed") f.outWei += BigInt(r.amount_wei);
    }
    return f;
  }

  /** Sum of outgoing amounts since `sinceMs` that are pending or confirmed (failed ones don't count). */
  sumOutgoingSince(wallet: Address, sinceMs: number): bigint {
    const rows = this.db
      .prepare(
        `SELECT amount_wei FROM ledger
         WHERE direction = 'out' AND lower(wallet) = lower(?) AND status != 'failed' AND timestamp >= ?`,
      )
      .all(wallet, sinceMs) as unknown as { amount_wei: string }[];
    return rows.reduce((sum, r) => sum + BigInt(r.amount_wei), 0n);
  }

  /** True if this wallet has ever successfully sent to `to`. */
  hasSentTo(wallet: Address, to: Address): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 FROM ledger WHERE direction = 'out' AND status = 'confirmed'
         AND lower(wallet) = lower(?) AND lower(counterparty) = lower(?) LIMIT 1`,
      )
      .get(wallet, to);
    return row !== undefined;
  }

  /** Most recent entries first. */
  recent(wallet: Address, limit: number): LedgerEntry[] {
    const rows = this.db
      .prepare(
        `SELECT ${COLUMNS} FROM ledger WHERE lower(wallet) = lower(?)
         ORDER BY timestamp DESC, id DESC LIMIT ?`,
      )
      .all(wallet, Math.max(1, Math.min(100, Math.floor(limit)))) as unknown as LedgerRow[];
    return this.withTokens(wallet, rows.map(toEntry));
  }

  /** Entries whose hash starts with `prefix` (case-insensitive), newest first. */
  findByPrefix(wallet: Address, prefix: string): LedgerEntry[] {
    const p = prefix.trim().toLowerCase();
    if (p.length < 6) return [];
    const rows = this.db
      .prepare(
        `SELECT ${COLUMNS} FROM ledger WHERE lower(wallet) = lower(?) AND lower(tx_hash) LIKE ? ESCAPE '\\'
         ORDER BY timestamp DESC LIMIT 10`,
      )
      .all(wallet, `${p.replace(/[\\%_]/g, (c) => `\\${c}`)}%`) as unknown as LedgerRow[];
    return this.withTokens(wallet, rows.map(toEntry));
  }

  /** Entries with fromMs <= timestamp < toMs, oldest first. */
  between(wallet: Address, fromMs: number, toMs: number): LedgerEntry[] {
    const rows = this.db
      .prepare(
        `SELECT ${COLUMNS} FROM ledger WHERE lower(wallet) = lower(?) AND timestamp >= ? AND timestamp < ?
         ORDER BY timestamp ASC, id ASC`,
      )
      .all(wallet, fromMs, toMs) as unknown as LedgerRow[];
    return this.withTokens(wallet, rows.map(toEntry));
  }

  /** Totals since `sinceMs` (failed transfers excluded from amounts, but their fees count). */
  summary(wallet: Address, sinceMs: number): LedgerSummary {
    const entries = this.between(wallet, sinceMs, Number.MAX_SAFE_INTEGER);
    const s: LedgerSummary = { inWei: 0n, outWei: 0n, feeWei: 0n, count: entries.length };
    for (const e of entries) {
      if (e.feeWei) s.feeWei += e.feeWei;
      if (e.status === "failed") continue;
      if (e.direction === "in") s.inWei += e.amountWei;
      else s.outWei += e.amountWei;
    }
    return s;
  }

  getByHash(
    hash: Hash,
  ): { status: string; amount_wei: string; fee_wei: string | null } | undefined {
    return this.db
      .prepare(
        "SELECT status, amount_wei, fee_wei FROM ledger WHERE tx_hash = ? ORDER BY direction DESC LIMIT 1",
      )
      .get(hash) as unknown as
      { status: string; amount_wei: string; fee_wei: string | null } | undefined;
  }
}
