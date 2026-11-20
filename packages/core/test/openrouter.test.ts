import { describe, expect, it } from "vitest";
import { LlmError, OpenRouterClient } from "../src/index.ts";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const fail = (status: number, message = "nope", headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error: { message } }), { status, headers });

const reply = {
  model: "anthropic/claude-sonnet-5.5",
  choices: [{ message: { content: "hi", tool_calls: [] } }],
  usage: { prompt_tokens: 12, completion_tokens: 3, cost: 0.00005 },
};

function client(responses: (Response | Error)[], opts: { apiKey?: string | undefined } = {}) {
  const requests: { url: string; init: RequestInit }[] = [];
  const sleeps: number[] = [];
  const c = new OpenRouterClient({
    apiKey: "apiKey" in opts ? opts.apiKey : "sk-or-test",
    model: "anthropic/claude-sonnet-5.5",
    fetch: (async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      const r = responses.shift();
      if (!r) throw new Error("no more responses");
      if (r instanceof Error) throw r;
      return r;
    }) as unknown as typeof fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { c, requests, sleeps };
}

describe("OpenRouterClient", () => {
  it("sends model, tools, temperature 0 and usage accounting; parses usage and cost", async () => {
    const { c, requests } = client([ok(reply)]);
    const r = await c.chat([{ role: "user", content: "hi" }], []);
    expect(r.message).toEqual({ role: "assistant", content: "hi" });
    expect(r.usage).toEqual({ promptTokens: 12, completionTokens: 3, costUsd: 0.00005 });

    const sent = JSON.parse(String(requests[0]!.init.body));
    expect(requests[0]!.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(sent).toMatchObject({
      model: "anthropic/claude-sonnet-5.5",
      temperature: 0,
      usage: { include: true },
    });
    expect((requests[0]!.init.headers as Record<string, string>).Authorization).toBe(
      "Bearer sk-or-test",
    );
  });

  it("refuses to call without an API key", async () => {
    const { c, requests } = client([], { apiKey: undefined });
    await expect(c.chat([], [])).rejects.toMatchObject({ code: "NO_API_KEY" });
    expect(requests).toHaveLength(0);
  });

  it("retries 429/5xx with backoff, honouring Retry-After", async () => {
    const { c, sleeps } = client([
      fail(429, "slow down", { "retry-after": "3" }),
      fail(503),
      ok(reply),
    ]);
    await expect(c.chat([], [])).resolves.toBeDefined();
    expect(sleeps).toEqual([3000, 2000]);
  });

  it("gives up after max retries with a clear error", async () => {
    const { c } = client([fail(429), fail(429), fail(429)]);
    await expect(c.chat([], [])).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("maps auth and credit errors without retrying", async () => {
    await expect(client([fail(401)]).c.chat([], [])).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(client([fail(402)]).c.chat([], [])).rejects.toMatchObject({
      code: "OUT_OF_CREDITS",
    });
  });

  it("retries network errors, then reports a timeout", async () => {
    const timeout = Object.assign(new Error("t"), { name: "TimeoutError" });
    const { c } = client([timeout, timeout, timeout]);
    await expect(c.chat([], [])).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("rejects empty responses", async () => {
    await expect(client([ok({ choices: [] })]).c.chat([], [])).rejects.toBeInstanceOf(LlmError);
  });
});

describe("OpenRouterClient on Cloudflare Workers", () => {
  it("calls the global fetch with the right `this` (Workers throw 'Illegal invocation' otherwise)", async () => {
    const original = globalThis.fetch;
    let calledWith: unknown = "not called";
    globalThis.fetch = function (this: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-this-alias -- the test is about `this`
      calledWith = this;
      if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(
        new Response(
          JSON.stringify({
            model: "m",
            choices: [{ message: { role: "assistant", content: "hi" } }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    } as typeof fetch;
    try {
      const { OpenRouterClient } = await import("../src/index.ts");
      const client = new OpenRouterClient({ apiKey: "k", model: "m" });
      const r = await client.chat([{ role: "user", content: "x" }], []);
      expect(r.message.content).toBe("hi");
      expect(calledWith === undefined || calledWith === globalThis).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });
});
