import { randomBytes } from "node:crypto";
import { parseUnits, type Address, type PublicClient } from "viem";
import {
  AddressBook,
  AiQuota,
  EthUsdPrice,
  Books,
  GTA_HOLDER_PERK,
  GTA_TOKEN,
  LOCAL_OWNER,
  LedgerStore,
  LedgerSync,
  OpenRouterClient,
  RoutedLlmClient,
  TransferService,
  WalletAgent,
  createChainClient,
  createViemChainOps,
  createViemTokenOps,
  createViemHistory,
  type ChainHistory,
  type ChainOps,
  type TokenOps,
  type Config,
  type Database,
  type ChatMessage,
  type LlmClient,
  type LlmReply,
  type ToolDefinition,
  type SyncReport,
  type UsageLog,
} from "@gta/core";
import { RateLimiter } from "./ratelimit";
import { buildSignInMessage } from "./siwe";
import type { WebConfig } from "./webconfig";

/**
 * The session ends after this long without a request. It can be long: the web server holds no
 * key, and every send is still signed in the user's own wallet.
 */
export const SESSION_IDLE_MS = 12 * 60 * 60_000;

const MAX_AGENTS = 10_000;
const MAX_WALLETS = 2_000;
const MAX_CHALLENGES = 5_000;
const HOLDER_CHECK_MS = 5 * 60_000;

export interface Session {
  token: string;
  /** The browser wallet that proved ownership by signing a challenge. */
  address: Address;
  lastSeen: number;
}

/** Everything that belongs to one wallet: its crew, books, plans and sync progress. */
export interface WalletContext {
  address: Address;
  contacts: AddressBook;
  books: Books;
  transfers: TransferService;
  sync: LedgerSync;
  syncing: Promise<SyncReport> | undefined;
  lastUsed: number;
}

/**
 * Everything the web server holds. It never holds a private key: it only works with browser
 * wallets, which sign every transaction themselves. Many people can be signed in at once; in
 * public mode each wallet only ever sees its own data.
 *
 * Runs inside Next.js locally (see node-state.ts) and inside a Durable Object on Cloudflare
 * (see worker.ts); the database is handed in.
 */
export class ServerState {
  readonly config: Config;
  readonly web: WebConfig;
  readonly db: Database;
  readonly ledger: LedgerStore;
  readonly client: PublicClient;
  readonly chain: ChainOps;
  readonly tokens: TokenOps;
  readonly quota: AiQuota;
  readonly limiter = new RateLimiter();
  readonly price = new EthUsdPrice();
  private readonly history: ChainHistory;
  private readonly llm: LlmClient;
  private readonly usageLog: UsageLog;
  private readonly agents = new Map<string, WalletAgent>();
  private readonly wallets = new Map<string, WalletContext>();
  private readonly holders = new Map<string, { holder: boolean; until: number }>();
  private readonly challenges = new Map<
    string,
    { message: string; origin: string; expiresAt: number }
  >();

  /** Cap on RPC calls per sync request (Cloudflare limits outgoing requests per invocation). */
  readonly maxSyncRpcCalls: number | undefined;

  constructor(deps: {
    config: Config;
    web: WebConfig;
    db: Database;
    usageLog?: UsageLog;
    maxSyncRpcCalls?: number;
  }) {
    this.config = deps.config;
    this.web = deps.web;
    this.db = deps.db;
    this.maxSyncRpcCalls = deps.maxSyncRpcCalls;
    this.ledger = new LedgerStore(this.db);
    this.client = createChainClient(this.config.rpcUrls);
    this.chain = createViemChainOps(this.client, this.config.rpcUrls);
    this.tokens = createViemTokenOps(this.client);
    this.history = createViemHistory(this.config.archiveRpcUrl);
    this.quota = new AiQuota(this.db, this.web.ai);
    const main = new OpenRouterClient({
      apiKey: this.config.openRouterApiKey,
      model: this.config.openRouterModel,
    });
    this.llm = this.web.lightModel
      ? new RoutedLlmClient(
          main,
          new OpenRouterClient({
            apiKey: this.config.openRouterApiKey,
            model: this.web.lightModel,
          }),
        )
      : main;
    this.usageLog = deps.usageLog ?? { record: () => undefined };
  }

  /**
   * Today's agent message allowance. Wallets holding enough $GTA get more. The balance is read
   * at most every few minutes; if it can't be read, the last known answer (or the normal limit)
   * applies, so a network problem never grants the perk.
   */
  async aiLimit(address: Address): Promise<{ limit: number; holder: boolean }> {
    const base = this.web.ai.messagesPerWalletPerDay;
    if (base === 0 || GTA_HOLDER_PERK.messagesPerDay <= base) return { limit: base, holder: false };
    const key = address.toLowerCase();
    const now = Date.now();
    let cached = this.holders.get(key);
    if (!cached || now > cached.until) {
      try {
        const held = await this.tokens.balanceOf(GTA_TOKEN.address, address);
        const min = parseUnits(GTA_HOLDER_PERK.minTokens, GTA_TOKEN.decimals);
        cached = { holder: held >= min, until: now + HOLDER_CHECK_MS };
        if (this.holders.size >= MAX_WALLETS) this.holders.clear();
        this.holders.set(key, cached);
      } catch {
        /* keep whatever we knew */
      }
    }
    return cached?.holder
      ? { limit: GTA_HOLDER_PERK.messagesPerDay, holder: true }
      : { limit: base, holder: false };
  }

