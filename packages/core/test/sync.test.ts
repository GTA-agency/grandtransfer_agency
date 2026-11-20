import { describe, expect, it } from "vitest";
import { parseEther, type Address, type Hash } from "viem";
import {
  AddressBook,
  LedgerStore,
  LedgerSync,
  openDatabase,
  parseAddress,
  type ChainHistory,
  type HistoryTx,
} from "../src/index.ts";

const W = parseAddress("0x96b5a46ed4be60cdafcdc75269695a4ba0f97cb1");
const ALICE = parseAddress("0x51b2000000000000000000000000000000000e09");
const BOB = parseAddress("0x2d7c000000000000000000000000000000004e18");
const CONTRACT = parseAddress("0x00000000000000000000000000000000c0ffee00");
const OTHER = parseAddress("0x1111111111111111111111111111111111111111");

interface Ev {
  block: number;
  hash: Hash;
  from: Address;
  to: Address;
  value: bigint;
  /** total fee paid by `from` */
  fee?: bigint;
  status?: "success" | "reverted";
  /** ETH that reaches W through a contract call: shows up only as a balance change. */
  internalToW?: bigint;
}

let n = 0;
const h = () => `0x${(++n).toString(16).padStart(64, "0")}` as Hash;

/** A tiny simulated chain: balances/nonces are derived from events, so history is consistent. */
function fakeHistory(opts: { head: number; initial: bigint; events: Ev[] }): ChainHistory & {
  calls: number;
  head: number;
} {
  const w = W.toLowerCase();
  const effect = (e: Ev) => {
    const ok = (e.status ?? "success") === "success";
    let d = 0n;
    let nonce = 0;
    if (e.from.toLowerCase() === w) {
      nonce = 1;
      d -= e.fee ?? 0n;
      if (ok) d -= e.value;
    }
    if (ok && e.to.toLowerCase() === w) d += e.value;
    if (e.internalToW) d += e.internalToW;
    return { d, nonce };
  };
  const self = {
    calls: 0,
    head: opts.head,
    getHeadBlock: async () => {
      self.calls++;
      return self.head;
    },
    getBalanceAt: async (_a: Address, block: number) => {
      self.calls++;
      return opts.events
        .filter((e) => e.block <= block)
        .reduce((b, e) => b + effect(e).d, opts.initial);
    },
    getNonceAt: async (_a: Address, block: number) => {
      self.calls++;
      return opts.events.filter((e) => e.block <= block).reduce((c, e) => c + effect(e).nonce, 0);
    },
    getBlock: async (block: number) => {
      self.calls++;
      const txs: HistoryTx[] = opts.events
        .filter((e) => e.block === block)
        .map((e) => ({ hash: e.hash, from: e.from, to: e.to, value: e.value }));
      // noise: an unrelated tx in every block
      txs.push({ hash: h(), from: OTHER, to: BOB, value: 1n });
      return { timestamp: 1_790_000_000 + block, txs };
    },
    isKnownTransaction: async () => {
      self.calls++;
      return true;
    },
    getReceipt: async (hash: Hash) => {
      self.calls++;
      const e = opts.events.find((x) => x.hash === hash);
      if (!e)
        return {
          status: "success" as const,
          gasUsed: 21_000n,
          effectiveGasPrice: 1n,
          blockNumber: 0n,
        };
      return {
        status: e.status ?? "success",
        gasUsed: 21_000n,
        effectiveGasPrice: (e.fee ?? 0n) / 21_000n,
        blockNumber: BigInt(e.block),
      };
    },
  };
  return self;
}

function setup(history: ChainHistory) {
  const db = openDatabase(":memory:");
  const ledger = new LedgerStore(db);
  const contacts = new AddressBook(db);
  contacts.add("alice", ALICE);
  const sync = new LedgerSync({ db, ledger, history, contacts });
  return { db, ledger, contacts, sync };
}

