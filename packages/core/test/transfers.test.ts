import { beforeEach, describe, expect, it } from "vitest";
import { parseEther, type Address } from "viem";
import {
  AddressBook,
  LedgerStore,
  TransferError,
  TransferService,
  WalletVault,
  openDatabase,
  parseAddress,
  wantedLevel,
} from "../src/index.ts";
import {
  TEST_MNEMONIC_ADDRESS,
  TEST_PRIVATE_KEY,
  TEST_SCRYPT,
  fakeChain,
  tempDir,
  type FakeChain,
} from "./helpers.ts";

const PASSWORD = "correct horse battery";
const ROBINHOOD = parseAddress("0x8f3a5bc1d2e4f6789012345678901234567891c2");
const STRANGER = parseAddress("0x51b2000000000000000000000000000000000e09");

interface Ctx {
  vault: WalletVault;
  contacts: AddressBook;
  ledger: LedgerStore;
  chain: FakeChain;
  clock: { t: number };
  svc: TransferService;
}

async function setup(opts: { unlocked?: boolean } = {}): Promise<Ctx> {
  const vault = new WalletVault(tempDir(), { scrypt: TEST_SCRYPT });
  await vault.importPrivateKey(TEST_PRIVATE_KEY, PASSWORD);
  if (opts.unlocked !== false) await vault.unlock(PASSWORD);
  const db = openDatabase(":memory:");
  const clock = { t: Date.UTC(2026, 10, 19, 12) };
  const contacts = new AddressBook(db, () => clock.t);
  contacts.add("robinhood", ROBINHOOD);
  const ledger = new LedgerStore(db);
  const chain = fakeChain();
  chain.balances.set(TEST_MNEMONIC_ADDRESS.toLowerCase(), parseEther("1"));
  const svc = new TransferService({
    vault,
    contacts,
    ledger,
    chain,
    limits: { maxTxWei: parseEther("0.05"), maxDailyWei: parseEther("0.2") },
    now: () => clock.t,
  });
  return { vault, contacts, ledger, chain, clock, svc };
}

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toBeInstanceOf(TransferError);
  await expect(p).rejects.toMatchObject({ code });
}

describe("wantedLevel", () => {
  const max = parseEther("0.05");
  it.each([
    ["0.001", false, 1],
    ["0.01", false, 1],
    ["0.02", false, 2],
    ["0.03", false, 3],
    ["0.04", false, 4],
    ["0.05", false, 5],
    ["0.01", true, 2],
    ["0.05", true, 5],
  ])("%s ETH (new recipient: %s) → %i stars", (eth, isNew, stars) => {
    expect(wantedLevel(parseEther(eth), max, isNew)).toBe(stars);
  });
});

