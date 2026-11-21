/**
 * The web API as one framework-free router: (Request, ServerState) → Response.
 * Next.js calls it in-process locally (app/api/[...path]/route.ts); on Cloudflare the worker
 * hands /api requests to a Durable Object that calls it next to its SQLite storage.
 */
import { verifyMessage, type Hash, type Hex } from "viem";
import {
  AmountError,
  BooksError,
  ConfigError,
  ContactError,
  EXPLORER_URL,
  GTA_TOKEN,
  LEGACY_TOOL_DEFINITIONS,
  LlmError,
  TOOL_DEFINITIONS,
  buildSystemPrompt,
  QuotaError,
  ROBINHOOD_CHAIN_ID,
  TransferError,
  VaultError,
  explorerAddressUrl,
  formatEth,
  formatTokenAmount,
  isNetworkError,
  parseAddress,
  planAmount,
  type ChatMessage,
  type ToolCall,
} from "@gta/core";
import type {
  ChatReplyDto,
  ContactDto,
  ExternalTxDto,
  OverviewDto,
  PeriodPreset,
  SessionDto,
  SyncDto,
} from "../shared/types";
import { draftDto, entryDto, proposalDto, recapDto, resultDto } from "./dto";
import { checkRequest } from "./guard";
import { checkSignInMessage } from "./siwe";
import { SESSION_IDLE_MS, type ServerState, type Session, type WalletContext } from "./state";
import { WebConfigError } from "./webconfig";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const SECURITY_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

/** JSON with bigint as decimal strings. */
export function json(data: unknown, init: ResponseInit = {}): Response {
  const body = JSON.stringify(data, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v));
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!headers.has(k)) headers.set(k, v);
  return new Response(body, { ...init, headers });
}

// ---- request helpers ---------------------------------------------------------------------

interface Ctx {
  req: Request;
  url: URL;
  s: ServerState;
  session: Session | undefined;
  /** The signed-in wallet's own crew, books, plans and sync (undefined when signed out). */
  wallet: WalletContext | undefined;
  /** Client address for rate limits. */
  ip: string;
  params: string[];
  body(): Promise<Record<string, unknown>>;
}

function str(
  body: Record<string, unknown>,
  key: string,
  opts: { max?: number; optional?: boolean } = {},
): string {
  const v = body[key];
  if (v === undefined && opts.optional) return "";
  if (typeof v !== "string") throw new HttpError(400, "BAD_INPUT", `"${key}" must be text.`);
  if (v.length > (opts.max ?? 500)) throw new HttpError(400, "BAD_INPUT", `"${key}" is too long.`);
  return v;
}

function limit(s: ServerState, key: string, max: number, windowMs: number): void {
  if (!s.limiter.take(key, max, windowMs)) {
    throw new HttpError(429, "RATE_LIMITED", "Slow down a little and try again in a moment.");
  }
}

/** `__Host-` cookies must be Secure, path=/ and host-only: the browser enforces all three. */
function cookieName(s: ServerState): string {
  return s.web.publicOrigin?.protocol === "https:" ? "__Host-gta_session" : "gta_session";
}

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

