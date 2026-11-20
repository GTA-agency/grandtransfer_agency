import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { AddressBook, AiQuota, Books, LedgerStore, migrate, parseAddress } from "@gta/core";
import { DoSqlDatabase } from "../src/server/do-sql.ts";

/** A stand-in for a Durable Object's storage, with Cloudflare's restrictions enforced. */
function fakeDoStorage() {
  const db = new DatabaseSync(":memory:");
  const sent: string[] = [];
  return {
    sent,
    storage: {
      sql: {
        exec(query: string, ...bindings: unknown[]) {
          sent.push(query);
          if (/^\s*(BEGIN|COMMIT|ROLLBACK)\b/i.test(query)) throw new Error("not allowed on DO");
          if (/PRAGMA\s+user_version/i.test(query)) throw new Error("not allowed on DO");
          const many = query.split(";").filter((q) => q.trim()).length > 1;
          if (many && bindings.length === 0) {
            db.exec(query);
            return { toArray: () => [], rowsWritten: 0 };
          }
          const stmt = db.prepare(query);
          if (/^\s*(SELECT|WITH)\b/i.test(query) || /\bRETURNING\b/i.test(query)) {
            const rows = stmt.all(...(bindings as never[])) as Record<string, unknown>[];
            return { toArray: () => rows, rowsWritten: 0 };
          }
          const r = stmt.run(...(bindings as never[]));
          return { toArray: () => [], rowsWritten: Number(r.changes) };
        },
      },
      transactionSync<T>(fn: () => T): T {
        db.exec("BEGIN");
        try {
          const out = fn();
          db.exec("COMMIT");
          return out;
        } catch (e) {
          db.exec("ROLLBACK");
          throw e;
        }
      },
    },
  };
}

const ALICE = parseAddress("0x51b2000000000000000000000000000000000e09");
const W = parseAddress("0x00000000000000000000000000000000000a11ce");

describe("Durable Object SQL adapter", () => {
  it("runs every migration without BEGIN/COMMIT or PRAGMA user_version, and only once", () => {
    const f = fakeDoStorage();
    const db = new DoSqlDatabase(f.storage);
    migrate(db);
    const v = db.prepare("PRAGMA user_version").get() as { user_version: number };
    expect(v.user_version).toBeGreaterThanOrEqual(4);
    const before = f.sent.length;
    migrate(db); // second start of the object: nothing to do
    expect(f.sent.length - before).toBeLessThan(3);
    expect(f.sent.some((q) => /^\s*BEGIN/i.test(q))).toBe(false);
  });

  it("supports the app's stores: contacts (with ids), books, ledger, quotas", () => {
    const db = new DoSqlDatabase(fakeDoStorage().storage);
    migrate(db);
    const owner = W.toLowerCase();
    const contacts = new AddressBook(db, Date.now, owner);
    const c = contacts.add("robinhood", ALICE);
    expect(c.id).toBeGreaterThan(0);
    expect(contacts.get("ROBINHOOD")?.address).toBe(ALICE);
    contacts.rename("robinhood", "rh");
    expect(contacts.list().map((x) => x.name)).toEqual(["rh"]);

    const ledger = new LedgerStore(db);
    const books = new Books(db, ledger, Date.now, owner);
    ledger.recordOutgoingPending({
      hash: `0x${"a".repeat(64)}`,
      wallet: W,
      to: ALICE,
      contactName: "rh",
      amountWei: 10n ** 16n,
      timestamp: Date.now(),
    });
    ledger.markSettled(`0x${"a".repeat(64)}`, "confirmed", 21_000n, 5n);
    books.addCategory("Rent");
    books.setCategory(W, `0x${"a".repeat(64)}`, "Rent");
    books.removeCategory("Rent"); // uses a transaction
    expect(ledger.recent(W, 1)[0]).toMatchObject({ status: "confirmed", amountWei: 10n ** 16n });
    expect(() => books.setNote(W, `0x${"b".repeat(64)}`, "x")).toThrow(); // changes === 0

    const q = new AiQuota(db, { messagesPerWalletPerDay: 1, dailyBudgetUsd: 0 });
    q.record(W, 0.01);
    expect(() => q.check(W)).toThrow();
  });
});