describe("TransferService.prepare", () => {
  let c: Ctx;
  beforeEach(async () => {
    c = await setup();
  });

  it("builds a draft for a known contact with exact wei and gas headroom", async () => {
    const d = await c.svc.prepare({ to: "robinhood", amountEth: "0.01" });
    expect(d).toMatchObject({
      from: TEST_MNEMONIC_ADDRESS,
      to: ROBINHOOD,
      contactName: "robinhood",
      amountWei: 10_000_000_000_000_000n,
      gasLimit: 25_200n, // 21000 + 20%
      isNewRecipient: false,
      wantedLevel: 1,
    });
    expect(d.estimatedFeeWei).toBe(25_200n * 1_000_000_000n);
    expect(d.totalWei).toBe(d.amountWei + d.estimatedFeeWei);
    expect(d.expiresAt - d.createdAt).toBe(120_000);
    expect(c.chain.sent).toHaveLength(0); // nothing is sent when preparing
  });

  it("works without unlocking (prepare never touches the private key)", async () => {
    const locked = await setup({ unlocked: false });
    await expect(locked.svc.prepare({ to: "robinhood", amountEth: "0.01" })).resolves.toBeDefined();
  });

  it("flags unknown raw addresses as new recipients (warning + one more star)", async () => {
    const d = await c.svc.prepare({ to: STRANGER, amountEth: "0.01" });
    expect(d.isNewRecipient).toBe(true);
    expect(d.wantedLevel).toBe(2);
  });

  it("rejects bad amounts", async () => {
    for (const amountEth of ["0", "-1", "abc", "1e-2", "all"]) {
      await expectCode(c.svc.prepare({ to: "robinhood", amountEth }), "INVALID_AMOUNT");
    }
  });

  it("rejects unknown, ambiguous and invalid recipients", async () => {
    await expectCode(c.svc.prepare({ to: "kevin", amountEth: "0.01" }), "UNKNOWN_RECIPIENT");
    await expectCode(c.svc.prepare({ to: "robinhod", amountEth: "0.01" }), "AMBIGUOUS_RECIPIENT");
    await expectCode(c.svc.prepare({ to: "0x1234", amountEth: "0.01" }), "INVALID_ADDRESS");
  });

  it("rejects sending to yourself", async () => {
    await expectCode(
      c.svc.prepare({ to: TEST_MNEMONIC_ADDRESS, amountEth: "0.01" }),
      "SELF_TRANSFER",
    );
  });

  it("enforces the per-transaction limit", async () => {
    await expectCode(
      c.svc.prepare({ to: "robinhood", amountEth: "0.050000000000000001" }),
      "OVER_TX_LIMIT",
    );
    await expect(c.svc.prepare({ to: "robinhood", amountEth: "0.05" })).resolves.toBeDefined();
  });

  it("enforces the rolling 24h limit, ignoring failed and old sends", async () => {
    const w = TEST_MNEMONIC_ADDRESS as Address;
    const rec = (n: number, eth: string, ageMs: number, status?: "failed") => {
      const hash = `0x${n.toString(16).padStart(64, "a")}` as const;
      c.ledger.recordOutgoingPending({
        hash,
        wallet: w,
        to: ROBINHOOD,
        contactName: "robinhood",
        amountWei: parseEther(eth),
        timestamp: c.clock.t - ageMs,
      });
      if (status) c.ledger.markSettled(hash, "failed", 0n, 1n);
    };
    rec(1, "0.05", 60_000);
    rec(2, "0.05", 3_600_000);
    rec(3, "0.05", 23 * 3_600_000);
    rec(4, "0.05", 25 * 3_600_000); // older than 24h: doesn't count
    rec(5, "0.05", 60_000, "failed"); // failed: doesn't count
    // 0.15 counted; 0.05 more = 0.2 OK, a wei more is over
    await expect(c.svc.prepare({ to: "robinhood", amountEth: "0.05" })).resolves.toMatchObject({
      dailySentWei: parseEther("0.15"),
    });
    rec(6, "0.000000000000000001", 1000);
    await expectCode(c.svc.prepare({ to: "robinhood", amountEth: "0.05" }), "OVER_DAILY_LIMIT");
  });

  it("requires enough balance for amount plus gas", async () => {
    c.chain.balances.set(TEST_MNEMONIC_ADDRESS.toLowerCase(), parseEther("0.01"));
    await expectCode(c.svc.prepare({ to: "robinhood", amountEth: "0.01" }), "INSUFFICIENT_BALANCE");
  });

  it("refuses to work on any other chain", async () => {
    c.chain.chainId = 1;
    await expectCode(c.svc.prepare({ to: "robinhood", amountEth: "0.01" }), "WRONG_CHAIN");
  });

  it("reports NO_WALLET when there is no wallet", async () => {
    const svc = new TransferService({
      vault: new WalletVault(tempDir(), { scrypt: TEST_SCRYPT }),
      contacts: c.contacts,
      ledger: c.ledger,
      chain: c.chain,
      limits: { maxTxWei: parseEther("0.05"), maxDailyWei: parseEther("0.2") },
    });
    await expectCode(svc.prepare({ to: "robinhood", amountEth: "0.01" }), "NO_WALLET");
  });
});

