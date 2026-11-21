import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { parseEther, type Hash } from "viem";
import {
  AddressBook,
  Books,
  BooksError,
  LedgerStore,
  openDatabase,
  parseAddress,
  periodRange,
} from "../src/index.ts";

const W = parseAddress("0x96b5a46ed4be60cdafcdc75269695a4ba0f97cb1");
const ALICE = parseAddress("0x51b2000000000000000000000000000000000e09");
const BOB = parseAddress("0x2d7c000000000000000000000000000000004e18");
const at = (y: number, m: number, d: number, hh = 12) => new Date(y, m - 1, d, hh).getTime();
let n = 0;
const hash = () => `0x${(++n).toString(16).padStart(64, "0")}` as Hash;

function setup() {
  const db = openDatabase(":memory:");
  const ledger = new LedgerStore(db);
  const books = new Books(db, ledger, () => at(2026, 11, 19));
  const add = (e: {
    direction: "in" | "out";
    eth: string;
    ts: number;
    to?: typeof ALICE;
    fee?: bigint;
    status?: "confirmed" | "failed";
    contact?: string;
    source?: "sync" | "internal";
  }) => {
    const h = e.source === "internal" ? `internal:${++n}` : hash();
    ledger.insertSynced({
      hash: h,
      direction: e.direction,
      wallet: W,
      counterparty: e.to ?? ALICE,
      contactName: e.contact,
      amountWei: parseEther(e.eth),
      feeWei: e.fee,
      status: e.status ?? "confirmed",
      blockNumber: 1,
      timestamp: e.ts,
      source: e.source ?? "sync",
    });
    return h;
  };
  return { db, ledger, books, add };
}

describe("periodRange", () => {
  const now = new Date(2026, 10, 19, 15); // Thursday 19 Nov 2026
  it("week starts on Monday", () => {
    const p = periodRange("week", now);
    expect(new Date(p.from)).toEqual(new Date(2026, 10, 16));
    expect(new Date(p.to)).toEqual(new Date(2026, 10, 23));
    expect(p.bucket).toBe("day");
  });
  it("month and year use calendar bounds", () => {
    expect(periodRange("month", now)).toEqual({
      from: new Date(2026, 10, 1).getTime(),
      to: new Date(2026, 11, 1).getTime(),
      bucket: "day",
    });
    expect(periodRange("year", now)).toMatchObject({
      from: new Date(2026, 0, 1).getTime(),
      bucket: "month",
    });
  });
  it("all starts at the month of the earliest entry", () => {
    expect(periodRange("all", now, at(2026, 7, 14)).from).toBe(new Date(2026, 6, 1).getTime());
  });
});

describe("Books.recap", () => {
  it("totals in/out/gas/net; failed sends cost gas but no amount", () => {
    const { books, add } = setup();
    add({ direction: "in", eth: "0.5", ts: at(2026, 11, 3) });
    add({ direction: "out", eth: "0.1", ts: at(2026, 11, 4), fee: 1000n, to: BOB, contact: "bob" });
    add({ direction: "out", eth: "0.3", ts: at(2026, 11, 5), fee: 500n, status: "failed" });
    add({ direction: "in", eth: "9", ts: at(2026, 10, 30) }); // previous month: excluded

    const r = books.recap(W, books.period("month", W));
    expect(r.totals).toEqual({
      inWei: parseEther("0.5"),
      outWei: parseEther("0.1"),
      feeWei: 1500n,
      netWei: parseEther("0.4") - 1500n,
      count: 3,
      pending: 0,
    });
  });

  it("groups by category (with Uncategorized) and counterparty (contact names first)", () => {
    const { books, add } = setup();
    const a = add({ direction: "out", eth: "0.2", ts: at(2026, 11, 2), to: BOB, contact: "bob" });
    add({ direction: "out", eth: "0.05", ts: at(2026, 11, 2), to: BOB, contact: "bob" });
    add({ direction: "in", eth: "0.01", ts: at(2026, 11, 3), source: "internal" });
    books.setCategory(W, a, "food");

    const r = books.recap(W, books.period("month", W));
    expect(r.byCategory.map((c) => [c.category, c.count])).toEqual([
      ["Food", 1],
      ["Uncategorized", 2],
    ]);
    expect(r.byCounterparty.map((p) => [p.label, p.outWei, p.inWei])).toEqual([
      ["bob", parseEther("0.25"), 0n],
      ["Contract transfers", 0n, parseEther("0.01")],
    ]);
  });

  it("builds a continuous daily series, including empty days", () => {
    const { books, add } = setup();
    add({ direction: "in", eth: "1", ts: at(2026, 11, 2, 9) });
    add({ direction: "out", eth: "0.4", ts: at(2026, 11, 2, 20), fee: 7n });
    add({ direction: "in", eth: "0.1", ts: at(2026, 11, 30, 23) });
    const r = books.recap(W, books.period("month", W));
    expect(r.series).toHaveLength(30);
    expect(r.series[0]).toMatchObject({ key: "2026-11-01", inWei: 0n });
    expect(r.series[1]).toMatchObject({
      key: "2026-11-02",
      inWei: parseEther("1"),
      outWei: parseEther("0.4"),
      feeWei: 7n,
    });
    expect(r.series[29]).toMatchObject({ key: "2026-11-30", inWei: parseEther("0.1") });
  });
});

