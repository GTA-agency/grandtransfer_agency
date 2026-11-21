import { describe, expect, it, vi } from "vitest";
import { parseUnits, type Hash } from "viem";
import {
  AddressBook,
  AiQuota,
  Books,
  LedgerStore,
  LedgerSync,
  QuotaError,
  RoutedLlmClient,
  ledgerTxHash,
  openDatabase,
  parseAddress,
  pickModelTier,
  type ChainHistory,
  type HistoryTokenLog,
  type LlmClient,
  type LlmReply,
  type ToolDefinition,
} from "../src/index.ts";

const ME = parseAddress("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
const ALEX = parseAddress("0x8f3a5bc1d2e4f6789012345678901234567891c2");
const gta = (n: string) => parseUnits(n, 18);
const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hash;
const log = (
  block: number,
  value: bigint,
  over: Partial<HistoryTokenLog> = {},
): HistoryTokenLog => ({
  hash: tx(block),
  logIndex: 1,
  blockNumber: block,
  from: ALEX,
  value,
  ...over,
});

function setup(logs: HistoryTokenLog[]) {
  const db = openDatabase(":memory:");
  const ledger = new LedgerStore(db);
  const contacts = new AddressBook(db);
  const state = {
    head: 1002,
    logs,
    /** Blocks where this wallet sent tokens away: [block, amount]. */
    sells: [] as [number, bigint][],
    logQueries: [] as number[],
    fail: false,
  };
  const balanceAt = (block: number) =>
    state.logs
      .filter((l) => l.blockNumber <= block && l.from !== ME)
      .reduce((sum, l) => sum + l.value, 0n) -
    state.sells.filter(([b]) => b <= block).reduce((sum, [, v]) => sum + v, 0n);
  const history: ChainHistory = {
    getHeadBlock: async () => state.head,
    getBalanceAt: async () => 1n,
    getNonceAt: async (_a, block) => state.sells.filter(([b]) => b <= block).length,
    getBlock: async () => ({ timestamp: 1, txs: [] }),
    getReceipt: async () => null,
    isKnownTransaction: async () => false,
    getTokenBalanceAt: async (_t, _o, block) => {
      if (state.fail) throw new Error("node down");
      return balanceAt(block);
    },
    getTokenTransfersTo: async (_t, _to, a, b) => {
      state.logQueries.push(b - a + 1);
      if (b - a + 1 > 100) throw new Error("ranges over 100 blocks are not supported");
      return state.logs.filter((l) => l.blockNumber >= a && l.blockNumber <= b);
    },
    getBlockTimestamp: async (b) => 1_800_000_000 + b,
  };
  const sync = new LedgerSync({ db, ledger, contacts, history, now: () => 1_800_000_000_000 });
  return { db, ledger, contacts, state, sync };
}

describe("incoming $GTA", () => {
  it("starts at the head on the first sync, so old history isn't replayed", async () => {
    const c = setup([log(900, gta("5"))]);
    const r = await c.sync.sync(ME);
    expect(r.tokenIncoming).toBe(0);
    expect(c.ledger.recent(ME, 10)).toHaveLength(0);
  });

  it("records an arrival with its token, without touching ETH totals", async () => {
    const c = setup([]);
    c.contacts.add("alex", ALEX);
    await c.sync.sync(ME);
    c.state.logs = [log(1010, gta("1000"))];
    c.state.head = 1102;
    const r = await c.sync.sync(ME);
    expect(r.tokenIncoming).toBe(1);
    const e = c.ledger.recent(ME, 1)[0]!;
    expect(e).toMatchObject({ direction: "in", contactName: "alex", amountWei: 0n });
    expect(e.token).toMatchObject({ symbol: "GTA", amountUnits: gta("1000") });
    expect(e.timestamp).toBe((1_800_000_000 + 1010) * 1000);
    expect(ledgerTxHash(e.hash)).toBe(tx(1010));
    expect(c.ledger.summary(ME, 0).inWei).toBe(0n);
    const csv = new Books(c.db, c.ledger).exportCsv(ME, { from: 0, to: 9e15 });
    expect(csv).toContain(`"https://robinhoodchain.blockscout.com/tx/${tx(1010)}","GTA","1000"`);
  });

  it("finds one transfer in a huge gap with few calls, never asking for over 100 blocks", async () => {
    const c = setup([]);
    await c.sync.sync(ME);
    c.state.logs = [log(712_345, gta("7"))];
    c.state.head = 1_001_002;
    const r = await c.sync.sync(ME);
    expect(r.tokenIncoming).toBe(1);
    expect(c.state.logQueries).toHaveLength(1);
    expect(c.state.logQueries[0]).toBeLessThanOrEqual(100);
    expect(r.rpcCalls).toBeLessThan(40);
  });

  it("reads no logs at all when nothing changed", async () => {
    const c = setup([]);
    await c.sync.sync(ME);
    c.state.head = 500_000;
    await c.sync.sync(ME);
    expect(c.state.logQueries).toHaveLength(0);
  });

  it("still sees a buy and a full sell between two syncs", async () => {
    const c = setup([]);
    await c.sync.sync(ME);
    c.state.logs = [log(40_000, gta("5"))];
    c.state.sells = [[60_000, gta("5")]];
    c.state.head = 90_000;
    expect((await c.sync.sync(ME)).tokenIncoming).toBe(1);
  });

  it("ignores zero-value spam and the wallet's own transfers", async () => {
    const c = setup([]);
    await c.sync.sync(ME);
    c.state.logs = [
      log(1010, 0n),
      log(1011, gta("1"), { from: ME }),
      log(1012, gta("2"), { logIndex: 3 }),
    ];
    c.state.head = 1102;
    expect((await c.sync.sync(ME)).tokenIncoming).toBe(1);
    expect(c.ledger.recent(ME, 10)[0]!.token?.amountUnits).toBe(gta("2"));
  });

  it("keeps two transfers in one transaction, and never counts one twice", async () => {
    const c = setup([]);
    await c.sync.sync(ME);
    c.state.logs = [log(1010, gta("1")), log(1010, gta("2"), { logIndex: 2 })];
    c.state.head = 1102;
    expect((await c.sync.sync(ME)).tokenIncoming).toBe(2);
    c.db.prepare("UPDATE token_sync SET last_block = 1000, balance_units = '0'").run();
    expect((await c.sync.sync(ME)).tokenIncoming).toBe(0);
    expect(c.ledger.recent(ME, 10)).toHaveLength(2);
  });

  it("a failing node doesn't break the sync or skip blocks", async () => {
    const c = setup([]);
    await c.sync.sync(ME);
    c.state.logs = [log(1010, gta("3"))];
    c.state.head = 1102;
    c.state.fail = true;
    await expect(c.sync.sync(ME)).resolves.toMatchObject({ tokenIncoming: 0 });
    c.state.fail = false;
    expect((await c.sync.sync(ME)).tokenIncoming).toBe(1);
  });

  it("stops at the call budget and continues next time", async () => {
    const c = setup([]);
    await c.sync.sync(ME);
    c.state.logs = [log(800_000, gta("9"))];
    c.state.head = 1_000_002;
    const first = await c.sync.sync(ME, { maxRpcCalls: 30 });
    expect(first.partial).toBe(true);
    expect(first.rpcCalls).toBeLessThanOrEqual(30);
    let found = first.tokenIncoming;
    for (let i = 0; i < 30 && found === 0; i++) {
      found += (await c.sync.sync(ME, { maxRpcCalls: 30 })).tokenIncoming;
    }
    expect(found).toBe(1);
  });
});

describe("holder allowance", () => {
  it("uses the limit it's given", () => {
    const q = new AiQuota(openDatabase(":memory:"), {
      messagesPerWalletPerDay: 1,
      dailyBudgetUsd: 0,
    });
    q.record(ME, 0);
    expect(() => q.check(ME)).toThrow(QuotaError);
    expect(() => q.check(ME, 60)).not.toThrow();
    expect(q.usedToday(ME, 60)).toEqual({ messages: 1, limit: 60 });
  });
});

describe("model routing", () => {
  it("only plain read questions go to the cheaper model", () => {
    for (const t of [
      "What's my balance?",
      "cek saldo",
      "Show my robinhood address",
      "Recap this month",
      "Show my $GTA balance",
    ]) {
      expect(pickModelTier(t)).toBe("light");
    }
    for (const t of [
      "send 0.01 eth to robinhood",
      "kirim 1 eth ke alex",
      "balance then send it all to alex",
      "my balance is 2 eth right?",
      "is 0xabc the real $GTA?",
      "request 0.01 ETH",
      "save this address as mom",
      "yes",
      "ok",
      "hello",
      `balance ${"x".repeat(90)}`,
    ]) {
      expect(pickModelTier(t)).toBe("main");
    }
  });

  const tool = (name: string): ToolDefinition => ({
    type: "function",
    function: { name, description: "", parameters: {} },
  });
  const tools = [tool("get_balance"), tool("prepare_transfer"), tool("create_payment_link")];
  const reply = (model: string, call?: string): LlmReply => ({
    model,
    usage: { promptTokens: 1, completionTokens: 1, costUsd: 0 },
    message: {
      role: "assistant",
      content: call ? null : "ok",
      ...(call
        ? {
            tool_calls: [
              { id: "1", type: "function" as const, function: { name: call, arguments: "{}" } },
            ],
          }
        : {}),
    },
  });
  const client = (r: () => Promise<LlmReply>) => ({ chat: vi.fn<LlmClient["chat"]>(r) });
  const ask = [{ role: "user" as const, content: "what's my balance?" }];

  it("never offers the cheaper model a tool that makes a plan", async () => {
    const main = client(async () => reply("main"));
    const light = client(async () => reply("light", "get_balance"));
    const r = await new RoutedLlmClient(main, light).chat(ask, tools);
    expect(r.model).toBe("light");
    expect(light.chat.mock.calls[0]![1].map((t) => t.function.name)).toEqual(["get_balance"]);
    expect(main.chat).not.toHaveBeenCalled();
  });

  it("drops a made-up call to a plan tool and asks the main model", async () => {
    const main = client(async () => reply("main"));
    const light = client(async () => reply("light", "prepare_transfer"));
    expect((await new RoutedLlmClient(main, light).chat(ask, tools)).model).toBe("main");
  });

  it("falls back when the cheaper model fails, and sends actions straight to main", async () => {
    const main = client(async () => reply("main"));
    const light = client(async () => {
      throw new Error("down");
    });
    const router = new RoutedLlmClient(main, light);
    expect((await router.chat(ask, tools)).model).toBe("main");
    light.chat.mockClear();
    await router.chat([{ role: "user", content: "send 1 eth to alex" }], tools);
    expect(light.chat).not.toHaveBeenCalled();
    expect(main.chat.mock.lastCall![1]).toHaveLength(3);
  });
});