describe("TransferService.execute", () => {
  let c: Ctx;
  beforeEach(async () => {
    c = await setup();
  });

  it("sends a confirmed draft and records it in the ledger", async () => {
    const d = await c.svc.prepare({ to: "robinhood", amountEth: "0.01" });
    const r = await c.svc.execute(d.id, { confirmed: true });
    expect(r.status).toBe("confirmed");
    expect(r.feeWei).toBe(21_000n * 500_000_000n);
    expect(r.explorerUrl).toBe(`https://robinhoodchain.blockscout.com/tx/${r.hash}`);
    expect(c.chain.sent).toEqual([
      { from: TEST_MNEMONIC_ADDRESS, to: ROBINHOOD, value: parseEther("0.01"), gas: 25_200n },
    ]);
    expect(c.ledger.getByHash(r.hash)).toMatchObject({
      status: "confirmed",
      amount_wei: "10000000000000000",
    });
  });

  it("requires confirmed === true", async () => {
    const d = await c.svc.prepare({ to: "robinhood", amountEth: "0.01" });
    await expectCode(c.svc.execute(d.id, { confirmed: false }), "NOT_CONFIRMED");
    await expectCode(
      c.svc.execute(d.id, { confirmed: "yes" as unknown as boolean }),
      "NOT_CONFIRMED",
    );
    expect(c.chain.sent).toHaveLength(0);
  });

  it("drafts are single use", async () => {
    const d = await c.svc.prepare({ to: "robinhood", amountEth: "0.01" });
    await c.svc.execute(d.id, { confirmed: true });
    await expectCode(c.svc.execute(d.id, { confirmed: true }), "DRAFT_USED");
    expect(c.chain.sent).toHaveLength(1);
  });

  it("drafts expire after 2 minutes", async () => {
    const d = await c.svc.prepare({ to: "robinhood", amountEth: "0.01" });
    c.clock.t += 120_001;
    await expectCode(c.svc.execute(d.id, { confirmed: true }), "DRAFT_EXPIRED");
  });

  it("unknown draft ids are rejected", async () => {
    await expectCode(c.svc.execute("deadbeef", { confirmed: true }), "DRAFT_NOT_FOUND");
  });

  it("new recipients go through with a plain confirmation (no address typing)", async () => {
    const d = await c.svc.prepare({ to: STRANGER, amountEth: "0.01" });
    await expectCode(c.svc.execute(d.id, { confirmed: false }), "NOT_CONFIRMED");
    const r = await c.svc.execute(d.id, { confirmed: true });
    expect(r.status).toBe("confirmed");
    expect(c.chain.sent).toHaveLength(1);
  });

  it("refuses when the wallet is locked", async () => {
    const d = await c.svc.prepare({ to: "robinhood", amountEth: "0.01" });
    c.vault.lock();
    await expectCode(c.svc.execute(d.id, { confirmed: true }), "WALLET_LOCKED");
    expect(c.chain.sent).toHaveLength(0);
  });

  it("re-checks the chain, limits and balance right before sending", async () => {
    const d1 = await c.svc.prepare({ to: "robinhood", amountEth: "0.01" });
    c.chain.chainId = 10;
    await expectCode(c.svc.execute(d1.id, { confirmed: true }), "WRONG_CHAIN");

    c.chain.chainId = 4663;
    const d2 = await c.svc.prepare({ to: "robinhood", amountEth: "0.01" });
    c.chain.balances.set(TEST_MNEMONIC_ADDRESS.toLowerCase(), 0n);
    await expectCode(c.svc.execute(d2.id, { confirmed: true }), "INSUFFICIENT_BALANCE");

    // Two plans that each fit the daily limit alone, but not together.
    c.chain.balances.set(TEST_MNEMONIC_ADDRESS.toLowerCase(), parseEther("1"));
    const plans = [];
    for (let i = 0; i < 5; i++)
      plans.push(await c.svc.prepare({ to: "robinhood", amountEth: "0.05" }));
    for (const p of plans.slice(0, 4)) await c.svc.execute(p.id, { confirmed: true });
    await expectCode(c.svc.execute(plans[4]!.id, { confirmed: true }), "OVER_DAILY_LIMIT");
    expect(c.chain.sent).toHaveLength(4);
  });

  it("marks reverted transactions as failed so they don't count toward limits", async () => {
    c.chain.receiptStatus = "reverted";
    const d = await c.svc.prepare({ to: "robinhood", amountEth: "0.05" });
    const r = await c.svc.execute(d.id, { confirmed: true });
    expect(r.status).toBe("failed");
    expect(c.ledger.getByHash(r.hash)?.status).toBe("failed");
    expect(c.ledger.sumOutgoingSince(TEST_MNEMONIC_ADDRESS, 0)).toBe(0n);
  });

  it("keeps a sent transaction as pending (and counted) when the receipt times out", async () => {
    c.chain.receiptStatus = "timeout";
    const d = await c.svc.prepare({ to: "robinhood", amountEth: "0.05" });
    const r = await c.svc.execute(d.id, { confirmed: true });
    expect(r.status).toBe("pending");
    expect(c.ledger.sumOutgoingSince(TEST_MNEMONIC_ADDRESS, 0)).toBe(parseEther("0.05"));
  });
});

describe("TransferService.prepare against a real-world node", () => {
  it("checks the balance before estimating gas (nodes reject estimates the wallet can't cover)", async () => {
    const c = await setup();
    let estimated = false;
    c.chain.estimateGas = async () => {
      estimated = true;
      throw new Error("insufficient funds for transfer");
    };
    c.chain.balances.set(TEST_MNEMONIC_ADDRESS.toLowerCase(), 0n);
    await expectCode(c.svc.prepare({ to: "robinhood", amountEth: "0.01" }), "INSUFFICIENT_BALANCE");
    expect(estimated).toBe(false);
  });

  it("turns a failed gas estimate into a clear, coded error", async () => {
    const c = await setup();
    c.chain.estimateGas = async () => {
      throw new Error("HTTP request failed.");
    };
    await expectCode(c.svc.prepare({ to: "robinhood", amountEth: "0.01" }), "GAS_ESTIMATE_FAILED");
  });
});