function sessionCookie(s: ServerState, token: string | null): string {
  const secure = s.web.publicOrigin?.protocol === "https:";
  const attrs = [
    `${cookieName(s)}=${token ?? ""}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${token ? SESSION_IDLE_MS / 1000 : 0}`,
  ];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

/** The site's own origin: the configured public one, or (local mode) the loopback host asked. */
function siteOrigin(req: Request, s: ServerState): URL {
  if (s.web.publicOrigin) return s.web.publicOrigin;
  // Local mode: the guard already accepted only loopback hosts.
  return new URL(`http://${req.headers.get("host") ?? "127.0.0.1"}`);
}

function clientIp(req: Request, s: ServerState): string {
  // Cloudflare sets CF-Connecting-IP itself; a proxy we trust sets X-Forwarded-For.
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf;
  if (s.web.trustProxy)
    return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  return "direct";
}

const DAY_MS = 24 * 60 * 60 * 1000;
const PRESETS: PeriodPreset[] = ["today", "week", "month", "year", "all"];
const MAX_CONTACTS = 200;

function parsePreset(v: string | null): PeriodPreset {
  const p = (v ?? "month") as PeriodPreset;
  if (!PRESETS.includes(p)) throw new HttpError(400, "BAD_PERIOD", "Unknown period.");
  return p;
}

// ---- routes ------------------------------------------------------------------------------

type Handler = (c: Ctx) => Promise<Response>;
interface Route {
  method: string;
  path: RegExp;
  auth: boolean;
  handler: Handler;
}

const routes: Route[] = [];
const on = (method: string, path: RegExp, handler: Handler, auth = true) =>
  routes.push({ method, path, auth, handler });

// session ------------------------------------------------------------------------------------

on(
  "GET",
  /^\/api\/session$/,
  async ({ s, session }) => {
    const body: SessionDto = {
      session: session ? { address: session.address } : null,
      network: { chainId: ROBINHOOD_CHAIN_ID, name: "Robinhood Chain", explorer: EXPLORER_URL },
      limits: {
        maxTxEth: formatEth(s.config.maxTxWei),
        maxDailyEth: formatEth(s.config.maxDailyWei),
      },
      idleMinutes: SESSION_IDLE_MS / 60_000,
      publicMode: s.web.publicMode,
    };
    return json(body);
  },
  false,
);

on(
  "POST",
  /^\/api\/session\/lock$/,
  async ({ s, session }) => {
    if (session) s.endSession(session.token);
    return json({ ok: true }, { headers: { "set-cookie": sessionCookie(s, null) } });
  },
  false,
);

on(
  "POST",
  /^\/api\/session\/wallet\/challenge$/,
  async ({ req, s, ip, body }) => {
    limit(s, `challenge:${ip}`, 20, 60_000);
    const address = parseAddress(str(await body(), "address", { max: 64 }));
    return json({ message: s.walletChallenge(address, siteOrigin(req, s)) });
  },
  false,
);

on(
  "POST",
  /^\/api\/session\/wallet$/,
  async ({ s, ip, body }) => {
    limit(s, `signin:${ip}`, 20, 60_000);
    const b = await body();
    const address = parseAddress(str(b, "address", { max: 64 }));
    const signature = str(b, "signature", { max: 200 });
    if (!/^0x[0-9a-fA-F]+$/.test(signature)) {
      throw new HttpError(400, "BAD_SIGNATURE", "That isn't a signature.");
    }
    const challenge = s.takeChallenge(address);
    if (
      !challenge ||
      !checkSignInMessage(challenge.message, { address, origin: challenge.origin })
    ) {
      throw new HttpError(401, "CHALLENGE_EXPIRED", "The sign-in request expired. Connect again.");
    }
    const { message } = challenge;
    // Plain wallets verify locally; smart-contract wallets (ERC-1271/6492) need the chain.
    let valid = await verifyMessage({ address, message, signature: signature as Hex });
    if (!valid) {
      try {
        valid = await s.client.verifyMessage({ address, message, signature: signature as Hex });
      } catch {
        valid = false;
      }
    }
    if (!valid)
      throw new HttpError(401, "BAD_SIGNATURE", "The signature doesn't match this wallet.");
    const session = s.startSession(address);
    return json(
      { ok: true, address },
      { headers: { "set-cookie": sessionCookie(s, session.token) } },
    );
  },
  false,
);

/** ETH/USD for "≈ $" labels. Public: it's a market price, not user data. */
on(
  "GET",
  /^\/api\/price$/,
  async ({ s }) => {
    const q = await s.price.get();
    return json(q ? { ethUsd: q.usd, source: q.source, at: q.at } : { ethUsd: null });
  },
  false,
);

/**
 * Hosted agent for the CLI: one model call on the server's key, for a signed-in wallet.
 * The server sets the system prompt, the tools and the model; the client only sends the
 * conversation. A message counts toward the daily allowance when its final answer arrives.
 */
const LLM_MAX_MESSAGES = 60;
const LLM_MAX_CHARS = 40_000;
on("POST", /^\/api\/llm$/, async ({ s, session, body }) => {
  const address = session!.address;
  limit(s, `llm:${address.toLowerCase()}`, 40, 60_000);
  s.quota.check(address);
  const b = await body();
  // CLI versions before the token update don't send this and can't run the newer tools.
  const current = b.toolset === 2;
  const raw = b.messages;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > LLM_MAX_MESSAGES) {
    throw new HttpError(400, "BAD_INPUT", "messages must be a non-empty list.");
  }
  let chars = 0;
  const messages: ChatMessage[] = [];
  for (const m of raw as Record<string, unknown>[]) {
    const content = typeof m.content === "string" ? m.content : null;
    chars += content?.length ?? 0;
    if (m.role === "user" && content !== null) messages.push({ role: "user", content });
    else if (m.role === "tool" && content !== null && typeof m.tool_call_id === "string") {
      messages.push({ role: "tool", tool_call_id: m.tool_call_id.slice(0, 100), content });
    } else if (m.role === "assistant") {
      const calls = Array.isArray(m.tool_calls)
        ? (m.tool_calls as ToolCall[])
            .filter((c) => c && typeof c.id === "string" && typeof c.function?.name === "string")
            .map((c) => ({
              id: c.id.slice(0, 100),
              type: "function" as const,
              function: {
                name: c.function.name.slice(0, 64),
                arguments: String(c.function.arguments ?? "").slice(0, 4000),
              },
            }))
        : undefined;
      messages.push({
        role: "assistant",
        content,
        ...(calls?.length ? { tool_calls: calls } : {}),
      });
    } // system messages (and anything else) are dropped: the server sets its own
  }
  if (chars > LLM_MAX_CHARS)
    throw new HttpError(413, "TOO_LONG", "That conversation is too long. Start a new chat.");
  const reply = await s.hostedChat(
    [{ role: "system", content: buildSystemPrompt(new Date(), { tokens: current }) }, ...messages],
    current ? TOOL_DEFINITIONS : LEGACY_TOOL_DEFINITIONS,
  );
  if (reply.message.tool_calls?.length) s.quota.addCost(address, reply.usage.costUsd);
  else s.quota.record(address, reply.usage.costUsd);
  return json(reply);
});

