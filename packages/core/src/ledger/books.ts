import type { Address } from "viem";
import { formatEth } from "../amount.ts";
import { explorerTxUrl } from "../chain.ts";
import { inTransaction, type Database } from "../db.ts";
import { ledgerTxHash, type LedgerEntry, type LedgerStore } from "../ledger-store.ts";
import { formatTokenAmount } from "../tokens.ts";

export class BooksError extends Error {
  constructor(
    public readonly code:
      | "INVALID_CATEGORY"
      | "DUPLICATE_CATEGORY"
      | "BUILTIN_CATEGORY"
      | "UNKNOWN_CATEGORY"
      | "NOTE_TOO_LONG"
      | "ENTRY_NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "BooksError";
  }
}

export type Bucket = "day" | "month";
export type PeriodPreset = "today" | "week" | "month" | "year" | "all";

export interface Period {
  from: number;
  to: number;
  bucket: Bucket;
}

export interface Totals {
  inWei: bigint;
  outWei: bigint;
  feeWei: bigint;
  netWei: bigint;
  count: number;
  pending: number;
}

export interface Recap {
  period: Period;
  totals: Totals;
  byCategory: { category: string; inWei: bigint; outWei: bigint; count: number }[];
  byCounterparty: {
    label: string;
    address: Address | undefined;
    inWei: bigint;
    outWei: bigint;
    count: number;
  }[];
  series: { key: string; start: number; inWei: bigint; outWei: bigint; feeWei: bigint }[];
}

export const UNCATEGORIZED = "Uncategorized";
const CATEGORY = /^[\p{L}\p{N}][\p{L}\p{N} &._-]{0,29}$/u;
const MAX_NOTE = 280;
const MAX_BUCKETS = 400;

/** Calendar periods in the machine's local time zone. Weeks start on Monday. */
export function periodRange(
  preset: PeriodPreset,
  now: Date = new Date(),
  earliest?: number,
): Period {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  switch (preset) {
    case "today":
      return {
        from: new Date(y, m, d).getTime(),
        to: new Date(y, m, d + 1).getTime(),
        bucket: "day",
      };
    case "week": {
      const monday = d - ((now.getDay() + 6) % 7);
      return {
        from: new Date(y, m, monday).getTime(),
        to: new Date(y, m, monday + 7).getTime(),
        bucket: "day",
      };
    }
    case "month":
      return {
        from: new Date(y, m, 1).getTime(),
        to: new Date(y, m + 1, 1).getTime(),
        bucket: "day",
      };
    case "year":
      return {
        from: new Date(y, 0, 1).getTime(),
        to: new Date(y + 1, 0, 1).getTime(),
        bucket: "month",
      };
    case "all": {
      const start = earliest !== undefined ? new Date(earliest) : new Date(y, m, 1);
      return {
        from: new Date(start.getFullYear(), start.getMonth(), 1).getTime(),
        to: new Date(y, m + 1, 1).getTime(),
        bucket: "month",
      };
    }
  }
}

function bucketKey(ts: number, bucket: Bucket): string {
  const t = new Date(ts);
  const mm = String(t.getMonth() + 1).padStart(2, "0");
  if (bucket === "month") return `${t.getFullYear()}-${mm}`;
  return `${t.getFullYear()}-${mm}-${String(t.getDate()).padStart(2, "0")}`;
}

function nextBucketStart(ts: number, bucket: Bucket): number {
  const t = new Date(ts);
  return bucket === "month"
    ? new Date(t.getFullYear(), t.getMonth() + 1, 1).getTime()
    : new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1).getTime();
}