describe("TransferService with an external wallet (MetaMask)", () => {
  const METAMASK = parseAddress("0x00000000000000000000000000000000000a11ce");
  const HASH = `0x${"7".repeat(64)}` as const;

  async function external() {
    const c = await setup({ unlocked: false });
    c.chain.balances.set(METAMASK.toLowerCase(), parseEther("1"));
    const svc = new TransferService({
      vault: c.vault,
      wallet: { address: METAMASK },
      contacts: c.contacts,
      ledger: c.ledger,
      chain: c.chain,
      limits: { maxTxWei: parseEther("0.05"), maxDailyWei: parseEther("0.2") },
      now: () => c.clock.t,
    });
    return { ...c, svc };
  }

  it("plans for the active wallet, not the vault", async () => {
    const c = await external();
    const d = await c.svc.prepare({ to: "robinhood", amountEth: "0.01" });
    expect(d.from).toBe(METAMASK);
  });

  it("authorize → sign elsewhere → record: verified on chain, logged, settled", async () => {
    const c = await external();
    const d = await c.svc.prepare({ to: "robinhood", amountEth: "0.01" });
    const req = await c.svc.authorizeExternal(d.id, { confirmed: true });
    expect(req).toMatchObject({ chainId: 4663, from: METAMASK, to: ROBINHOOD, value: d.amountWei });
    c.chain.known.set(HASH, { from: METAMASK, to: ROBINHOOD, value: d.amountWei, chainId: 4663 });
    const r = await c.svc.recordExternal(d.id, HASH);
    expect(r.status).toBe("confirmed");
    expect(c.ledger.getByHash(HASH)).toMatchObject({
      status: "confirmed",
      amount_wei: d.amountWei.toString(),
    });
    expect(c.chain.sent).toHaveLength(0); // the server never signed anything
    await expectCode(c.svc.recordExternal(d.id, HASH), "NOT_AUTHORIZED");
  });

  it("needs the same confirmation as an internal send", async () => {
    const c = await external();
    const d = await c.svc.prepare({ to: STRANGER, amountEth: "0.01" });
    await expectCode(c.svc.authorizeExternal(d.id, { confirmed: false }), "NOT_CONFIRMED");
    await c.svc.authorizeExternal(d.id, { confirmed: true });
    await expectCode(c.svc.authorizeExternal(d.id, { confirmed: true }), "DRAFT_USED");
  });

  it("refuses to record a hash that wasn't authorized or doesn't match the plan", async () => {
    const c = await external();
    const d = await c.svc.prepare({ to: "robinhood", amountEth: "0.01" });
    await expectCode(c.svc.recordExternal(d.id, HASH), "NOT_AUTHORIZED");
    await c.svc.authorizeExternal(d.id, { confirmed: true });
    await expectCode(c.svc.recordExternal(d.id, HASH), "TX_NOT_FOUND");
    c.chain.known.set(HASH, { from: METAMASK, to: STRANGER, value: d.amountWei, chainId: 4663 });
    await expectCode(c.svc.recordExternal(d.id, HASH), "TX_MISMATCH");
    expect(c.ledger.getByHash(HASH)).toBeUndefined();
  });

  it("without an internal wallet (web app) plans work but the server can never sign", async () => {
    const c = await external();
    const svc = new TransferService({
      wallet: { address: METAMASK },
      contacts: c.contacts,
      ledger: c.ledger,
      chain: c.chain,
      limits: { maxTxWei: parseEther("0.05"), maxDailyWei: parseEther("0.2") },
      now: () => c.clock.t,
    });
    const d = await svc.prepare({ to: "robinhood", amountEth: "0.01" });
    await expectCode(svc.execute(d.id, { confirmed: true }), "NO_WALLET");
    expect(c.chain.sent).toHaveLength(0);
  });

  it("an internal execute can't be used on a MetaMask plan", async () => {
    const c = await external();
    await c.vault.unlock(PASSWORD);
    const d = await c.svc.prepare({ to: "robinhood", amountEth: "0.01" });
    await expectCode(c.svc.execute(d.id, { confirmed: true }), "DRAFT_NOT_FOUND");
  });
});
