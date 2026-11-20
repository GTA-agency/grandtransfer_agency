import { describe, expect, it } from "vitest";
import { parseEther } from "viem";
import {
  AddressBook,
  LedgerStore,
  TOOL_DEFINITIONS,
  TransferService,
  WalletAgent,
  WalletVault,
  openDatabase,
  parseAddress,
  type ChatMessage,
  type LlmClient,
  type LlmReply,
  type UsageRecord,
} from "../src/index.ts";
import {
  TEST_MNEMONIC_ADDRESS,
  TEST_PRIVATE_KEY,
  TEST_SCRYPT,
  fakeChain,
  tempDir,
} from "./helpers.ts";

const ROBINHOOD = parseAddress("0x8f3a5bc1d2e4f6789012345678901234567891c2");
const NEW_ADDR = parseAddress("0x51b2000000000000000000000000000000000e09");

type Step = (messages: ChatMessage[]) => LlmReply["message"];
const say =
  (content: string): Step =>
  () => ({ role: "assistant", content });
const call =
  (name: string, args: Record<string, unknown>): Step =>
  () => ({
    role: "assistant",
    content: null,
    tool_calls: [
      { id: `call_${name}`, type: "function", function: { name, arguments: JSON.stringify(args) } },
    ],
  });

class ScriptedLlm implements LlmClient {
  readonly seen: ChatMessage[][] = [];
  constructor(private readonly steps: Step[]) {}
  async chat(messages: ChatMessage[]): Promise<LlmReply> {
    this.seen.push(structuredClone(messages));
    const step = this.steps.shift();
    if (!step) throw new Error("script exhausted");
    return {
      message: step(messages),
      model: "test-model",
      usage: { promptTokens: 100, completionTokens: 10, costUsd: 0.001 },
    };
  }
}

/** Parse the tool result the agent handed back to the model in the latest tool message. */
function lastToolResult(messages: ChatMessage[]): Record<string, unknown> {
  const m = [...messages].reverse().find((x) => x.role === "tool");
  if (!m || m.role !== "tool") throw new Error("no tool message");
  return (JSON.parse(m.content) as { result: Record<string, unknown> }).result;
}

async function setup(steps: Step[]) {
  const vault = new WalletVault(tempDir(), { scrypt: TEST_SCRYPT });
  await vault.importPrivateKey(TEST_PRIVATE_KEY, "correct horse battery");
  const db = openDatabase(":memory:");
  const now = () => Date.UTC(2026, 10, 19, 12);
  const contacts = new AddressBook(db, now);
  contacts.add("robinhood", ROBINHOOD);
  contacts.add("robin", parseAddress("0x2d7c000000000000000000000000000000004e18"));
  const ledger = new LedgerStore(db);
  const chain = fakeChain();
  chain.balances.set(TEST_MNEMONIC_ADDRESS.toLowerCase(), parseEther("0.5"));
  const transfers = new TransferService({
    vault,
    contacts,
    ledger,
    chain,
    limits: { maxTxWei: parseEther("0.05"), maxDailyWei: parseEther("0.2") },
    now,
  });
  const llm = new ScriptedLlm(steps);
  const usage: UsageRecord[] = [];
  const agent = new WalletAgent({
    llm,
    model: "test-model",
    ctx: { vault, contacts, ledger, chain, transfers, now },
    usageLog: { record: (e) => usage.push(e) },
  });
  return { agent, llm, chain, contacts, usage, transfers };
}

describe("tool surface", () => {
  it("exposes no tool that can send or sign", () => {
    const names = TOOL_DEFINITIONS.map((t) => t.function.name);
    expect(names).toEqual([
      "get_my_address",
      "get_balance",
      "list_contacts",
      "get_contact_address",
      "add_contact",
      "prepare_transfer",
      "get_ledger_summary",
      "list_recent_transactions",
    ]);
    expect(names.some((n) => /send|execute|sign|confirm/i.test(n))).toBe(false);
  });
});

