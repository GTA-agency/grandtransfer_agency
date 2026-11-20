import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { userConfigPath } from "@gta/core";
import { looksLikeModelId, looksLikeOpenRouterKey } from "./openrouter-key.ts";
import type { Prompter } from "./prompt.ts";
import { banner, c, ok, warn, type Out } from "./ui.ts";

const DEFAULT_MODEL = "anthropic/claude-sonnet-5.5";
const KEY = "OPENROUTER_API_KEY";
const MODEL = "OPENROUTER_MODEL";

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

function removeValue(lines: string[], key: string): string[] {
  return lines.filter((l) => !new RegExp(`^\\s*${key}\\s*=`).test(l));
}

function save(path: string, lines: string[]): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, lines.join("\n"), { mode: 0o600 });
  chmodSync(path, 0o600);
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
 * `gta setup`: picks how `gta chat` gets its AI. The free hosted agent needs nothing; an own
 * OpenRouter key (saved to ~/.grand-transfer-agent/.env, owner-only) removes the daily limit.
 * Nothing invalid is ever saved. Wallet keys are never stored here.
 */
export async function setup(prompt: Prompter, out: Out): Promise<void> {
  const path = userConfigPath();
  let lines = readLines(path);
  const savedKey = getValue(lines, KEY);
  const currentKey = looksLikeOpenRouterKey(savedKey) ? savedKey : undefined;
  const currentModel = getValue(lines, MODEL);

  out.line(banner());
  out.line();
  out.line(
    `Chat now runs on: ${
      currentKey
        ? c.pink(`your OpenRouter key …${currentKey.slice(-4)}`)
        : c.pink("the free hosted agent (no key needed)")
    }`,
  );
  out.line();
  out.line(`  ${c.pink("1")}  Free hosted agent: nothing to set up, daily message limit`);
  out.line(`  ${c.pink("2")}  My own OpenRouter key: no daily limit, you pay OpenRouter`);
  out.line();
  const choice = (await prompt.ask("Choose 1 or 2 (Enter keeps it as is): ")).trim();

  if (choice === "1") {
    const hadSomething = savedKey !== undefined || currentModel !== undefined;
    lines = removeValue(removeValue(lines, KEY), MODEL);
    if (hadSomething) save(path, lines);
    out.line(ok("Chat uses the free hosted agent. No key needed."));
    out.line(
      c.dim(`  Next: ${c.pink("gta init")} to set up your wallet, then ${c.pink("gta chat")}.`),
    );
    return;
  }

  if (choice !== "2") {
    if (savedKey && !currentKey) {
      // A broken value from an earlier run: drop it so it can't confuse anything later.
      save(path, removeValue(removeValue(lines, KEY), MODEL));
      out.line(warn("Removed a saved key that wasn't a valid OpenRouter key."));
    }
    out.line(ok("Nothing changed."));
    return;
  }

  out.line();
  out.line(
    c.dim("  Get a key at https://openrouter.ai/keys (a few dollars of credit lasts long)."),
  );
  out.line(c.dim(`  It is saved to ${path}, readable only by you.`));
  const hint = currentKey ? ` [Enter keeps …${currentKey.slice(-4)}]` : "";
  let key = (await prompt.askHidden(`OpenRouter API key${hint}: `)).trim();
  if (!key && currentKey) key = currentKey;
  if (!key) {
    out.line(warn("No key entered. Nothing changed."));
    return;
  }
  if (!looksLikeOpenRouterKey(key)) {
    out.line(warn("That isn't an OpenRouter key (they start with sk-or-). Nothing saved."));
    return;
  }
  if (key !== currentKey) {
    const valid = await keyLooksValid(key);
    if (valid === false) {
      out.line(warn("OpenRouter rejected this key. Nothing saved."));
      return;
    }
    if (valid === true) out.line(ok("OpenRouter accepted the key."));
  }

  const keepModel = currentModel && looksLikeModelId(currentModel) ? currentModel : DEFAULT_MODEL;
  let model = (await prompt.ask(`Model [Enter keeps ${keepModel}]: `)).trim() || keepModel;
  if (!looksLikeModelId(model)) {
    out.line(warn(`"${model}" isn't a model id (like ${DEFAULT_MODEL}). Keeping ${keepModel}.`));
    model = keepModel;
  }

  lines = setValue(setValue(lines, KEY, key), MODEL, model);
  save(path, lines);
  out.line();
  out.line(
    ok(`Saved. Chat now uses your own key. Next: ${c.pink("gta init")} if you haven't yet.`),
  );
}
