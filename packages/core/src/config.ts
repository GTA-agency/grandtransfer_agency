import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseEther } from "viem";
import { z } from "zod";
import { DEFAULT_RPC_URLS } from "./chain.ts";
import { DEFAULT_ARCHIVE_RPC_URL } from "./ledger/history.ts";

export class ConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid configuration:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "ConfigError";
  }
}

/** A positive ETH amount written as a decimal string, e.g. "0.05". Max 18 decimals. */
const ethAmount = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,18})?$/, "must be a decimal ETH amount like 0.05")
  .transform((v) => parseEther(v))
  .refine((wei) => wei > 0n, "must be greater than 0");

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const schema = z
  .object({
    OPENROUTER_API_KEY: z.preprocess(emptyToUndefined, z.string().trim().min(1).optional()),
    OPENROUTER_MODEL: z.preprocess(
      emptyToUndefined,
      z.string().trim().min(1).default("anthropic/claude-sonnet-5.5"),
    ),
    RPC_URL: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .optional()
        .transform((v, ctx) => {
          if (v === undefined) return [...DEFAULT_RPC_URLS];
          const urls = v
            .split(",")
            .map((u) => u.trim())
            .filter(Boolean);
          for (const u of urls) {
            if (!/^https:\/\/\S+$/.test(u)) {
              ctx.addIssue({ code: "custom", message: `"${u}" is not an https:// URL` });
            }
          }
          if (urls.length === 0) ctx.addIssue({ code: "custom", message: "no URLs given" });
          return urls;
        }),
    ),
    ARCHIVE_RPC_URL: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .trim()
        .regex(/^https:\/\/\S+$/, "must be an https:// URL")
        .default(DEFAULT_ARCHIVE_RPC_URL),
    ),
    DATA_DIR: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .optional()
        .transform((v) => resolve(v ?? join(homedir(), ".grand-transfer-agent"))),
    ),
    // prefault (not default): the default string goes through the same parsing → bigint wei
    MAX_TX_ETH: z.preprocess(emptyToUndefined, ethAmount.prefault("0.05")),
    MAX_DAILY_ETH: z.preprocess(emptyToUndefined, ethAmount.prefault("0.2")),
  })
  .superRefine((c, ctx) => {
    if (c.MAX_TX_ETH > c.MAX_DAILY_ETH) {
      ctx.addIssue({
        code: "custom",
        path: ["MAX_TX_ETH"],
        message: "must not be larger than MAX_DAILY_ETH",
      });
    }
  });

export interface Config {
  openRouterApiKey: string | undefined;
  openRouterModel: string;
  rpcUrls: string[];
  /** Archive-capable RPC used by ledger sync for historical balances. */
  archiveRpcUrl: string;
  dataDir: string;
  maxTxWei: bigint;
  maxDailyWei: bigint;
}

/** Validate an environment object. Pure: does not read files or process.env by itself. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    );
  }
  const c = parsed.data;
  return {
    openRouterApiKey: c.OPENROUTER_API_KEY,
    openRouterModel: c.OPENROUTER_MODEL,
    rpcUrls: c.RPC_URL,
    archiveRpcUrl: c.ARCHIVE_RPC_URL,
    dataDir: c.DATA_DIR,
    maxTxWei: c.MAX_TX_ETH,
    maxDailyWei: c.MAX_DAILY_ETH,
  };
}

/** Walk up from `start` to the folder that holds pnpm-workspace.yaml. */
export function findRepoRoot(start: string = process.cwd()): string | undefined {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** Load <repo root>/.env into process.env (if present), then validate process.env. */
export function loadConfigFromEnv(): Config {
  const root = findRepoRoot();
  const envFile = root ? join(root, ".env") : undefined;
  if (envFile && existsSync(envFile)) process.loadEnvFile(envFile);
  return loadConfig(process.env);
}