// overview & chat -------------------------------------------------------------------------------

on("GET", /^\/api\/overview$/, async ({ s, session, wallet }) => {
  const address = session!.address;
  let balanceEth: string | null = null;
  let balanceError: string | null = null;
  try {
    balanceEth = formatEth(await s.chain.getBalance(address));
  } catch {
    balanceError = "Couldn't reach Robinhood Chain. Showing the books only.";
  }
  let gtaBalance: string | null = null;
  try {
    const units = await s.tokens.balanceOf(GTA_TOKEN.address, address);
    gtaBalance = formatTokenAmount(units, GTA_TOKEN.decimals);
  } catch {
    /* the ETH balance is what matters here; the token line just stays hidden */
  }
  const sent = s.ledger.sumOutgoingSince(address, Date.now() - DAY_MS);
  const ai = s.quota.usedToday(address);
  const body: OverviewDto = {
    address,
    explorerUrl: explorerAddressUrl(address),
    balanceEth,
    balanceError,
    sentLast24hEth: formatEth(sent),
    dailyUsedPct: Math.min(100, Number((sent * 100_000n) / s.config.maxDailyWei) / 1000),
    limits: {
      maxTxEth: formatEth(s.config.maxTxWei),
      maxDailyEth: formatEth(s.config.maxDailyWei),
    },
    recent: s.ledger.recent(address, 6).map(entryDto),
    lastSyncedBlock: wallet!.sync.getCheckpoint(address)?.lastBlock ?? null,
    aiMessages: ai.limit > 0 ? { used: ai.messages, limit: ai.limit } : null,
    gtaBalance,
  };
  return json(body);
});

