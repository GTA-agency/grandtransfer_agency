import { describe, expect, it } from "vitest";
import {
  TransferError,
  VaultError,
  type Confirmation,
  type TransferDraft,
  type TransferResult,
} from "@gta/core";
import { confirmAndSend, planBox } from "../src/send-flow.ts";
import { box, stars, visibleLength } from "../src/ui.ts";

const TO = "0x51b2000000000000000000000000000000000e09" as const;

function draft(over: Partial<TransferDraft> = {}): TransferDraft {
  return {
    id: "d1",
    from: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    to: TO,
    contactName: "robinhood",
    amountWei: 10_000_000_000_000_000n,
    gasLimit: 25_200n,
    maxFeePerGas: 1_000_000_000n,
    maxPriorityFeePerGas: 1n,
    estimatedFeeWei: 25_200_000_000_000n,
    totalWei: 10_025_200_000_000_000n,
    wantedLevel: 1,
    isNewRecipient: false,
    dailySentWei: 0n,
    createdAt: 0,
    expiresAt: 120_000,
    ...over,
  };
}

function harness(
  answers: string[],
  opts: {
    unlocked?: boolean;
    password?: string;
    result?: Partial<TransferResult>;
    executeError?: Error;
  } = {},
) {
  const lines: string[] = [];
  const asked: string[] = [];
  const executed: Confirmation[] = [];
  let unlocked = opts.unlocked ?? true;
  const deps = {
    out: { line: (t = "") => lines.push(t) },
    prompt: {
      ask: async (q: string) => {
        asked.push(q);
        const a = answers.shift();
        if (a === undefined) throw new Error(`unexpected prompt: ${q}`);
        return a;
      },
      askHidden: async (q: string) => {
        asked.push(q);
        const a = answers.shift();
        if (a === undefined) throw new Error(`unexpected prompt: ${q}`);
        return a;
      },
    },
    vault: {
      isUnlocked: () => unlocked,
      unlock: async (pw: string) => {
        if (pw !== (opts.password ?? "right-password"))
          throw new VaultError("WRONG_PASSWORD", "Wrong password.");
        unlocked = true;
        return "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as const;
      },
    },
    transfers: {
      execute: async (_id: string, c: Confirmation): Promise<TransferResult> => {
        executed.push(c);
        if (opts.executeError) throw opts.executeError;
        return {
          hash: "0xabc",
          status: "confirmed",
          explorerUrl: "https://robinhoodchain.blockscout.com/tx/0xabc",
          feeWei: 10_500_000_000_000n,
          blockNumber: 1n,
          ...opts.result,
        };
      },
    },
  };
  return { deps, lines, asked, executed, text: () => lines.join("\n") };
}