describe("LedgerSync", () => {
  it("first sync only saves a checkpoint at head - confirmations", async () => {
    const hist = fakeHistory({ head: 5_000, initial: parseEther("1"), events: [] });
    const { sync } = setup(hist);
    const r = await sync.sync(W);
    expect(r).toMatchObject({ initialized: true, fromBlock: 4_998, toBlock: 4_998, incoming: 0 });
    expect(sync.getCheckpoint(W)).toEqual({ lastBlock: 4_998, balance: parseEther("1"), nonce: 0 });
  });

  it("finds incoming transfers across a million blocks with few RPC calls", async () => {
    const events: Ev[] = [
      { block: 123_456, hash: h(), from: ALICE, to: W, value: parseEther("0.25") },
      { block: 777_001, hash: h(), from: BOB, to: W, value: parseEther("0.1") },
    ];
    const hist = fakeHistory({ head: 1_000_002, initial: 0n, events });
    const { sync, ledger } = setup(hist);
    const r = await sync.sync(W, { fromBlock: 0 });

    expect(r).toMatchObject({ fromBlock: 0, toBlock: 1_000_000, incoming: 2, unexplained: 0 });
    const entries = ledger.recent(W, 10);
    expect(
      entries.map((e) => [e.blockNumber, e.direction, e.amountWei, e.contactName ?? null]),
    ).toEqual([
      [777_001, "in", parseEther("0.1"), null],
      [123_456, "in", parseEther("0.25"), "alice"],
    ]);
    expect(entries[1]).toMatchObject({ counterparty: ALICE, source: "sync", status: "confirmed" });
    expect(entries[1]!.timestamp).toBe((1_790_000_000 + 123_456) * 1000);
    // ~2·log2(1e6) ≈ 40 point lookups per event, plus a block + receipt; nowhere near 1e6
    expect(r.rpcCalls).toBeLessThan(200);
    expect(sync.getCheckpoint(W)).toMatchObject({
      lastBlock: 1_000_000,
      balance: parseEther("0.35"),
    });
  });

  it("does nothing extra when the ledger already explains the range (our own send)", async () => {
    const send: Ev = {
      block: 50,
      hash: h(),
      from: W,
      to: ALICE,
      value: parseEther("0.01"),
      fee: 21_000n * 10n,
    };
    const hist = fakeHistory({ head: 102, initial: parseEther("1"), events: [send] });
    const { sync, ledger } = setup(hist);
    await sync.sync(W, { fromBlock: 0 }); // finds it as external first time...
    expect(ledger.recent(W, 5)).toHaveLength(1);

    const fresh = setup(hist);
    fresh.ledger.recordOutgoingPending({
      hash: send.hash,
      wallet: W,
      to: ALICE,
      contactName: "alice",
      amountWei: send.value,
      timestamp: 1,
    });
    fresh.ledger.markSettled(send.hash, "confirmed", send.fee!, 50n);
    hist.calls = 0;
    const r = await fresh.sync.sync(W, { fromBlock: 0 });
    expect(r).toMatchObject({ incoming: 0, outgoingExternal: 0 });
    expect(hist.calls).toBe(5); // head + balance/nonce at both ends, no bisection
    expect(fresh.ledger.recent(W, 5)).toHaveLength(1);
  });

  it("records sends made outside the app, with their fee, and failed ones as failed", async () => {
    const events: Ev[] = [
      { block: 10, hash: h(), from: W, to: BOB, value: parseEther("0.02"), fee: 21_000n * 7n },
      {
        block: 20,
        hash: h(),
        from: W,
        to: BOB,
        value: parseEther("0.5"),
        fee: 21_000n * 7n,
        status: "reverted",
      },
    ];
    const hist = fakeHistory({ head: 32, initial: parseEther("1"), events });
    const { sync, ledger } = setup(hist);
    const r = await sync.sync(W, { fromBlock: 0 });
    expect(r.outgoingExternal).toBe(2);
    const [failed, sent] = ledger.recent(W, 5);
    expect(sent).toMatchObject({
      direction: "out",
      amountWei: parseEther("0.02"),
      feeWei: 147_000n,
      status: "confirmed",
    });
    expect(failed).toMatchObject({ status: "failed", feeWei: 147_000n });
  });

  it("ignores failed incoming transfers", async () => {
    const events: Ev[] = [
      { block: 9, hash: h(), from: ALICE, to: W, value: parseEther("1"), status: "reverted" },
    ];
    const hist = fakeHistory({ head: 20, initial: 0n, events });
    const { sync, ledger } = setup(hist);
    const r = await sync.sync(W, { fromBlock: 0 });
    expect(r.incoming).toBe(0);
    expect(ledger.recent(W, 5)).toHaveLength(0);
  });

  it("records ETH received through a contract call as an internal entry", async () => {
    const events: Ev[] = [
      {
        block: 77,
        hash: h(),
        from: OTHER,
        to: CONTRACT,
        value: 0n,
        internalToW: parseEther("0.3"),
      },
    ];
    const hist = fakeHistory({ head: 202, initial: 0n, events });
    const { sync, ledger } = setup(hist);
    const r = await sync.sync(W, { fromBlock: 0 });
    expect(r.internalIncoming).toBe(1);
    expect(ledger.recent(W, 5)[0]).toMatchObject({
      hash: "internal:77",
      direction: "in",
      amountWei: parseEther("0.3"),
      source: "internal",
    });
  });

  it("is idempotent: re-scanning the same range adds nothing", async () => {
    const events: Ev[] = [
      { block: 1_000, hash: h(), from: ALICE, to: W, value: parseEther("0.25") },
      { block: 2_000, hash: h(), from: OTHER, to: CONTRACT, value: 0n, internalToW: 5n },
    ];
    const hist = fakeHistory({ head: 10_002, initial: 0n, events });
    const { sync, ledger } = setup(hist);
    await sync.sync(W, { fromBlock: 0 });
    const again = await sync.sync(W, { fromBlock: 0 });
    expect(again).toMatchObject({ incoming: 0, internalIncoming: 0 });
    expect(ledger.recent(W, 10)).toHaveLength(2);
  });

  it("continues from the checkpoint and only scans new blocks", async () => {
    const events: Ev[] = [{ block: 500, hash: h(), from: ALICE, to: W, value: 3n }];
    const hist = fakeHistory({ head: 1_002, initial: 0n, events });
    const { sync, ledger } = setup(hist);
    await sync.sync(W); // init at 1000
    events.push({ block: 1_500, hash: h(), from: BOB, to: W, value: 7n });
    hist.head = 2_002;
    const r = await sync.sync(W);
    expect(r).toMatchObject({ fromBlock: 1_000, toBlock: 2_000, incoming: 1 });
    expect(ledger.recent(W, 5).map((e) => e.amountWei)).toEqual([7n]); // block 500 was before the start
  });

  it("settles our pending sends at the start of a sync", async () => {
    const send: Ev = { block: 15, hash: h(), from: W, to: ALICE, value: 10n, fee: 21_000n };
    const hist = fakeHistory({ head: 22, initial: parseEther("1"), events: [send] });
    const { sync, ledger } = setup(hist);
    ledger.recordOutgoingPending({
      hash: send.hash,
      wallet: W,
      to: ALICE,
      contactName: "alice",
      amountWei: 10n,
      timestamp: 1,
    });
    const r = await sync.sync(W, { fromBlock: 0 });
    expect(r).toMatchObject({ settledPending: 1, outgoingExternal: 0 });
    expect(ledger.recent(W, 5)[0]).toMatchObject({
      status: "confirmed",
      blockNumber: 15,
      feeWei: 21_000n,
    });
  });

  it("marks a send the network dropped as failed (after 30 min), keeps fresh ones pending", async () => {
    const hist = fakeHistory({ head: 22, initial: parseEther("1"), events: [] });
    const dropped = h();
    const fresh = h();
    const now = 10 * 60 * 60_000;
    const db = openDatabase(":memory:");
    const ledger = new LedgerStore(db);
    const sync = new LedgerSync({
      db,
      ledger,
      now: () => now,
      history: {
        ...hist,
        getReceipt: async () => null,
        isKnownTransaction: async () => false,
      },
    });
    for (const [hash, age] of [
      [dropped, 31 * 60_000],
      [fresh, 5 * 60_000],
    ] as const) {
      ledger.recordOutgoingPending({
        hash,
        wallet: W,
        to: ALICE,
        contactName: undefined,
        amountWei: 10n,
        timestamp: now - age,
      });
    }
    const r = await sync.sync(W, { fromBlock: 0 });
    expect(r.dropped).toBe(1);
    expect(ledger.getByHash(dropped)).toMatchObject({ status: "failed", fee_wei: "0" });
    expect(ledger.getByHash(fresh)).toMatchObject({ status: "pending" });
    // a dropped send no longer counts toward the daily limit
    expect(ledger.sumOutgoingSince(W, 0)).toBe(10n);
  });

  it("keeps a send between two tracked wallets as one row per wallet", async () => {
    const tx = h();
    const db = openDatabase(":memory:");
    const ledger = new LedgerStore(db);
    const base = {
      hash: tx,
      counterparty: ALICE,
      contactName: undefined,
      amountWei: 1n,
      feeWei: undefined,
      status: "confirmed" as const,
      blockNumber: 1,
      timestamp: 1,
      source: "sync" as const,
    };
    expect(ledger.insertSynced({ ...base, direction: "out", wallet: W })).toBe(true);
    expect(ledger.insertSynced({ ...base, direction: "in", wallet: ALICE })).toBe(true);
    expect(ledger.insertSynced({ ...base, direction: "in", wallet: ALICE })).toBe(false);
  });
});