describe("WalletAgent", () => {
  it('"send 0.01 eth to robinhood" → a draft with exact wei, nothing sent', async () => {
    const t = await setup([
      call("prepare_transfer", { to: "robinhood", amount_eth: "0.01" }),
      (m) => {
        const r = lastToolResult(m);
        expect(r.status).toBe("awaiting_user_confirmation");
        expect(r.plan).toMatchObject({
          to_name: "robinhood",
          to_address: ROBINHOOD,
          amount_eth: "0.01",
          wanted_level: 1,
        });
        return {
          role: "assistant",
          content: "Plan ready: 0.01 ETH to robinhood. Review and confirm it.",
        };
      },
    ]);
    const res = await t.agent.send("send 0.01 eth to robinhood");
    expect(res.draft).toMatchObject({
      to: ROBINHOOD,
      amountWei: 10_000_000_000_000_000n,
      contactName: "robinhood",
    });
    expect(res.message).toMatch(/confirm/);
    expect(res.toolCalls).toEqual([{ name: "prepare_transfer", ok: true }]);
    expect(t.chain.sent).toHaveLength(0);
  });

  it('"show my robinhood address" → the address from contacts', async () => {
    const t = await setup([
      call("get_contact_address", { name: "robinhood" }),
      (m) => {
        expect(lastToolResult(m)).toEqual({ name: "robinhood", address: ROBINHOOD });
        return { role: "assistant", content: `Your robinhood address is ${ROBINHOOD}.` };
      },
    ]);
    const res = await t.agent.send("show my robinhood address");
    expect(res.message).toContain(ROBINHOOD);
    expect(res.draft).toBeUndefined();
  });

  it("ambiguous recipient → the model gets suggestions and asks, no draft", async () => {
    const t = await setup([
      call("prepare_transfer", { to: "robinhod", amount_eth: "0.01" }),
      (m) => {
        const r = lastToolResult(m);
        expect(r.error).toBe("AMBIGUOUS_RECIPIENT");
        expect((r.did_you_mean as string[]).sort()).toEqual(["robin", "robinhood"]);
        return { role: "assistant", content: "Did you mean robinhood or robin?" };
      },
    ]);
    const res = await t.agent.send("send 0.01 to robinhod");
    expect(res.draft).toBeUndefined();
    expect(res.message).toMatch(/\?$/);
    expect(res.toolCalls).toEqual([{ name: "prepare_transfer", ok: false }]);
  });

  it("vague request → a clarifying question without calling tools", async () => {
    const t = await setup([say("How much ETH do you want to send to robinhood?")]);
    const res = await t.agent.send("send some eth to robinhood");
    expect(res.toolCalls).toEqual([]);
    expect(res.draft).toBeUndefined();
  });

  it("limit errors come back to the model in ETH, not wei", async () => {
    const t = await setup([
      call("prepare_transfer", { to: "robinhood", amount_eth: "0.2" }),
      (m) => {
        expect(lastToolResult(m)).toMatchObject({ error: "OVER_TX_LIMIT", max_tx_eth: "0.05" });
        return { role: "assistant", content: "That's over your 0.05 ETH per-transaction limit." };
      },
    ]);
    const res = await t.agent.send("send 0.2 eth to robinhood");
    expect(res.draft).toBeUndefined();
  });

  it("add_contact only proposes; nothing is saved until the user confirms", async () => {
    const t = await setup([
      call("add_contact", { name: "kevin", address: NEW_ADDR.toLowerCase() }),
      say("I can save kevin. Please confirm on screen."),
    ]);
    const res = await t.agent.send(`save kevin as ${NEW_ADDR}`);
    expect(res.contactProposal).toMatchObject({ name: "kevin", address: NEW_ADDR });
    expect(t.contacts.get("kevin")).toBeUndefined();

    t.agent.confirmContact(res.contactProposal!.id);
    expect(t.contacts.get("kevin")?.address).toBe(NEW_ADDR);
    expect(() => t.agent.confirmContact(res.contactProposal!.id)).toThrow(/expired/);
  });

  it("bad tool arguments and unknown tools don't crash the turn", async () => {
    const t = await setup([
      () => ({
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "a", type: "function", function: { name: "send_eth", arguments: "{}" } },
          {
            id: "b",
            type: "function",
            function: { name: "prepare_transfer", arguments: "{not json" },
          },
          {
            id: "c",
            type: "function",
            function: { name: "prepare_transfer", arguments: '{"to":"robinhood"}' },
          },
        ],
      }),
      say("Sorry, which amount?"),
    ]);
    const res = await t.agent.send("send to robinhood");
    expect(res.toolCalls).toEqual([
      { name: "send_eth", ok: false },
      { name: "prepare_transfer", ok: false },
      { name: "prepare_transfer", ok: false },
    ]);
    expect(t.chain.sent).toHaveLength(0);
  });

  it("stops after maxSteps tool rounds", async () => {
    const loop = call("get_balance", {});
    const t = await setup(Array.from({ length: 6 }, () => loop));
    const res = await t.agent.send("balance?");
    expect(res.message).toMatch(/couldn't finish/);
    expect(res.usage.calls).toBe(6);
  });

  it("sums and logs token usage for every model call", async () => {
    const t = await setup([call("get_balance", {}), say("You have 0.5 ETH.")]);
    const res = await t.agent.send("what's my balance");
    expect(res.usage).toMatchObject({ calls: 2, promptTokens: 200, completionTokens: 20 });
    expect(res.usage.costUsd).toBeCloseTo(0.002);
    expect(t.usage).toHaveLength(2);
    expect(t.usage[0]).toMatchObject({ model: "test-model", promptTokens: 100 });
  });

  it("remembers prior user/assistant text but not raw tool output", async () => {
    const t = await setup([
      call("get_balance", {}),
      say("You have 0.5 ETH."),
      (m) => {
        const roles = m.map((x) => x.role);
        expect(roles).toEqual(["system", "user", "assistant", "user"]);
        return { role: "assistant", content: "Yes, 0.5 ETH." };
      },
    ]);
    await t.agent.send("balance?");
    await t.agent.send("really?");
  });

  it("passes tool results as data inside a JSON envelope", async () => {
    const t = await setup([call("list_contacts", {}), say("You have 2 contacts.")]);
    await t.agent.send("list my contacts");
    const toolMsg = t.llm.seen[1]!.find((m) => m.role === "tool");
    expect(toolMsg && JSON.parse((toolMsg as { content: string }).content)).toMatchObject({
      tool: "list_contacts",
      result: { contacts: expect.any(Array) },
    });
  });

  it("rejects empty and oversized input without calling the model", async () => {
    const t = await setup([]);
    expect((await t.agent.send("   ")).usage.calls).toBe(0);
    expect((await t.agent.send("x".repeat(2001))).message).toMatch(/too long/);
  });
});
