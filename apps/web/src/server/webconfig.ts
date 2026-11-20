import type { AiLimits } from "@gta/core";

/**
 * Web-only settings (read after the repo .env is loaded).
 *
 *   GTA_PUBLIC_MODE=true            serve other people: data per wallet, quotas on
 *   GTA_PUBLIC_ORIGIN=https://…     the one origin the site is served from (required when public)
 *   GTA_TRUST_PROXY=true            take the client IP from X-Forwarded-For (behind a proxy)
 *   AI_MESSAGES_PER_WALLET_DAY=30   0 = unlimited (default: 30 public, unlimited local)
 *   AI_DAILY_BUDGET_USD=3           0 = unlimited (default: 3 public, unlimited local)
 */
export interface WebConfig {
  publicMode: boolean;
  publicOrigin: URL | null;
  trustProxy: boolean;
  ai: AiLimits;
}

export class WebConfigError extends Error {}

const truthy = (v: string | undefined) => /^(1|true|yes|on)$/i.test((v ?? "").trim());

function num(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new WebConfigError(`${key} must be a number ≥ 0.`);
  return n;
}

export function loadWebConfig(env: NodeJS.ProcessEnv = process.env): WebConfig {
  const publicMode = truthy(env.GTA_PUBLIC_MODE);
  let publicOrigin: URL | null = null;
  const rawOrigin = env.GTA_PUBLIC_ORIGIN?.trim();
  if (rawOrigin) {
    try {
      publicOrigin = new URL(rawOrigin);
    } catch {
      throw new WebConfigError("GTA_PUBLIC_ORIGIN must be a URL like https://gta.example.com");
    }
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(publicOrigin.hostname);
    if (publicOrigin.protocol !== "https:" && !local) {
      throw new WebConfigError(
        "GTA_PUBLIC_ORIGIN must use https:// (wallet sign-in over plain http isn't safe).",
      );
    }
    if (publicOrigin.pathname !== "/" || publicOrigin.search || publicOrigin.hash) {
      throw new WebConfigError("GTA_PUBLIC_ORIGIN must be just the origin, without a path.");
    }
  }
  if (publicMode && !publicOrigin) {
    throw new WebConfigError(
      "GTA_PUBLIC_MODE=true needs GTA_PUBLIC_ORIGIN (the site's https:// address).",
    );
  }
  return {
    publicMode,
    publicOrigin,
    trustProxy: truthy(env.GTA_TRUST_PROXY),
    ai: {
      messagesPerWalletPerDay: num(env, "AI_MESSAGES_PER_WALLET_DAY", publicMode ? 30 : 0),
      dailyBudgetUsd: num(env, "AI_DAILY_BUDGET_USD", publicMode ? 3 : 0),
    },
  };
}
