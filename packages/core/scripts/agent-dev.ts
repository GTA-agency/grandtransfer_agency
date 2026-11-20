/**
 * Dev helper for phase 3: chat with the real agent through OpenRouter.
 * Transfer plans are shown but NEVER executed here (confirmation UI comes in phases 5/6).
 *
 *   pnpm agent                         interactive chat
 *   pnpm agent "what's my balance?"    one message, then exit
 */
import { join } from "node:path";
import {
  AddressBook,
  LedgerStore,
  LlmError,
  OpenRouterClient,
  TransferService,
  WalletAgent,
  WalletVault,
  createChainClient,
  createFileUsageLog,
  createViemChainOps,
  draftView,
  loadConfigFromEnv,
  openDatabase,
  readUsageTotals,
} from "../src/index.ts";
import { ask, closePrompts } from "./prompt.ts";

const config = loadConfigFromEnv();
const db = openDatabase(config.dataDir);
const vault = new WalletVault(config.dataDir);
const contacts = new AddressBook(db);
const ledger = new LedgerStore(db);
const chain = createViemChainOps(createChainClient(config.rpcUrls), config.rpcUrls);
const transfers = new TransferService({
  vault,
  contacts,
  ledger,
  chain,
  limits: { maxTxWei: config.maxTxWei, maxDailyWei: config.maxDailyWei },
});
const usagePath = join(config.dataDir, "usage.jsonl");
const agent = new WalletAgent({
  llm: new OpenRouterClient({ apiKey: config.openRouterApiKey, model: config.openRouterModel }),
  model: config.openRouterModel,
  ctx: { vault, contacts, ledger, chain, transfers, now: Date.now },
  usageLog: createFileUsageLog(usagePath),
});

async function turn(text: string) {
  const started = Date.now();
  const res = await agent.send(text);
  console.log(`\nagent> ${res.message}`);
  if (res.draft) console.log("\n[plan — not executed in dev mode]", draftView(res.draft));
  if (res.contactProposal)
    console.log("\n[contact proposal — not saved in dev mode]", res.contactProposal);
  const cost = res.usage.costUsd === undefined ? "n/a" : `$${res.usage.costUsd.toFixed(5)}`;
  console.log(
    `\n  tools: ${res.toolCalls.map((t) => `${t.name}${t.ok ? "" : "(error)"}`).join(", ") || "none"}` +
      `  ·  tokens: ${res.usage.promptTokens} in / ${res.usage.completionTokens} out` +
      `  ·  cost: ${cost}  ·  ${Date.now() - started}ms`,
  );
}

async function main() {
  console.log(
    `model: ${config.openRouterModel}  ·  wallet: ${vault.exists() ? vault.address : "(none yet)"}`,
  );
  const once = process.argv.slice(2).join(" ").trim();
  if (once) {
    await turn(once);
  } else {
    console.log('Type a message, or "exit".');
    for (;;) {
      const line = (await ask("\nyou> ")).trim();
      if (!line || line === "exit") break;
      await turn(line);
    }
  }
  const t = readUsageTotals(usagePath);
  console.log(
    `\nUsage so far: ${t.calls} calls · ${t.promptTokens + t.completionTokens} tokens · $${t.costUsd.toFixed(4)}`,
  );
}

main()
  .catch((err) => {
    console.error(err instanceof LlmError ? `Error (${err.code}): ${err.message}` : err);
    process.exitCode = 1;
  })
  .finally(closePrompts);
