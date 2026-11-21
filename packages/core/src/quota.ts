import type { Database } from "./db.ts";

export interface AiLimits {
  /** Chat messages per wallet per UTC day. 0 = unlimited. */
  messagesPerWalletPerDay: number;
  /** Total AI spend across all wallets per UTC day, in USD. 0 = unlimited. */
  dailyBudgetUsd: number;
}

export class QuotaError extends Error {
  constructor(
    readonly code: "WALLET_DAILY_LIMIT" | "DAILY_BUDGET",
    message: string,
  ) {
    super(message);
    this.name = "QuotaError";
  }
}

/** Daily AI quotas, stored in SQLite so they survive restarts. Days are UTC. */
export class AiQuota {
  constructor(
    private readonly db: Database,
    private readonly limits: AiLimits,
    private readonly now: () => number = Date.now,
  ) {}

  private day(): string {
    return new Date(this.now()).toISOString().slice(0, 10);
  }

  /** Throws QuotaError when this wallet (or everyone together) has used today's allowance. */
  check(wallet: string, perWallet: number = this.limits.messagesPerWalletPerDay): void {
    const day = this.day();
    const { dailyBudgetUsd: budget } = this.limits;
    if (perWallet > 0) {
      const row = this.db
        .prepare("SELECT messages FROM ai_usage WHERE day = ? AND wallet = ?")
        .get(day, wallet) as { messages: number } | undefined;
      if ((row?.messages ?? 0) >= perWallet) {
        throw new QuotaError(
          "WALLET_DAILY_LIMIT",
          `You've used today's ${perWallet} agent messages. They reset at 00:00 UTC. Sending from your crew still works.`,
        );
      }
    }
    if (budget > 0) {
      const row = this.db
        .prepare("SELECT COALESCE(SUM(cost_usd), 0) AS total FROM ai_usage WHERE day = ?")
        .get(day) as { total: number };
      if (row.total >= budget) {
        throw new QuotaError(
          "DAILY_BUDGET",
          "The agent is resting: today's AI budget is used up. It's back at 00:00 UTC. Sending from your crew still works.",
        );
      }
    }
  }

  /** Count one answered message and what it cost. */
  record(wallet: string, costUsd: number | undefined): void {
    this.db
      .prepare(
        `INSERT INTO ai_usage (day, wallet, messages, cost_usd) VALUES (?, ?, 1, ?)
         ON CONFLICT(day, wallet) DO UPDATE SET messages = messages + 1, cost_usd = cost_usd + excluded.cost_usd`,
      )
      .run(this.day(), wallet, costUsd ?? 0);
  }

  /** Add cost without counting a message (the in-between steps of one agent answer). */
  addCost(wallet: string, costUsd: number | undefined): void {
    this.db
      .prepare(
        `INSERT INTO ai_usage (day, wallet, messages, cost_usd) VALUES (?, ?, 0, ?)
         ON CONFLICT(day, wallet) DO UPDATE SET cost_usd = cost_usd + excluded.cost_usd`,
      )
      .run(this.day(), wallet, costUsd ?? 0);
  }

  usedToday(
    wallet: string,
    limit: number = this.limits.messagesPerWalletPerDay,
  ): { messages: number; limit: number } {
    const row = this.db
      .prepare("SELECT messages FROM ai_usage WHERE day = ? AND wallet = ?")
      .get(this.day(), wallet) as { messages: number } | undefined;
    return { messages: row?.messages ?? 0, limit };
  }
}