describe("confirmAndSend", () => {
  it("sends only after an explicit yes, and shows CLEAN GETAWAY", async () => {
    const h = harness(["yes"]);
    const r = await confirmAndSend(draft(), h.deps);
    expect(r.kind).toBe("sent");
    expect(h.executed).toEqual([{ confirmed: true }]);
    expect(h.text()).toContain("THE PLAN");
    expect(h.text()).toContain(TO);
    expect(h.text()).toContain("0.01 ETH");
    expect(h.text()).toContain("CLEAN GETAWAY");
    expect(h.text()).toContain("https://robinhoodchain.blockscout.com/tx/0xabc");
  });

  it.each(["", "y", "no", "YES please", "ok"])("aborts on %j without executing", async (answer) => {
    const h = harness([answer]);
    const r = await confirmAndSend(draft(), h.deps);
    expect(r.kind).toBe("aborted");
    expect(h.executed).toHaveLength(0);
    expect(h.text()).toContain("Nothing was sent");
  });

  it("accepts YES in any case", async () => {
    const h = harness([" Yes "]);
    expect((await confirmAndSend(draft(), h.deps)).kind).toBe("sent");
  });

  it("new recipients: warns loudly, then a plain yes sends (no address typing)", async () => {
    const h = harness(["yes"]);
    const r = await confirmAndSend(
      draft({ isNewRecipient: true, contactName: undefined, wantedLevel: 2 }),
      h.deps,
    );
    expect(r.kind).toBe("sent");
    expect(h.text()).toContain("NEW RECIPIENT");
    expect(h.asked).toHaveLength(1);
    expect(h.executed).toEqual([{ confirmed: true }]);
  });

  it("asks for the password when locked, with retries", async () => {
    const h = harness(["yes", "nope", "right-password"], { unlocked: false });
    const r = await confirmAndSend(draft(), h.deps);
    expect(r.kind).toBe("sent");
    expect(h.asked.filter((q) => q.includes("password"))).toHaveLength(2);
    expect(h.text()).toContain("Wrong password");
  });

  it("three wrong passwords → BUSTED, nothing sent", async () => {
    const h = harness(["yes", "a", "b", "c"], { unlocked: false });
    const r = await confirmAndSend(draft(), h.deps);
    expect(r.kind).toBe("busted");
    expect(h.executed).toHaveLength(0);
    expect(h.text()).toContain("BUSTED");
  });

  it("execute errors are shown as BUSTED with the reason", async () => {
    const h = harness(["yes"], {
      executeError: new TransferError("DRAFT_EXPIRED", "That plan expired. Prepare a new one."),
    });
    const r = await confirmAndSend(draft(), h.deps);
    expect(r).toEqual({ kind: "busted", reason: "That plan expired. Prepare a new one." });
    expect(h.text()).toContain("BUSTED");
  });

  it("a reverted transaction is BUSTED (gas spent, ETH didn't move)", async () => {
    const h = harness(["yes"], { result: { status: "failed" } });
    const r = await confirmAndSend(draft(), h.deps);
    expect(r.kind).toBe("busted");
    expect(h.text()).toMatch(/reverted/);
  });

  it("a pending transaction is reported honestly", async () => {
    const h = harness(["yes"], { result: { status: "pending", feeWei: undefined } });
    const r = await confirmAndSend(draft(), h.deps);
    expect(r.kind).toBe("sent");
    expect(h.text()).toContain("ON THE ROAD");
    expect(h.text()).toContain("still waiting");
  });
});

describe("ui", () => {
  it("draws boxes with aligned borders", () => {
    const b = box(["short", "a much longer line"], { title: "T" });
    const widths = new Set(b.map(visibleLength));
    expect(widths.size).toBe(1);
  });

  it("plan box fits an 80-column terminal, all borders aligned", () => {
    const lines = planBox(draft({ isNewRecipient: true }));
    const boxed = lines.slice(0, -1); // last line is the explorer link below the box
    expect(new Set(boxed.map(visibleLength)).size).toBe(1);
    expect(visibleLength(boxed[0]!)).toBeLessThanOrEqual(80);
    expect(lines.at(-1)).toContain("blockscout.com/address/");
  });

  it("success box fits an 80-column terminal, explorer link below it", async () => {
    const h = harness(["yes"], {
      result: {
        hash: `0x${"ab".repeat(32)}`,
        explorerUrl: `https://robinhoodchain.blockscout.com/tx/0x${"ab".repeat(32)}`,
      },
    });
    await confirmAndSend(draft(), h.deps);
    const start = h.lines.findIndex((l) => l.includes("CLEAN GETAWAY"));
    const boxed = h.lines.slice(start, -1);
    expect(new Set(boxed.map(visibleLength)).size).toBe(1);
    expect(visibleLength(boxed[0]!)).toBeLessThanOrEqual(80);
    expect(h.lines.at(-1)).toContain("blockscout.com/tx/");
  });

  it("stars show 5 slots", () => {
    expect(stars(2)).toBe("★★☆☆☆");
    expect(stars(9)).toBe("★★★★★");
  });
});
