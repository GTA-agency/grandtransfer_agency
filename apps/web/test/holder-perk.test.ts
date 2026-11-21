import { afterEach, describe, expect, it, vi } from "vitest";
import { parseUnits, type Address } from "viem";
import { loadConfig, openDatabase, type TokenOps } from "@gta/core";
import { ServerState } from "../src/server/state";
import { loadWebConfig } from "../src/server/webconfig";

const W = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address;
const PUBLIC = { GTA_PUBLIC_MODE: "true", GTA_PUBLIC_ORIGIN: "https://grandtransfer.agency" };

function setup(balanceOf: TokenOps["balanceOf"], env: Record<string, string> = PUBLIC) {
  const s = new ServerState({
    config: loadConfig({ OPENROUTER_API_KEY: "test" }),
    web: loadWebConfig(env),
    db: openDatabase(":memory:"),
  });
  const read = vi.fn(balanceOf);
  Object.assign(s, { tokens: { getCode: vi.fn(), metadata: vi.fn(), balanceOf: read } });
  return { s, read };
}
afterEach(() => vi.useRealTimers());

describe("holder perk", () => {
  it("raises the limit from the threshold up", async () => {
    const below = setup(async () => parseUnits("99999.9", 18));
    expect(await below.s.aiLimit(W)).toEqual({ limit: 30, holder: false });
    const at = setup(async () => parseUnits("100000", 18));
    expect(await at.s.aiLimit(W)).toEqual({ limit: 60, holder: true });
  });
  it("reads the balance at most every few minutes", async () => {
    vi.useFakeTimers({ now: 1_800_000_000_000 });
    const { s, read } = setup(async () => parseUnits("100000", 18));
    await s.aiLimit(W);
    await s.aiLimit(W);
    expect(read).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5 * 60_000 + 1);
    await s.aiLimit(W);
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("a failed read never grants the perk", async () => {
    const { s } = setup(async () => {
      throw new Error("rpc down");
    });
    expect(await s.aiLimit(W)).toEqual({ limit: 30, holder: false });
  });
  it("stops once the tokens are gone", async () => {
    vi.useFakeTimers({ now: 1_800_000_000_000 });
    let held = parseUnits("200000", 18);
    const { s } = setup(async () => held);
    expect((await s.aiLimit(W)).holder).toBe(true);
    held = 0n;
    vi.advanceTimersByTime(5 * 60_000 + 1);
    expect(await s.aiLimit(W)).toEqual({ limit: 30, holder: false });
  });
  it("leaves unlimited local mode alone", async () => {
    const { s, read } = setup(async () => 0n, {});
    expect(await s.aiLimit(W)).toEqual({ limit: 0, holder: false });
    expect(read).not.toHaveBeenCalled();
  });
});
