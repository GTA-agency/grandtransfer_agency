import { describe, expect, it } from "vitest";
import { parseEther } from "viem";
import { EthUsdPrice, formatUsd, formatUsdCents, weiToUsdCents } from "../src/index.ts";

const json = (body: unknown, ok = true) =>
  Promise.resolve(new Response(JSON.stringify(body), { status: ok ? 200 : 503 }));

describe("ETH/USD", () => {
  it("converts wei to cents exactly", () => {
    expect(weiToUsdCents(parseEther("1"), "1636.84")).toBe(163684n);
    expect(weiToUsdCents(parseEther("0.0001"), "1636.84")).toBe(16n); // $0.163684
    expect(weiToUsdCents(parseEther("0.05"), "2000")).toBe(10000n);
    expect(formatUsd(parseEther("12.5"), "1636.84")).toBe("$20,460.50");
    expect(formatUsd(1n, "1636.84")).toBe("<$0.01");
    expect(formatUsd(0n, "1636.84")).toBe("$0");
    expect(formatUsdCents(-1234n)).toBe("-$12.34");
  });

  it("uses the first source that answers, then caches", async () => {
    const calls: string[] = [];
    const p = new EthUsdPrice({
      fetch: (url) => {
        calls.push(url);
        return url.includes("coingecko") ? json({}, false) : json({ data: { amount: "1700.5" } });
      },
    });
    expect(await p.get()).toMatchObject({ usd: "1700.5", source: "Coinbase" });
    await p.get();
    expect(calls).toHaveLength(2); // CoinGecko failed, Coinbase answered; the second call is cached
  });

  it("rejects garbage and keeps a recent stale price when every source is down", async () => {
    const clock = { t: 0 };
    let up = true;
    const p = new EthUsdPrice({
      now: () => clock.t,
      fetch: () => (up ? json({ ethereum: { usd: 1500 } }) : Promise.reject(new Error("down"))),
    });
    expect((await p.get())?.usd).toBe("1500");
    up = false;
    clock.t = 5 * 60_000;
    expect((await p.get())?.usd).toBe("1500"); // stale but recent
    clock.t = 60 * 60_000;
    expect(await p.get()).toBeUndefined();
    const bad = new EthUsdPrice({ fetch: () => json({ ethereum: { usd: "not a price" } }) });
    expect(await bad.get()).toBeUndefined();
  });
});
