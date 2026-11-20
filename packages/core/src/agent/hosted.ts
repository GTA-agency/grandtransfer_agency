import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Address, LocalAccount } from "viem";
import {
  LlmError,
  type ChatMessage,
  type LlmClient,
  type LlmReply,
  type ToolDefinition,
} from "./llm.ts";

/** Where the CLI gets its AI when the user has no OpenRouter key of their own. */
export const DEFAULT_HOSTED_AGENT_URL = "https://grandtransfer.agency";

const COOKIE = "__Host-gta_session";

interface SavedSession {
  origin: string;
  address: string;
  token: string;
  savedAt: number;
}

export interface HostedLlmOptions {
  /** Site origin, e.g. https://grandtransfer.agency */
  origin: string;
  /** The wallet that signs in. */
  address: Address;
  /** Returns the unlocked account when a (re-)sign-in is needed; may prompt for a password. */
  getAccount: () => Promise<LocalAccount>;
  /** File that keeps the session between runs (mode 600). Optional. */
  sessionFile?: string;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}

/**
 * An LlmClient that runs each model call on the hosted agent (grandtransfer.agency) instead of
 * a local OpenRouter key. It signs in with Sign-In with Ethereum using the local wallet: a free
 * message, never a transaction. The site's daily allowance per wallet applies.
 */
export class HostedLlmClient implements LlmClient {
  private token: string | undefined;
  private readonly fetchFn: (input: string, init?: RequestInit) => Promise<Response>;

  constructor(private readonly opts: HostedLlmOptions) {
    this.fetchFn = opts.fetch ?? ((input, init) => fetch(input, init));
    this.token = this.loadSaved();
  }

  async chat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<LlmReply> {
    void tools; // the server uses its own tool list
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!this.token) await this.signIn();
      const res = await this.request("/api/llm", { messages }, this.token);
      if (res.status === 401 && attempt === 0) {
        this.token = undefined; // expired or ended elsewhere: sign in once more
        continue;
      }
      const body = (await res.json().catch(() => ({}))) as {
        error?: { code?: string; message?: string };
      } & Partial<LlmReply>;
      if (!res.ok) throw toLlmError(res.status, body.error?.message);
      if (!body.message || body.message.role !== "assistant") {
        throw new LlmError("BAD_RESPONSE", "The hosted agent sent an unexpected reply.");
      }
      return {
        message: body.message,
        model: body.model ?? "hosted",
        usage: body.usage ?? { promptTokens: 0, completionTokens: 0, costUsd: undefined },
      };
    }
    throw new LlmError("UNAUTHORIZED", "Couldn't sign in to the hosted agent.");
  }

  private async signIn(): Promise<void> {
    const ch = await this.request("/api/session/wallet/challenge", { address: this.opts.address });
    const chBody = (await ch.json().catch(() => ({}))) as {
      message?: string;
      error?: { message?: string };
    };
    if (!ch.ok || !chBody.message) throw toLlmError(ch.status, chBody.error?.message);
    const account = await this.opts.getAccount();
    const signature = await account.signMessage({ message: chBody.message });
    const res = await this.request("/api/session/wallet", {
      address: this.opts.address,
      signature,
    });
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw toLlmError(res.status, b.error?.message);
    }
    const cookie = res.headers.get("set-cookie") ?? "";
    const m = new RegExp(`${COOKIE}=([^;]+)`).exec(cookie) ?? /gta_session=([^;]+)/.exec(cookie);
    if (!m?.[1]) throw new LlmError("BAD_RESPONSE", "The hosted agent didn't start a session.");
    this.token = m[1];
    this.save(m[1]);
  }

  private async request(path: string, body: unknown, token?: string): Promise<Response> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      origin: this.opts.origin, // the API only accepts writes from its own origin
      "user-agent": "grand-transfer-agent-cli",
    };
    if (token) headers.cookie = `${COOKIE}=${token}; gta_session=${token}`;
    try {
      return await this.fetchFn(`${this.opts.origin}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 90_000),
      });
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new LlmError("TIMEOUT", "The hosted agent took too long to answer. Try again.");
      }
      throw new LlmError(
        "UPSTREAM_ERROR",
        `Couldn't reach ${this.opts.origin}. Check your connection.`,
      );
    }
  }

  private loadSaved(): string | undefined {
    const f = this.opts.sessionFile;
    if (!f || !existsSync(f)) return undefined;
    try {
      const s = JSON.parse(readFileSync(f, "utf8")) as SavedSession;
      const fresh = Date.now() - s.savedAt < 11 * 60 * 60_000;
      const same =
        s.origin === this.opts.origin &&
        s.address.toLowerCase() === this.opts.address.toLowerCase();
      return fresh && same && typeof s.token === "string" ? s.token : undefined;
    } catch {
      return undefined;
    }
  }

  private save(token: string): void {
    const f = this.opts.sessionFile;
    if (!f) return;
    const s: SavedSession = {
      origin: this.opts.origin,
      address: this.opts.address,
      token,
      savedAt: Date.now(),
    };
    try {
      writeFileSync(f, JSON.stringify(s), { mode: 0o600 });
    } catch {
      /* not fatal: we just sign in again next run */
    }
  }
}

function toLlmError(status: number, message: string | undefined): LlmError {
  const msg = message ?? `The hosted agent answered with HTTP ${status}.`;
  if (status === 429) return new LlmError("RATE_LIMITED", msg);
  if (status === 401 || status === 403) return new LlmError("UNAUTHORIZED", msg);
  if (status === 402) return new LlmError("OUT_OF_CREDITS", msg);
  return new LlmError("UPSTREAM_ERROR", msg);
}
