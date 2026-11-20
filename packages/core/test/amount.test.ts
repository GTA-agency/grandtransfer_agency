import { describe, expect, it } from "vitest";
import { AmountError, formatEth, parseEthAmount } from "../src/index.ts";

describe("parseEthAmount", () => {
  it.each([
    ["0.01", 10_000_000_000_000_000n],
    ["1", 1_000_000_000_000_000_000n],
    [" 0.5 ", 500_000_000_000_000_000n],
    ["0.000000000000000001", 1n],
    ["0.1", 100_000_000_000_000_000n],
    ["123.456", 123_456_000_000_000_000_000n],
  ])("parses %s exactly", (input, wei) => {
    expect(parseEthAmount(input)).toBe(wei);
  });

  it("is exact where floats are not (0.1 + 0.2)", () => {
    expect(parseEthAmount("0.1") + parseEthAmount("0.2")).toBe(parseEthAmount("0.3"));
  });

  it.each([
    "",
    "0",
    "0.0",
    "-1",
    "1e-3",
    "1,5",
    ".5",
    "1.",
    "abc",
    "0.0000000000000000001",
    "all",
    "50%",
  ])("rejects %j", (input) => {
    expect(() => parseEthAmount(input)).toThrow(AmountError);
  });

  it("rejects JS numbers to avoid float rounding", () => {
    expect(() => parseEthAmount(0.1 as unknown as string)).toThrow(AmountError);
  });

  it("formats wei back to ETH", () => {
    expect(formatEth(10_000_000_000_000_000n)).toBe("0.01");
  });
});