describe("LedgerSync call budget", () => {
  it("stops at the budget, saves progress, and finishes over several syncs with the same result", async () => {
    const events: Ev[] = Array.from({ length: 6 }, (_, i) => ({
      block: 100 + i * 450,
      hash: h(),
      from: ALICE,
      to: W,
      value: BigInt(i + 1),
    }));
    const full = setup(fakeHistory({ head: 3_000, initial: 0n, events }));
    await full.sync.sync(W, { fromBlock: 0 });
    const parts = setup(fakeHistory({ head: 3_000, initial: 0n, events }));
    let r = await parts.sync.sync(W, { fromBlock: 0, maxRpcCalls: 24 });
    expect(r.partial).toBe(true);
    expect(r.rpcCalls).toBeLessThanOrEqual(24);
    let rounds = 1;
    while (r.partial && rounds < 200) {
      r = await parts.sync.sync(W, { maxRpcCalls: 24 });
      expect(r.rpcCalls).toBeLessThanOrEqual(24);
      rounds++;
    }
    expect(r.partial).toBe(false);
    expect(rounds).toBeGreaterThan(1);
    const amounts = (s: typeof full) =>
      s.ledger
        .recent(W, 50)
        .map((e) => e.amountWei)
        .sort();
    expect(amounts(parts)).toEqual(amounts(full));
    expect(amounts(parts)).toHaveLength(6);
  });
});