on("POST", /^\/api\/chat$/, async ({ s, session, body }) => {
  const text = str(await body(), "text", { max: 2000 });
  limit(s, `chat:${session!.address.toLowerCase()}`, 10, 60_000);
  s.quota.check(session!.address); // daily AI allowance (per wallet + overall budget)
  const r = await s.agent(session!).send(text);
  if (r.usage.calls > 0) s.quota.record(session!.address, r.usage.costUsd);
  const reply: ChatReplyDto = {
    message: r.message,
    draft: r.draft ? draftDto(r.draft) : null,
    contactProposal: r.contactProposal ? proposalDto(r.contactProposal) : null,
    paymentLink: r.paymentLink ?? null,
    costUsd: r.usage.costUsd ?? null,
  };
  return json(reply);
});

on("DELETE", /^\/api\/chat$/, async ({ s, session }) => {
  s.agent(session!).reset();
  return json({ ok: true });
});

on("POST", /^\/api\/chat\/note$/, async ({ s, session, body }) => {
  const outcome = str(await body(), "outcome", { max: 20 });
  if (outcome !== "aborted") throw new HttpError(400, "BAD_INPUT", "Unknown outcome.");
  s.agent(session!).noteOutcome("The user aborted that plan. Nothing was sent.");
  return json({ ok: true });
});

// transfers ----------------------------------------------------------------------------------

on("POST", /^\/api\/transfers\/prepare$/, async ({ s, session, wallet, body }) => {
  limit(s, `prepare:${session!.address.toLowerCase()}`, 30, 60_000);
  const b = await body();
  const to = str(b, "to", { max: 64 });
  const amount = str(b, "amountEth", { max: 40 });
  const asset = str(b, "asset", { max: 8, optional: true }) || "eth";
  if (asset !== "eth" && asset !== "gta") throw new HttpError(400, "BAD_INPUT", "Unknown asset.");
  const draft =
    asset === "gta"
      ? await wallet!.transfers.prepareToken({ to, amount, token: "GTA" })
      : await wallet!.transfers.prepare({ to, amountEth: amount });
  return json({ draft: draftDto(draft) });
});

/** The user confirmed the plan card: re-check everything and return the exact tx to sign. */
on("POST", /^\/api\/transfers\/authorize$/, async ({ wallet, body }) => {
  const b = await body();
  if (b.confirmed !== true) throw new HttpError(400, "NOT_CONFIRMED", "Confirm the plan first.");
  const tx = await wallet!.transfers.authorizeExternal(str(b, "draftId", { max: 64 }), {
    confirmed: true,
  });
  const dto: ExternalTxDto = {
    draftId: tx.draftId,
    chainId: tx.chainId,
    from: tx.from,
    to: tx.to,
    value: tx.value.toString(),
    ...(tx.data ? { data: tx.data } : {}),
    gas: tx.gas.toString(),
    maxFeePerGas: tx.maxFeePerGas.toString(),
    maxPriorityFeePerGas: tx.maxPriorityFeePerGas.toString(),
  };
  return json({ tx: dto });
});

/** The browser wallet broadcast the transaction; verify it on chain against the plan, log it. */
on("POST", /^\/api\/transfers\/record$/, async ({ s, session, wallet, body }) => {
  const b = await body();
  const draftId = str(b, "draftId", { max: 64 });
  const draft = wallet!.transfers.getDraft(draftId);
  const result = await wallet!.transfers.recordExternal(
    draftId,
    str(b, "hash", { max: 66 }) as Hash,
  );
  if (draft) {
    s.agent(session!).noteOutcome(
      `Transfer ${result.status}: ${planAmount(draft)} to ${draft.contactName ?? draft.to}, tx ${result.hash}.`,
    );
  }
  return json({ result: resultDto(result) });
});

// contacts -----------------------------------------------------------------------------------

