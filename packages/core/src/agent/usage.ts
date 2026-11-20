import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export interface UsageRecord {
  timestamp: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number | undefined;
}

export interface UsageLog {
  record(entry: UsageRecord): void;
}

/** Appends one JSON line per LLM call. Holds token counts and cost only, never message content. */
export function createFileUsageLog(path: string): UsageLog {
  return {
    record(entry) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      appendFileSync(path, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    },
  };
}

export function readUsageTotals(path: string): {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
} {
  const totals = { calls: 0, promptTokens: 0, completionTokens: 0, costUsd: 0 };
  if (!existsSync(path)) return totals;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as UsageRecord;
      totals.calls += 1;
      totals.promptTokens += r.promptTokens;
      totals.completionTokens += r.completionTokens;
      totals.costUsd += r.costUsd ?? 0;
    } catch {
      // skip a corrupt line rather than failing the whole report
    }
  }
  return totals;
}