  /** One model call on the server's key, for the CLI's hosted agent (see /api/llm). */
  hostedChat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<LlmReply> {
    return this.llm.chat(messages, tools);
  }

  /** Public mode keeps data per wallet; locally everything belongs to the one local owner. */
  private ownerOf(address: Address): string {
    return this.web.publicMode ? address.toLowerCase() : LOCAL_OWNER;
  }

  wallet(address: Address): WalletContext {
    const key = address.toLowerCase();
    let w = this.wallets.get(key);
    if (!w) {
      if (this.wallets.size >= MAX_WALLETS) evictOldest(this.wallets, (x) => x.lastUsed);
      const owner = this.ownerOf(address);
      const contacts = new AddressBook(this.db, Date.now, owner);
      w = {
        address,
        contacts,
        books: new Books(this.db, this.ledger, Date.now, owner),
        transfers: new TransferService({
          wallet: { address },
          contacts,
          ledger: this.ledger,
          chain: this.chain,
          tokens: this.tokens,
          limits: { maxTxWei: this.config.maxTxWei, maxDailyWei: this.config.maxDailyWei },
        }),
        sync: new LedgerSync({
          db: this.db,
          ledger: this.ledger,
          contacts,
          history: this.history,
        }),
        syncing: undefined,
        lastUsed: Date.now(),
      };
      this.wallets.set(key, w);
    }
    w.lastUsed = Date.now();
    return w;
  }

  /** The agent of one session (each tab keeps its own conversation). */
  agent(session: Session): WalletAgent {
    let a = this.agents.get(session.token);
    if (!a) {
      if (this.agents.size >= MAX_AGENTS) this.agents.delete(this.agents.keys().next().value!);
      const w = this.wallet(session.address);
      a = new WalletAgent({
        llm: this.llm,
        model: this.config.openRouterModel,
        ctx: {
          wallet: { address: session.address },
          contacts: w.contacts,
          ledger: this.ledger,
          chain: this.chain,
          transfers: w.transfers,
          tokens: this.tokens,
          siteOrigin: this.web.publicOrigin?.origin ?? "http://127.0.0.1:4663",
          ethUsd: async () => (await this.price.get())?.usd,
          now: Date.now,
        },
        usageLog: this.usageLog,
      });
      this.agents.set(session.token, a);
    }
    return a;
  }

  // ---- sessions ---------------------------------------------------------------------------

  /** The live session for this cookie value, or undefined. Sessions live in the database. */
  current(token: string | undefined, now = Date.now()): Session | undefined {
    // Tokens are 256-bit random values, so an indexed lookup leaks nothing useful through timing.
    if (!token || token.length > 200) return undefined;
    const row = this.db
      .prepare("SELECT token, address, last_seen FROM web_sessions WHERE token = ?")
      .get(token) as { token: string; address: string; last_seen: number } | undefined;
    if (!row) return undefined;
    if (now - row.last_seen > SESSION_IDLE_MS) {
      this.endSession(token);
      return undefined;
    }
    if (now - row.last_seen > 60_000) {
      this.db.prepare("UPDATE web_sessions SET last_seen = ? WHERE token = ?").run(now, token);
    }
    return { token: row.token, address: row.address as Address, lastSeen: now };
  }

  startSession(address: Address): Session {
    const now = Date.now();
    this.db.prepare("DELETE FROM web_sessions WHERE last_seen < ?").run(now - SESSION_IDLE_MS);
    const session = { token: randomBytes(32).toString("base64url"), address, lastSeen: now };
    this.db
      .prepare("INSERT INTO web_sessions (token, address, last_seen) VALUES (?, ?, ?)")
      .run(session.token, address, now);
    return session;
  }

  endSession(token: string): void {
    this.db.prepare("DELETE FROM web_sessions WHERE token = ?").run(token);
    this.agents.delete(token);
  }

  /**
   * A Sign-In with Ethereum message for this wallet and site. Single use, 5 minutes, one
   * outstanding per address.
   */
  walletChallenge(address: Address, origin: URL): string {
    const now = Date.now();
    if (this.challenges.size >= MAX_CHALLENGES) {
      for (const [k, c] of this.challenges) if (now > c.expiresAt) this.challenges.delete(k);
      if (this.challenges.size >= MAX_CHALLENGES) {
        this.challenges.delete(this.challenges.keys().next().value!);
      }
    }
    const { message, expiresAt } = buildSignInMessage({ address, origin, now });
    this.challenges.set(address.toLowerCase(), { message, origin: origin.origin, expiresAt });
    return message;
  }

  takeChallenge(address: Address): { message: string; origin: URL } | undefined {
    const key = address.toLowerCase();
    const c = this.challenges.get(key);
    this.challenges.delete(key);
    if (!c || Date.now() > c.expiresAt) return undefined;
    return { message: c.message, origin: new URL(c.origin) };
  }
}

function evictOldest<V>(map: Map<string, V>, age: (v: V) => number): void {
  let oldestKey: string | undefined;
  let oldest = Infinity;
  for (const [k, v] of map) {
    const t = age(v);
    if (t < oldest) {
      oldest = t;
      oldestKey = k;
    }
  }
  if (oldestKey) map.delete(oldestKey);
}