/** Neutralise spreadsheet formula injection and quote every field. */
function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export class Books {
  constructor(
    private readonly db: Database,
    private readonly ledger: LedgerStore,
    private readonly now: () => number = Date.now,
    /** Whose custom categories: 'local', or a wallet address in the public web app. */
    readonly owner: string = "local",
  ) {}

  // ---------- categories ----------

  listCategories(): { name: string; builtin: boolean }[] {
    return (
      this.db
        .prepare(
          "SELECT name, builtin FROM categories WHERE owner IN ('*', ?) ORDER BY builtin DESC, name",
        )
        .all(this.owner) as unknown as { name: string; builtin: number }[]
    ).map((r) => ({ name: r.name, builtin: r.builtin === 1 }));
  }

  addCategory(name: string): string {
    const clean = name.trim().replace(/\s+/g, " ");
    if (!CATEGORY.test(clean) || clean.toLowerCase() === UNCATEGORIZED.toLowerCase()) {
      throw new BooksError(
        "INVALID_CATEGORY",
        "Category names are 1–30 characters: letters, digits, space, &, dot, dash, underscore.",
      );
    }
    if (this.findCategory(clean)) {
      throw new BooksError("DUPLICATE_CATEGORY", `Category "${clean}" already exists.`);
    }
    this.db
      .prepare("INSERT INTO categories (owner, name, builtin, created_at) VALUES (?, ?, 0, ?)")
      .run(this.owner, clean, this.now());
    return clean;
  }

  removeCategory(name: string): void {
    const found = this.findCategory(name);
    if (!found) throw new BooksError("UNKNOWN_CATEGORY", `No category named "${name.trim()}".`);
    if (found.builtin)
      throw new BooksError("BUILTIN_CATEGORY", "Built-in categories can't be removed.");
    inTransaction(this.db, () => {
      // Clear it from this owner's entries only ('local' owns every wallet on this machine).
      if (this.owner === "local") {
        this.db.prepare("UPDATE ledger SET category = NULL WHERE category = ?").run(found.name);
      } else {
        this.db
          .prepare(
            "UPDATE ledger SET category = NULL WHERE category = ? AND lower(wallet) = lower(?)",
          )
          .run(found.name, this.owner);
      }
      this.db
        .prepare("DELETE FROM categories WHERE owner = ? AND name = ?")
        .run(this.owner, found.name);
    });
  }

  /** Set or clear (null) the category of a ledger entry. */
  setCategory(wallet: Address, hash: string, category: string | null): void {
    let value: string | null = null;
    if (category !== null) {
      const found = this.findCategory(category);
      if (!found)
        throw new BooksError("UNKNOWN_CATEGORY", `No category named "${category.trim()}".`);
      value = found.name;
    }
    this.updateEntry(wallet, hash, "category", value);
  }

  /** Set or clear (null) the note of a ledger entry. Plain text, max 280 characters. */
  setNote(wallet: Address, hash: string, note: string | null): void {
    let value: string | null = null;
    if (note !== null) {
      value = note.replace(/\p{Cc}/gu, " ").trim();
      if (value.length > MAX_NOTE) {
        throw new BooksError("NOTE_TOO_LONG", `Notes can be at most ${MAX_NOTE} characters.`);
      }
      if (value === "") value = null;
    }
    this.updateEntry(wallet, hash, "note", value);
  }

  // ---------- recaps ----------

  period(preset: PeriodPreset, wallet: Address): Period {
    const first = this.db
      .prepare("SELECT MIN(timestamp) AS t FROM ledger WHERE lower(wallet) = lower(?)")
      .get(wallet) as unknown as { t: number | null };
    return periodRange(preset, new Date(this.now()), first.t ?? undefined);
  }

  recap(wallet: Address, period: Period): Recap {
    const entries = this.ledger.between(wallet, period.from, period.to);
    const totals: Totals = { inWei: 0n, outWei: 0n, feeWei: 0n, netWei: 0n, count: 0, pending: 0 };
    const cats = new Map<string, Recap["byCategory"][number]>();
    const parties = new Map<string, Recap["byCounterparty"][number]>();
    const series = new Map<string, Recap["series"][number]>();

    // Empty buckets too, so charts have a continuous x-axis.
    for (
      let s = period.from, i = 0;
      s < period.to && i < MAX_BUCKETS;
      s = nextBucketStart(s, period.bucket), i++
    ) {
      const key = bucketKey(s, period.bucket);
      series.set(key, { key, start: s, inWei: 0n, outWei: 0n, feeWei: 0n });
    }

    for (const e of entries) {
      totals.count += 1;
      if (e.status === "pending") totals.pending += 1;
      const fee = e.feeWei ?? 0n;
      totals.feeWei += fee;
      const amount = e.status === "failed" ? 0n : e.amountWei;
      const inW = e.direction === "in" ? amount : 0n;
      const outW = e.direction === "out" ? amount : 0n;
      totals.inWei += inW;
      totals.outWei += outW;

      const catName = e.category ?? UNCATEGORIZED;
      const c = cats.get(catName) ?? { category: catName, inWei: 0n, outWei: 0n, count: 0 };
      c.inWei += inW;
      c.outWei += outW;
      c.count += 1;
      cats.set(catName, c);

      const label = partyLabel(e);
      const p = parties.get(label) ?? {
        label,
        address: e.source === "internal" ? undefined : e.counterparty,
        inWei: 0n,
        outWei: 0n,
        count: 0,
      };
      p.inWei += inW;
      p.outWei += outW;
      p.count += 1;
      parties.set(label, p);

      const s = series.get(bucketKey(e.timestamp, period.bucket));
      if (s) {
        s.inWei += inW;
        s.outWei += outW;
        s.feeWei += fee;
      }
    }
    totals.netWei = totals.inWei - totals.outWei - totals.feeWei;
    const byVolume = (
      a: { inWei: bigint; outWei: bigint },
      b: { inWei: bigint; outWei: bigint },
    ) => {
      const d = b.inWei + b.outWei - (a.inWei + a.outWei);
      return d > 0n ? 1 : d < 0n ? -1 : 0;
    };
    return {
      period,
      totals,
      byCategory: [...cats.values()].sort(byVolume),
      byCounterparty: [...parties.values()].sort(byVolume),
      series: [...series.values()],
    };
  }

  /** CSV of all entries in the period, oldest first. */
  exportCsv(wallet: Address, period: Pick<Period, "from" | "to">): string {
    const header = [
      "date",
      "direction",
      "amount_eth",
      "fee_eth",
      "status",
      "counterparty",
      "contact",
      "category",
      "note",
      "tx_hash",
      "explorer_url",
      "token",
      "token_amount",
    ];
    const lines = [header.map(csvField).join(",")];
    for (const e of this.ledger.between(wallet, period.from, period.to)) {
      const txHash = ledgerTxHash(e.hash);
      lines.push(
        [
          new Date(e.timestamp).toISOString(),
          e.direction === "in" ? "received" : "sent",
          formatEth(e.amountWei),
          e.feeWei === undefined ? "" : formatEth(e.feeWei),
          e.status,
          e.source === "internal" ? "" : e.counterparty,
          e.contactName ?? (e.source === "internal" ? "contract transfer" : ""),
          e.category ?? "",
          e.note ?? "",
          txHash ?? e.hash,
          txHash ? explorerTxUrl(txHash) : "",
          e.token?.symbol ?? "",
          e.token ? formatTokenAmount(e.token.amountUnits, e.token.decimals) : "",
        ]
          .map(csvField)
          .join(","),
      );
    }
    return `${lines.join("\r\n")}\r\n`;
  }

  private findCategory(name: string): { name: string; builtin: boolean } | undefined {
    const row = this.db
      .prepare("SELECT name, builtin FROM categories WHERE owner IN ('*', ?) AND name = ?")
      .get(this.owner, name.trim()) as unknown as { name: string; builtin: number } | undefined;
    return row ? { name: row.name, builtin: row.builtin === 1 } : undefined;
  }

  private updateEntry(
    wallet: Address,
    hash: string,
    column: "category" | "note",
    value: string | null,
  ) {
    const res = this.db
      .prepare(`UPDATE ledger SET ${column} = ? WHERE tx_hash = ? AND lower(wallet) = lower(?)`)
      .run(value, hash, wallet);
    if (Number(res.changes) === 0) {
      throw new BooksError("ENTRY_NOT_FOUND", "No ledger entry with that transaction hash.");
    }
  }
}

function partyLabel(e: LedgerEntry): string {
  if (e.source === "internal") return "Contract transfers";
  return e.contactName ?? e.counterparty;
}
