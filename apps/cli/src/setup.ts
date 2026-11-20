import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { userConfigPath } from "@gta/core";
import type { Prompter } from "./prompt.ts";
import { banner, c, ok, warn, type Out } from "./ui.ts";

const DEFAULT_MODEL = "anthropic/claude-sonnet-5.5";

/** Read KEY=value lines (comments and blank lines are kept as-is). */
function readLines(path: string): string[] {
  return existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/) : [];
}

function getValue(lines: string[], key: string): string | undefined {
  for (const l of lines) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l);
    if (m && m[1] === key) return m[2]!.replace(/^["']|["']$/g, "");
  }
  return undefined;
}

function setValue(lines: string[], key: string, value: string): string[] {
  const i = lines.findIndex((l) => new RegExp(`^\\s*${key}\\s*=`).test(l));
  if (i >= 0) {
    const next = [...lines];
    next[i] = `${key}=${value}`;
    return next;
  }
  return [...lines.filter((l, j) => !(j === lines.length - 1 && l === "")), `${key}=${value}`, ""];
}

/** Checks a key against OpenRouter; returns false only when OpenRouter clearly rejects it. */
async function keyLooksValid(key: string): Promise<boolean | undefined> {
  try {
    const r = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (r.status === 401 || r.status === 403) return false;
    return r.ok ? true : undefined;
  } catch {
    return undefined; // offline: can't tell
  }
}

/**
 * `gta setup`: saves the user's own OpenRouter API key (and model) to
 * ~/.grand-transfer-agent/.env with owner-only permissions. Wallet keys are never stored here.
 */
export async function setup(prompt: Prompter, out: Out): Promise<void> {
  const path = userConfigPath();
  let lines = readLines(path);
  const currentKey = getValue(lines, "OPENROUTER_API_KEY");
  const currentModel = getValue(lines, "OPENROUTER_MODEL") ?? DEFAULT_MODEL;

  out.line(banner());
  out.line();
  out.line("The agent uses OpenRouter for its AI. Bring your own key:");
  out.line(c.dim("  https://openrouter.ai/keys  (a few dollars of credit lasts a long time)"));
  out.line(c.dim(`  Saved to ${path}, readable only by you.`));
  out.line();

  const hint = currentKey ? ` [Enter keeps …${currentKey.slice(-4)}]` : "";
  let key = (await prompt.askHidden(`OpenRouter API key${hint}: `)).trim();
  if (!key && currentKey) key = currentKey;
  if (key) {
    if (!/^sk-or-[A-Za-z0-9_-]{10,}$/.test(key)) {
      out.line(warn("That doesn't look like an OpenRouter key (they start with sk-or-)."));
    } else if (key !== currentKey) {
      const valid = await keyLooksValid(key);
      if (valid === false) out.line(warn("OpenRouter rejected this key. Saved anyway; check it."));
      else if (valid === true) out.line(ok("OpenRouter accepted the key."));
    }
    lines = setValue(lines, "OPENROUTER_API_KEY", key);
  } else {
    out.line(c.dim("No key: everything except `gta chat` still works."));
  }

  const model = (await prompt.ask(`Model [${currentModel}]: `)).trim() || currentModel;
  lines = setValue(lines, "OPENROUTER_MODEL", model);

  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, lines.join("\n"), { mode: 0o600 });
  chmodSync(path, 0o600);
  out.line();
  out.line(ok(`Saved. Next: ${c.pink("gta init")} to create or import your wallet.`));
}