on("GET", /^\/api\/contacts$/, async ({ wallet }) => {
  const contacts: ContactDto[] = wallet!.contacts.list().map((c) => ({
    name: c.name,
    address: c.address,
    explorerUrl: explorerAddressUrl(c.address),
  }));
  return json({ contacts });
});

on("POST", /^\/api\/contacts$/, async ({ s, wallet, body }) => {
  const b = await body();
  if (s.web.publicMode && wallet!.contacts.list().length >= MAX_CONTACTS) {
    throw new HttpError(422, "TOO_MANY", `Up to ${MAX_CONTACTS} contacts.`);
  }
  const c = wallet!.contacts.add(str(b, "name", { max: 40 }), str(b, "address", { max: 64 }));
  return json({ contact: { name: c.name, address: c.address } });
});

/** The user pressed "Save" on a contact the agent suggested. */
on("POST", /^\/api\/contacts\/confirm$/, async ({ s, session, body }) => {
  try {
    const c = s.agent(session!).confirmContact(str(await body(), "proposalId", { max: 64 }));
    return json({ contact: { name: c.name, address: c.address } });
  } catch (err) {
    if (err instanceof Error && err.message.includes("expired")) {
      throw new HttpError(410, "PROPOSAL_EXPIRED", err.message);
    }
    throw err;
  }
});

on("PATCH", /^\/api\/contacts\/([^/]+)$/, async ({ wallet, params, body }) => {
  const c = wallet!.contacts.rename(
    decodeURIComponent(params[0]!),
    str(await body(), "newName", { max: 40 }),
  );
  return json({ contact: { name: c.name, address: c.address } });
});

on("DELETE", /^\/api\/contacts\/([^/]+)$/, async ({ wallet, params }) => {
  wallet!.contacts.remove(decodeURIComponent(params[0]!));
  return json({ ok: true });
});

// books --------------------------------------------------------------------------------------

on("GET", /^\/api\/books$/, async ({ s, session, wallet, url }) => {
  const address = session!.address;
  const books = wallet!.books;
  const period = books.period(parsePreset(url.searchParams.get("period")), address);
  const recap = books.recap(address, period);
  const entries = s.ledger.between(address, period.from, period.to).slice(0, 500);
  return json({ recap: recapDto(recap, entries) });
});

/** Pull new activity from the chain. One sync per wallet at a time; may come back partial. */
on("POST", /^\/api\/books\/sync$/, async ({ s, session, wallet }) => {
  const w = wallet!;
  if (!w.syncing) limit(s, `sync:${session!.address.toLowerCase()}`, 40, 60_000);
  const opts = s.maxSyncRpcCalls ? { maxRpcCalls: s.maxSyncRpcCalls } : {};
  const run = (w.syncing ??= w.sync
    .sync(session!.address, opts)
    .finally(() => (w.syncing = undefined)));
  const r = await run;
  const body: SyncDto = {
    initialized: r.initialized,
    toBlock: r.toBlock,
    incoming: r.incoming,
    outgoingExternal: r.outgoingExternal,
    internalIncoming: r.internalIncoming,
    settledPending: r.settledPending,
    dropped: r.dropped,
    partial: r.partial,
  };
  return json(body);
});

/** Set a transaction's category and/or note. Empty string clears it. */
on("PATCH", /^\/api\/books\/entries$/, async ({ session, wallet, body }) => {
  const address = session!.address;
  const b = await body();
  const hash = str(b, "hash", { max: 80 });
  if (!("category" in b) && !("note" in b)) {
    throw new HttpError(400, "BAD_INPUT", "Nothing to change.");
  }
  if ("category" in b)
    wallet!.books.setCategory(address, hash, str(b, "category", { max: 30 }) || null);
  if ("note" in b) wallet!.books.setNote(address, hash, str(b, "note", { max: 280 }) || null);
  return json({ ok: true });
});