describe("Books categories and notes", () => {
  it("adds, rejects duplicates/invalid names, protects built-ins, clears removed ones", () => {
    const { books, ledger, add } = setup();
    expect(books.listCategories().find((c) => c.name === "Food")).toEqual({
      name: "Food",
      builtin: true,
    });
    expect(books.addCategory("  Rent  ")).toBe("Rent");
    expect(() => books.addCategory("rent")).toThrow(BooksError);
    expect(() => books.addCategory("=HYPERLINK()")).toThrow(BooksError);
    expect(() => books.addCategory("uncategorized")).toThrow(BooksError);
    expect(() => books.removeCategory("Food")).toThrow(/Built-in/);

    const h = add({ direction: "out", eth: "0.1", ts: at(2026, 11, 2) });
    books.setCategory(W, h, "RENT");
    expect(ledger.recent(W, 1)[0]!.category).toBe("Rent");
    books.removeCategory("rent");
    expect(ledger.recent(W, 1)[0]!.category).toBeUndefined();
  });

  it("notes are plain text, max 280 chars; empty clears", () => {
    const { books, ledger, add } = setup();
    const h = add({ direction: "in", eth: "0.1", ts: at(2026, 11, 2) });
    books.setNote(W, h, "rent\u0000 for\nNovember");
    expect(ledger.recent(W, 1)[0]!.note).toBe("rent  for November");
    expect(() => books.setNote(W, h, "x".repeat(281))).toThrow(/280/);
    books.setNote(W, h, "   ");
    expect(ledger.recent(W, 1)[0]!.note).toBeUndefined();
  });

  it("unknown categories and entries are rejected", () => {
    const { books, add } = setup();
    const h = add({ direction: "in", eth: "0.1", ts: at(2026, 11, 2) });
    expect(() => books.setCategory(W, h, "nope")).toThrow(/No category/);
    expect(() => books.setNote(W, "0xdead", "hi")).toThrow(/No ledger entry/);
  });
});

describe("Books.exportCsv", () => {
  it("quotes fields, neutralises formulas and leaves internal rows without explorer links", () => {
    const { books, add } = setup();
    const h = add({
      direction: "out",
      eth: "0.1",
      ts: at(2026, 11, 2),
      fee: 21_000n,
      contact: "bob",
    });
    books.setNote(W, h, '=cmd|"/c calc"!A1, "quoted"');
    add({ direction: "in", eth: "0.02", ts: at(2026, 11, 3), source: "internal" });
    const csv = books.exportCsv(W, books.period("month", W));
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe(
      '"date","direction","amount_eth","fee_eth","status","counterparty","contact","category","note","tx_hash","explorer_url"',
    );
    expect(lines[1]).toContain('"sent","0.1","0.000000000000021","confirmed"');
    expect(lines[1]).toContain(`"'=cmd|""/c calc""!A1, ""quoted"""`);
    expect(lines[1]).toContain(`"https://robinhoodchain.blockscout.com/tx/${h}"`);
    expect(lines[2]).toMatch(/"received","0.02",.*"contract transfer".*"internal:\d+",""$/);
  });
});

describe("database migration 1 → 2", () => {
  it("keeps existing ledger rows and contacts", () => {
    const dir = mkdtempSync(join(tmpdir(), "gta-mig-"));
    try {
      const v1 = new DatabaseSync(join(dir, "gta.db"));
      v1.exec(`
        CREATE TABLE contacts (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, address TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        CREATE TABLE ledger (id INTEGER PRIMARY KEY, tx_hash TEXT NOT NULL UNIQUE, direction TEXT NOT NULL, wallet TEXT NOT NULL, counterparty TEXT NOT NULL, contact_name TEXT, amount_wei TEXT NOT NULL, fee_wei TEXT, status TEXT NOT NULL, block_number INTEGER, timestamp INTEGER NOT NULL, category TEXT, note TEXT);
        INSERT INTO contacts VALUES (1, 'robinhood', '${ALICE}', 1, 1);
        INSERT INTO ledger VALUES (1, '0xabc', 'out', '${W}', '${ALICE}', 'robinhood', '10', '5', 'confirmed', 9, 1000, NULL, 'old note');
        PRAGMA user_version = 1;
      `);
      v1.close();

      const db = openDatabase(dir);
      const ledger = new LedgerStore(db);
      expect(ledger.recent(W, 5)).toEqual([
        expect.objectContaining({
          hash: "0xabc",
          amountWei: 10n,
          note: "old note",
          source: "agent",
          blockNumber: 9,
        }),
      ]);
      expect(
        (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
      ).toBe(5);
      expect((db.prepare("SELECT COUNT(*) AS c FROM categories").get() as { c: number }).c).toBe(9);
      // migration 3: old contacts belong to the local owner
      expect(new AddressBook(db).get("robinhood")?.address).toBe(ALICE);
      db.close?.();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
