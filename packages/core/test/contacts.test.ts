import { describe, expect, it } from "vitest";
import { AddressBook, ContactError, openDatabase, parseAddress } from "../src/index.ts";

const ROBINHOOD = "0x8F3a5bC1D2e4F6789012345678901234567891C2";
const ROBINHOOD_CHECKSUM = parseAddress(ROBINHOOD.toLowerCase());
const SAVINGS = "0x2d7c000000000000000000000000000000004e18";

function book() {
  return new AddressBook(openDatabase(":memory:"));
}

describe("parseAddress", () => {
  it("accepts lowercase and returns the checksummed form", () => {
    expect(parseAddress(SAVINGS)).toBe("0x2d7C000000000000000000000000000000004E18");
  });

  it("rejects a mixed-case address with a broken checksum (typo protection)", () => {
    const good = ROBINHOOD_CHECKSUM;
    expect(parseAddress(good)).toBe(good);
    // Flip the case of the first hex letter: same bytes, but the EIP-55 checksum no longer matches.
    const i = good.slice(2).search(/[a-fA-F]/) + 2;
    const ch = good[i]!;
    const broken =
      good.slice(0, i) +
      (ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase()) +
      good.slice(i + 1);
    expect(() => parseAddress(broken)).toThrow(ContactError);
  });

  it.each(["0x123", "hello", "0xZZ00000000000000000000000000000000000000", ""])(
    "rejects %j",
    (v) => {
      expect(() => parseAddress(v)).toThrow(ContactError);
    },
  );
});

describe("AddressBook", () => {
  it("adds, lists and resolves contacts case-insensitively", () => {
    const b = book();
    b.add("Robinhood", ROBINHOOD_CHECKSUM);
    b.add("savings vault", SAVINGS);
    expect(b.list().map((c) => c.name)).toEqual(["Robinhood", "savings vault"]);
    expect(b.resolve("robinhood")).toMatchObject({
      kind: "contact",
      contact: { name: "Robinhood" },
    });
    expect(b.resolve("  ROBINHOOD ")).toMatchObject({ kind: "contact" });
  });

  it("rejects duplicate names regardless of case", () => {
    const b = book();
    b.add("robinhood", ROBINHOOD_CHECKSUM);
    expect(() => b.add("RobinHood", SAVINGS)).toThrow(/already exists/);
  });

  it("rejects invalid names and addresses", () => {
    const b = book();
    expect(() => b.add("", SAVINGS)).toThrow(ContactError);
    expect(() => b.add("x".repeat(41), SAVINGS)).toThrow(ContactError);
    expect(() => b.add("<script>", SAVINGS)).toThrow(ContactError);
    expect(() => b.add("ok", "0x123")).toThrow(ContactError);
  });

  it("never resolves a fuzzy match directly: it asks", () => {
    const b = book();
    b.add("robinhood", ROBINHOOD_CHECKSUM);
    b.add("robin", SAVINGS);
    expect(b.resolve("robinhod")).toMatchObject({ kind: "ambiguous" });
    const r = b.resolve("rob");
    expect(r.kind).toBe("ambiguous");
    if (r.kind === "ambiguous")
      expect(r.candidates.map((c) => c.name).sort()).toEqual(["robin", "robinhood"]);
    expect(b.resolve("kevin")).toEqual({ kind: "not_found", query: "kevin" });
  });

  it("resolves raw addresses and links them to a known contact", () => {
    const b = book();
    b.add("robinhood", ROBINHOOD_CHECKSUM);
    expect(b.resolve(ROBINHOOD_CHECKSUM.toLowerCase())).toMatchObject({
      kind: "address",
      address: ROBINHOOD_CHECKSUM,
      contact: { name: "robinhood" },
    });
    expect(b.resolve(SAVINGS)).toEqual({ kind: "address", address: parseAddress(SAVINGS) });
  });

  it("renames and removes", () => {
    const b = book();
    b.add("robinhood", ROBINHOOD_CHECKSUM);
    b.rename("robinhood", "rh main");
    expect(b.get("rh main")?.address).toBe(ROBINHOOD_CHECKSUM);
    b.remove("rh main");
    expect(b.list()).toEqual([]);
    expect(() => b.remove("nope")).toThrow(/No contact/);
  });
});
