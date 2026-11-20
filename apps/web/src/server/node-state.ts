import "server-only";
import { join } from "node:path";
import { createFileUsageLog, loadConfigFromEnv, openDatabase } from "@gta/core";
import { ServerState } from "./state";
import { loadWebConfig } from "./webconfig";

/**
 * Bump when ServerState's shape changes. Each route bundle has its own copy of this module, so
 * the shared instance on globalThis is matched by this tag, not by `instanceof`.
 */
const STATE_VERSION = 4;

const g = globalThis as typeof globalThis & { __gtaState?: ServerState & { __v?: number } };

/** The server state when the web app runs on Node (local `next dev` / `next start`, Docker). */
export function nodeState(): ServerState {
  const cur = g.__gtaState;
  if (cur && cur.__v === STATE_VERSION) return cur;
  if (cur) {
    try {
      cur.db.close?.();
    } catch {
      /* already closed */
    }
  }
  const config = loadConfigFromEnv(); // also loads the repo .env into process.env
  const fresh = Object.assign(
    new ServerState({
      config,
      web: loadWebConfig(process.env),
      db: openDatabase(config.dataDir),
      usageLog: createFileUsageLog(join(config.dataDir, "usage.jsonl")),
    }),
    { __v: STATE_VERSION },
  );
  g.__gtaState = fresh;
  return fresh;
}
