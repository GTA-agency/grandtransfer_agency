import { describe, expect, it } from "vitest";
import { parseSiweMessage } from "viem/siwe";
import { privateKeyToAccount } from "viem/accounts";
import { verifyMessage } from "viem";
import { SIGN_IN_TTL_MS, buildSignInMessage, checkSignInMessage } from "../src/server/siwe.ts";

const ORIGIN = new URL("https://grand-transfer-agent.autora.workers.dev");
// Public Hardhat test key: no funds.
const acct = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);

describe("Sign-In with Ethereum message", () => {
  it("is a standard EIP-4361 message for this site, this wallet and Robinhood Chain", () => {
    const now = Date.UTC(2026, 10, 20, 12);
    const { message, expiresAt } = buildSignInMessage({
      address: acct.address,
      origin: ORIGIN,
      now,
    });
    expect(message.split("\n")[0]).toBe(
      "grand-transfer-agent.autora.workers.dev wants you to sign in with your Ethereum account:",
    );
    const p = parseSiweMessage(message);
    expect(p).toMatchObject({
      address: acct.address,
      domain: ORIGIN.host,
      uri: ORIGIN.origin,
      chainId: 4663,
      version: "1",
    });
    expect(p.statement).toMatch(/does not send a transaction/);
    expect(p.nonce?.length).toBeGreaterThanOrEqual(8);
    expect(expiresAt - now).toBe(SIGN_IN_TTL_MS);
  });

  it("checks wallet, site and expiry", async () => {
    const now = Date.now();
    const { message } = buildSignInMessage({ address: acct.address, origin: ORIGIN, now });
    expect(checkSignInMessage(message, { address: acct.address, origin: ORIGIN, now })).toBe(true);
    const other = "0x00000000000000000000000000000000000a11ce";
    expect(checkSignInMessage(message, { address: other, origin: ORIGIN, now })).toBe(false);
    expect(
      checkSignInMessage(message, {
        address: acct.address,
        origin: new URL("https://evil.example"),
        now,
      }),
    ).toBe(false);
    expect(
      checkSignInMessage(message, {
        address: acct.address,
        origin: ORIGIN,
        now: now + SIGN_IN_TTL_MS + 1,
      }),
    ).toBe(false);
    // and a real wallet signature over it verifies
    const signature = await acct.signMessage({ message });
    expect(await verifyMessage({ address: acct.address, message, signature })).toBe(true);
  });

  it("each message has a fresh nonce", () => {
    const a = buildSignInMessage({ address: acct.address, origin: ORIGIN }).message;
    const b = buildSignInMessage({ address: acct.address, origin: ORIGIN }).message;
    expect(parseSiweMessage(a).nonce).not.toBe(parseSiweMessage(b).nonce);
  });
});