on("GET", /^\/api\/books\/export$/, async ({ session, wallet, url }) => {
  const address = session!.address;
  const preset = parsePreset(url.searchParams.get("period"));
  const csv = wallet!.books.exportCsv(address, wallet!.books.period(preset, address));
  const day = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      ...SECURITY_HEADERS,
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="gta-books-${preset}-${day}.csv"`,
    },
  });
});

// categories ---------------------------------------------------------------------------------

on("GET", /^\/api\/categories$/, async ({ wallet }) =>
  json({ categories: wallet!.books.listCategories() }),
);

on("POST", /^\/api\/categories$/, async ({ wallet, body }) =>
  json({ name: wallet!.books.addCategory(str(await body(), "name", { max: 30 })) }),
);

on("DELETE", /^\/api\/categories\/([^/]+)$/, async ({ wallet, params }) => {
  wallet!.books.removeCategory(decodeURIComponent(params[0]!));
  return json({ ok: true });
});

// ---- dispatch ------------------------------------------------------------------------------

/** Liveness for container probes and load balancers: outside the guard, says nothing else. */
const health = () => json({ ok: true, service: "grand-transfer-agent" });

export async function handleApi(req: Request, s: ServerState): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname === "/api/health" && req.method === "GET") return health();
  try {
    const fail = checkRequest(req, { publicOrigin: s.web.publicOrigin });
    if (fail) throw new HttpError(fail.status, fail.code, fail.message);

    let pathMatched = false;
    for (const r of routes) {
      const m = r.path.exec(url.pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== req.method) continue;
      const session = s.current(readCookie(req, cookieName(s)));
      if (r.auth && !session) {
        throw new HttpError(401, "SESSION_REQUIRED", "Connect your wallet to continue.");
      }
      let parsed: Record<string, unknown> | undefined;
      return await r.handler({
        req,
        url,
        s,
        session,
        wallet: session ? s.wallet(session.address) : undefined,
        ip: clientIp(req, s),
        params: m.slice(1),
        body: async () => {
          if (parsed) return parsed;
          try {
            const b = (await req.json()) as unknown;
            if (b === null || typeof b !== "object" || Array.isArray(b)) throw new Error();
            parsed = b as Record<string, unknown>;
            return parsed;
          } catch {
            throw new HttpError(400, "BAD_JSON", "Request body must be a JSON object.");
          }
        },
      });
    }
    throw pathMatched
      ? new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed.")
      : new HttpError(404, "NOT_FOUND", "No such endpoint.");
  } catch (err) {
    return errorResponse(err, s.web.publicMode);
  }
}

export function errorResponse(err: unknown, publicMode = false): Response {
  const hint = publicMode ? "Try again in a moment." : "Check the terminal.";
  const fail = (status: number, code: string, message: string, details?: unknown) =>
    json({ error: { code, message, ...(details ? { details } : {}) } }, { status });
  if (err instanceof HttpError) return fail(err.status, err.code, err.message);
  if (err instanceof TransferError) return fail(422, err.code, err.message, err.details);
  if (err instanceof VaultError) {
    const status = err.code === "WRONG_PASSWORD" ? 401 : err.code === "LOCKED" ? 423 : 422;
    return fail(status, err.code, err.message);
  }
  if (err instanceof ContactError || err instanceof BooksError || err instanceof AmountError) {
    return fail(422, (err as { code?: string }).code ?? "INVALID", err.message);
  }
  if (err instanceof QuotaError) return fail(429, err.code, err.message);
  if (isNetworkError(err)) {
    return fail(
      503,
      "NETWORK_UNAVAILABLE",
      "Couldn't reach Robinhood Chain right now. Try again in a moment.",
    );
  }
  if (err instanceof LlmError) return fail(502, err.code, err.message);
  if (err instanceof WebConfigError || err instanceof ConfigError) {
    console.error("[gta web] config:", err.message);
    return fail(500, "CONFIG", `The server isn't configured correctly. ${hint}`);
  }
  console.error("[gta web] unexpected error:", err instanceof Error ? err.message : err);
  return fail(500, "INTERNAL", `Something went wrong on the server. ${hint}`);
}
