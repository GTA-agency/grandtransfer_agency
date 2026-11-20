import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { HostedLlmClient, LlmError } from "../src/index.ts";
import { TEST_PRIVATE_KEY, tempDir } from "./helpers.ts";

const acct = privateKeyToAccount(TEST_PRIVATE_KEY);
const ORIGIN = "https://grandtransfer.agency";
const reply = {
  message: { role: "assistant", content: "Your balance is 0 ETH." },
  model: "m",
  usage: { promptTokens: 1, completionTokens: 1, costUsd: 0.001 },
};

function fakeServer(opts: { expireFirst?: boolean; quota?: boolean } = {}) {
  const calls: { path: string; headers: Record<string, string>; body: unknown }[] = [];
  let sessions = 0;
  let expired = opts.expireFirst ?? false;
  const fetch = async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    const headers = init?.headers as Record<string, string>;
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ path, headers, body });
    const res = (status: number, b: unknown, extra: Record<string, string> = {}) =>
      new Response(JSON.stringify(b), {
        status,
        headers: { "content-type": "application/json", ...extra },
      });
    if (path === "/api/session/wallet/challenge") return res(200, { message: "sign me" });
    if (path === "/api/session/wallet") {
      sessions++;
      return res(
        200,
        { ok: true },
        { "set-cookie": `__Host-gta_session=tok${sessions}; Path=/; HttpOnly` },
      );
    }
    if (path === "/api/llm") {
      if (!headers.cookie?.includes(`tok${sessions}`) || expired) {
        expired = false;
        return res(401, { error: { code: "SESSION_REQUIRED", message: "Connect your wallet." } });
      }
      if (opts.quota)
        return res(429, {
          error: { code: "WALLET_DAILY_LIMIT", message: "You've used today's 30 agent messages." },
        });
      return res(200, reply);
    }
    return res(404, {});
  };
  return { fetch, calls, sessions: () => sessions };
}

describe("HostedLlmClient", () => {
  it("signs in with the wallet once, then sends the conversation with the session cookie and our origin", async () => {
    const srv = fakeServer();
    let unlocks = 0;
    const file = `${tempDir()}/hosted-session.json`;
    const c = new HostedLlmClient({
      origin: ORIGIN,
      address: acct.address,
      sessionFile: file,
      fetch: srv.fetch,
      getAccount: async () => {
        unlocks++;
        return acct;
      },
    });
    const r = await c.chat([{ role: "user", content: "balance?" }], []);
    expect(r.message.content).toBe("Your balance is 0 ETH.");
    await c.chat([{ role: "user", content: "again" }], []);
    expect(unlocks).toBe(1);
    const llm = srv.calls.filter((x) => x.path === "/api/llm");
    expect(llm).toHaveLength(2);
    expect(llm[0]!.headers.origin).toBe(ORIGIN);
    expect(srv.calls.find((x) => x.path === "/api/session/wallet")!.body).toMatchObject({
      address: acct.address,
    });

    // A new run reuses the saved session: no password needed.
    const again = new HostedLlmClient({
      origin: ORIGIN,
      address: acct.address,
      sessionFile: file,
      fetch: srv.fetch,
      getAccount: async () => {
        throw new Error("should not ask for the password");
      },
    });
    await expect(again.chat([{ role: "user", content: "hi" }], [])).resolves.toBeTruthy();
  });

  it("signs in again once when the session expired", async () => {
    const srv = fakeServer({ expireFirst: true });
    const c = new HostedLlmClient({
      origin: ORIGIN,
      address: acct.address,
      fetch: srv.fetch,
      getAccount: async () => acct,
    });
    await expect(c.chat([{ role: "user", content: "hi" }], [])).resolves.toBeTruthy();
    expect(srv.sessions()).toBe(2);
  });

  it("turns the daily allowance into a clear RATE_LIMITED error", async () => {
    const srv = fakeServer({ quota: true });
    const c = new HostedLlmClient({
      origin: ORIGIN,
      address: acct.address,
      fetch: srv.fetch,
      getAccount: async () => acct,
    });
    const err = await c.chat([{ role: "user", content: "hi" }], []).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err).toMatchObject({
      code: "RATE_LIMITED",
      message: expect.stringContaining("30 agent messages"),
    });
  });
});
