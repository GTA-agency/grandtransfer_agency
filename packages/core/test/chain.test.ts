import { describe, expect, it } from "vitest";
import {
  assertRobinhoodChain,
  explorerTxUrl,
  ROBINHOOD_CHAIN_ID,
  robinhoodChain,
  WrongChainError,
} from "../src/index.ts";

describe("robinhoodChain", () => {
  it("is mainnet chain 4663 with ETH as gas token", () => {
    expect(ROBINHOOD_CHAIN_ID).toBe(4663);
    expect(robinhoodChain.id).toBe(4663);
    expect(robinhoodChain.nativeCurrency).toEqual({ name: "Ether", symbol: "ETH", decimals: 18 });
  });

  it("builds explorer links", () => {
    expect(explorerTxUrl("0xabc")).toBe("https://robinhoodchain.blockscout.com/tx/0xabc");
  });
});

describe("assertRobinhoodChain", () => {
  it("accepts chain 4663", async () => {
    await expect(assertRobinhoodChain({ getChainId: async () => 4663 })).resolves.toBe(4663);
  });

  it("rejects any other chain", async () => {
    await expect(assertRobinhoodChain({ getChainId: async () => 1 })).rejects.toBeInstanceOf(
      WrongChainError,
    );
  });
});