describe("LedgerSync interruptions", () => {
  it("saves progress as it goes and resumes after a failure without duplicates", async () => {
    const events: Ev[] = [
      { block: 100, hash: h(), from: ALICE, to: W, value: 1n },
      { block: 600, hash: h(), from: BOB, to: W, value: 2n },
      { block: 900, hash: h(), from: ALICE, to: W, value: 4n },
    ];
    const hist = fakeHistory({ head: 1_002, initial: 0n, events });
    const realGetBlock = hist.getBlock;
    let failOnce = true;
    hist.getBlock = async (b) => {
      if (b === 600 && failOnce) {
        failOnce = false;
        throw new Error("rate limited");
      }
      return realGetBlock(b);
    };
    const { sync, ledger } = setup(hist);
    await sync.sync(W); // checkpoint at 1000... rewind to scan history:
    await expect(sync.sync(W, { fromBlock: 0 })).rejects.toThrow(/rate limited/);

    const cp = sync.getCheckpoint(W)!;
    expect(cp.lastBlock).toBeGreaterThanOrEqual(100);
    expect(cp.lastBlock).toBeLessThan(600);
    expect(ledger.recent(W, 10).map((e) => e.amountWei)).toEqual([1n]);

    const r = await sync.sync(W);
    expect(r.incoming).toBe(2);
    expect(ledger.recent(W, 10).map((e) => e.amountWei)).toEqual([4n, 2n, 1n]);
    expect(sync.getCheckpoint(W)).toMatchObject({ lastBlock: 1_000, balance: 7n });
  });
});
