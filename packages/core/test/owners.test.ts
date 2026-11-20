import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import {
  AddressBook,
  AiQuota,
  Books,
  LedgerStore,
  QuotaError,
  openDatabase,
  parseAddress,
} from "../src/index.ts";

const ALICE = parseAddress("0x51b2000000000000000000000000000000000e09");
const BOB = parseAddress("0x2d7c000000000000000000000000000000004e18");
const W1 = parseAddress("0x00000000000000000000000000000000000a11ce") as Address;
const W2 = parseAddress("0x0000000000000000000000000000000000000b0b") as Address;

describe("data per owner (public web app)", () => {
  it("each wallet has its own crew; the same name can mean different people", () => {
    const db = openDatabase(":memory:");
    const one = new AddressBook(db, Date.now, W1.toLowerCase());
    const two = new AddressBook(db, Date.now, W2.toLowerCase());
    const local = new AddressBook(db);
    one.add("robinhood", ALICE);
    two.add("robinhood", BOB);
    expect(one.get("robinhood")?.address).toBe(ALICE);
    expect(two.get("robinhood")?.address).toBe(BOB);
    expect(local.list()).toHaveLength(0);
    expect(one.resolve("robinhood")).toMatchObject({ kind: "contact" });
    expect(two.findByAddress(ALICE)).toBeUndefined();
    // one owner can't rename or remove another owner's contact
    expect(() => two.remove("nobody")).toThrow();
    two.remove("robinhood");
    expect(one.get("robinhood")).toBeDefined();
  });

  it("custom categories are per owner; built-ins are shared; removing clears only own entries", () => {
    const db = openDatabase(":memory:");
    const ledger = new LedgerStore(db);
    const b1 = new Books(db, ledger, Date.now, W1.toLowerCase());
    const b2 = new Books(db, ledger, Date.now, W2.toLowerCase());
    b1.addCategory("Rent");
    b2.addCategory("Rent");
    expect(b1.listCategories().map((c) => c.name)).toContain("Food");
    expect(b1.listCategories().filter((c) => c.name === "Rent")).toHaveLength(1);
    for (const [w, hash] of [
      [W1, `0x${"1".repeat(64)}`],
      [W2, `0x${"2".repeat(64)}`],
    ] as const) {
      ledger.insertSynced({
        hash: hash as `0x${string}`,
        direction: "in",
        wallet: w,
        counterparty: ALICE,
        contactName: undefined,
        amountWei: 1n,
        feeWei: undefined,
        status: "confirmed",
        blockNumber: 1,
        timestamp: 1,
        source: "sync",
      });
    }
    b1.setCategory(W1, `0x${"1".repeat(64)}`, "Rent");
    b2.setCategory(W2, `0x${"2".repeat(64)}`, "Rent");
    b1.removeCategory("Rent");
    expect(ledger.recent(W1, 1)[0]?.category).toBeUndefined();
    expect(ledger.recent(W2, 1)[0]?.category).toBe("Rent");
    expect(b2.listCategories().some((c) => c.name === "Rent")).toBe(true);
    // another owner's custom category can't be used
    const b3 = new Books(db, ledger, Date.now, "0xother");
    expect(() => b3.setCategory(W1, `0x${"1".repeat(64)}`, "Rent")).toThrow();
  });
});

describe("AI quota", () => {
  it("caps messages per wallet per UTC day and resets the next day", () => {
    const db = openDatabase(":memory:");
    const clock = { t: Date.UTC(2026, 10, 19, 23, 50) };
    const q = new AiQuota(db, { messagesPerWalletPerDay: 2, dailyBudgetUsd: 0 }, () => clock.t);
    q.check(W1);
    q.record(W1, 0.01);
    q.record(W1, 0.01);
    expect(() => q.check(W1)).toThrow(QuotaError);
    expect(() => q.check(W2)).not.toThrow(); // other wallets unaffected
    clock.t += 15 * 60_000; // past midnight UTC
    expect(() => q.check(W1)).not.toThrow();
  });

  it("stops everyone once the daily budget is spent", () => {
    const db = openDatabase(":memory:");
    const q = new AiQuota(db, { messagesPerWalletPerDay: 0, dailyBudgetUsd: 0.05 });
    q.record(W1, 0.03);
    q.record(W2, 0.03);
    expect(() => q.check("0xnew")).toThrow(/budget/i);
  });

  it("0 means unlimited", () => {
    const db = openDatabase(":memory:");
    const q = new AiQuota(db, { messagesPerWalletPerDay: 0, dailyBudgetUsd: 0 });
    for (let i = 0; i < 50; i++) q.record(W1, 1);
    expect(() => q.check(W1)).not.toThrow();
  });
});
