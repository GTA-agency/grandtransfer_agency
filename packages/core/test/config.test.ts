import { homedir } from "node:os";
import { join } from "node:path";
import { parseEther } from "viem";
import { describe, expect, it } from "vitest";
import { ConfigError, DEFAULT_RPC_URLS, loadConfig } from "../src/index.ts";

describe("loadConfig", () => {
  it("applies safe defaults for an empty environment", () => {
    const c = loadConfig({});
    expect(c.openRouterApiKey).toBeUndefined();
    expect(c.openRouterModel).toBe("anthropic/claude-sonnet-5.5");
    expect(c.rpcUrls).toEqual([...DEFAULT_RPC_URLS]);
    expect(c.dataDir).toBe(join(homedir(), ".grand-transfer-agent"));
    expect(c.maxTxWei).toBe(parseEther("0.05"));
    expect(c.maxDailyWei).toBe(parseEther("0.2"));
  });

  it("treats empty strings like missing values", () => {
    const c = loadConfig({ OPENROUTER_API_KEY: "", RPC_URL: "  ", MAX_TX_ETH: "" });
    expect(c.openRouterApiKey).toBeUndefined();
    expect(c.rpcUrls).toEqual([...DEFAULT_RPC_URLS]);
    expect(c.maxTxWei).toBe(parseEther("0.05"));
  });

  it("parses a comma-separated RPC list", () => {
    const c = loadConfig({ RPC_URL: "https://a.example, https://b.example" });
    expect(c.rpcUrls).toEqual(["https://a.example", "https://b.example"]);
  });

  it("rejects non-https RPC URLs", () => {
    expect(() => loadConfig({ RPC_URL: "http://insecure.example" })).toThrow(ConfigError);
  });

  it("parses limits exactly as wei (no floating point)", () => {
    const c = loadConfig({ MAX_TX_ETH: "0.1", MAX_DAILY_ETH: "0.300000000000000001" });
    expect(c.maxTxWei).toBe(100_000_000_000_000_000n);
    expect(c.maxDailyWei).toBe(300_000_000_000_000_001n);
  });

  it.each(["abc", "-1", "1e3", "0.1.2", "0.0000000000000000001", "0"])(
    "rejects invalid limit %s",
    (value) => {
      expect(() => loadConfig({ MAX_TX_ETH: value })).toThrow(ConfigError);
    },
  );

  it("rejects a per-transaction limit above the daily limit", () => {
    expect(() => loadConfig({ MAX_TX_ETH: "1", MAX_DAILY_ETH: "0.5" })).toThrow(
      /MAX_TX_ETH: must not be larger than MAX_DAILY_ETH/,
    );
  });

  it("lists every problem in one error", () => {
    try {
      loadConfig({ MAX_TX_ETH: "x", RPC_URL: "ftp://nope" });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as ConfigError).issues).toHaveLength(2);
    }
  });
});
