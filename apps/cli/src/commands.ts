import { writeFileSync } from "node:fs";
import {
  ROBINHOOD_CHAIN_ID,
  TransferError,
  assertRobinhoodChain,
  explorerAddressUrl,
  explorerTxUrl,
  formatEth,
  formatTokenAmount,
  ledgerTxHash,
  planAmount,
  readUsageTotals,
  type PeriodPreset,
  formatUsd,
  VaultError,
} from "@gta/core";
import type { AppContext } from "./context.ts";
import type { Prompter } from "./prompt.ts";
import { confirmAndSend } from "./send-flow.ts";
import {
  banner,
  bar,
  box,
  c,
  fail,
  heading,
  localDate,
  localDateTime,
  ok,
  rows,
  shortHash,
  warn,
  type Out,
} from "./ui.ts";

export interface CommandEnv {
  ctx: AppContext;
  prompt: Prompter;
  out: Out;
}

const PRESETS = ["today", "week", "month", "year", "all"] as const;
const eth = (wei: bigint) => `${formatEth(wei)} ETH`;

export class UsageError extends Error {}

function needWallet(ctx: AppContext) {
  if (!ctx.vault.exists()) throw new UsageError("No wallet yet. Run `gta init` first.");
  return ctx.vault.address;
}

// ---------------------------------------------------------------- init

export async function init(
  { ctx, prompt, out }: CommandEnv,
  opts: { keepUnlocked?: boolean } = {},
): Promise<void> {
  if (ctx.vault.exists()) {
    throw new UsageError(
      `You already have a wallet (${ctx.vault.address}). Refusing to replace it.`,
    );
  }
  out.line(banner());
  out.line();
  out.line("Set up your wallet:");
  out.line(`  ${c.pink("1")}  Create a new wallet`);
  out.line(`  ${c.pink("2")}  Import a recovery phrase`);
  out.line(`  ${c.pink("3")}  Import a private key`);
  const choice = (await prompt.ask("Choose 1, 2 or 3: ")).trim();
  if (!["1", "2", "3"].includes(choice)) throw new UsageError("Pick 1, 2 or 3.");

  let secret = "";
  if (choice === "2") secret = await prompt.askHidden("Recovery phrase (hidden): ");
  if (choice === "3") secret = await prompt.askHidden("Private key (hidden): ");

  const password = await prompt.askHidden("New wallet password (min 8 characters): ");
  if (password !== (await prompt.askHidden("Repeat password: "))) {
    throw new UsageError("Passwords don't match. Nothing was created.");
  }

  let address;
  if (choice === "1") {
    const created = await ctx.vault.create(password);
    address = created.address;
    const words = created.mnemonic.split(" ");
    out.line();
    for (const l of box(
      [
        c.gold("Write these 12 words on paper, in order. Keep them offline."),
        c.gold("Anyone with them can take your funds. They are NOT shown again."),
        "",
        ...[0, 4, 8].map((i) =>
          words
            .slice(i, i + 4)
            .map(
              (w, j) => `${c.dim(String(i + j + 1).padStart(2))} ${c.bold(c.cream(w.padEnd(10)))}`,
            )
            .join(" "),
        ),
      ],
      { title: c.bold(c.pink("RECOVERY PHRASE")) },
    ))
      out.line(l);
    out.line();
    const k = 1 + Math.floor(Math.random() * 12);
    for (let tries = 1; ; tries++) {
      const typed = (await prompt.ask(`To confirm you saved it, type word #${k}: `))
        .trim()
        .toLowerCase();
      if (typed === words[k - 1]) break;
      if (tries >= 3) {
        out.line(
          warn("Skipping the check. Make sure the phrase is written down before adding funds."),
        );
        break;
      }
      out.line(c.gold("Not quite. Check your paper and try again."));
    }
  } else if (choice === "2") {
    address = (await ctx.vault.importMnemonic(secret, password)).address;
  } else {
    address = (await ctx.vault.importPrivateKey(secret, password)).address;
  }

  if (opts.keepUnlocked) await ctx.vault.unlock(password);
  out.line();
  out.line(ok(`Wallet ready: ${c.bold(c.cream(address))}`));
  out.line(c.dim(`  Keystore (encrypted): ${ctx.vault.keystorePath}`));
  try {
    const r = await ctx.sync().sync(address);
    out.line(c.dim(`  Ledger tracking starts at block ${r.toBlock}.`));
  } catch {
    out.line(warn("Couldn't reach the network to start ledger tracking. Run `gta sync` later."));
  }
  if (choice !== "1") {
    out.line(
      c.dim(
        "  Imported a wallet with history? Run `gta sync --from-block N` to backfill The Books.",
      ),
    );
  }
}

// ---------------------------------------------------------------- address / balance

export async function address({ ctx, out }: CommandEnv): Promise<void> {
  const a = needWallet(ctx);
  out.line(c.bold(c.cream(a)));
  out.line(c.dim(explorerAddressUrl(a)));
  out.line(
    c.dim(
      `Network: Robinhood Chain (chain ID ${ROBINHOOD_CHAIN_ID}). Only send Robinhood Chain ETH here.`,
    ),
  );
}

export async function balance({ ctx, out }: CommandEnv): Promise<void> {
  const a = needWallet(ctx);
  await assertRobinhoodChain(ctx.client);
  const wei = await ctx.client.getBalance({ address: a });
  const sent24h = ctx.ledger.sumOutgoingSince(a, Date.now() - 86_400_000);
  const usd = await ctx.ethUsd();
  for (const l of box(
    [
      c.bold(c.cream(eth(wei))) + (usd ? c.dim(`  ≈ ${formatUsd(wei, usd)}`) : ""),
      c.dim(a),
      "",
      ...rows([
        ["Per-run limit", eth(ctx.config.maxTxWei)],
        ["Sent last 24h", `${eth(sent24h)} of ${eth(ctx.config.maxDailyWei)}`],
      ]),
    ],
    { title: c.bold(c.pink("BALANCE")) },
  ))
    out.line(l);
}

// ---------------------------------------------------------------- contacts

export async function contacts({ ctx, out }: CommandEnv, args: string[]): Promise<void> {
  const [sub = "list", ...rest] = args;
  switch (sub) {
    case "list": {
      const list = ctx.contacts.list();
      if (!list.length) {
        out.line(c.dim("No contacts yet. Add one: gta contacts add robinhood 0x…"));
        return;
      }
      const w = Math.max(...list.map((x) => x.name.length));
      for (const x of list) out.line(`${c.pink(x.name.padEnd(w))}  ${c.cream(x.address)}`);
      return;
    }
    case "add": {
      const [name, addr] = [rest.slice(0, -1).join(" "), rest.at(-1)];
      if (!name || !addr) throw new UsageError("Usage: gta contacts add <name> <address>");
      const added = ctx.contacts.add(name, addr);
      out.line(ok(`Saved ${c.bold(added.name)} → ${added.address}`));
      out.line(c.dim("Make sure this address accepts ETH on Robinhood Chain."));
      return;
    }
    case "remove": {
      const name = rest.join(" ");
      if (!name) throw new UsageError("Usage: gta contacts remove <name>");
      ctx.contacts.remove(name);
      out.line(ok(`Removed ${name}.`));
      return;
    }
    case "rename": {
      const [from, to] = rest;
      if (!from || !to) throw new UsageError("Usage: gta contacts rename <old> <new>");
      ctx.contacts.rename(from, to);
      out.line(ok(`Renamed ${from} → ${to}.`));
      return;
    }
    default:
      throw new UsageError(
        "Usage: gta contacts [list | add <name> <address> | remove <name> | rename <old> <new>]",
      );
  }
}

// ---------------------------------------------------------------- send

export async function send({ ctx, prompt, out }: CommandEnv, args: string[]): Promise<boolean> {
  const [amount, ...toParts] = args;
  const to = toParts.join(" ");
  if (!amount || !to)
    throw new UsageError(
      "Usage: gta send <amount> <contact name | address>   e.g. gta send 0.01 robinhood",
    );
  needWallet(ctx);
  let draft;
  try {
    draft = await ctx.transfers.prepare({ to, amountEth: amount });
  } catch (err) {
    if (err instanceof TransferError) {
      out.line(fail(`Can't plan this run: ${err.message}`));
      const candidates = err.details.candidates;
      if (Array.isArray(candidates) && candidates.length)
        out.line(c.dim(`  Did you mean: ${candidates.join(", ")}?`));
      return false;
    }
    throw err;
  }
  const outcome = await confirmAndSend(draft, {
    transfers: ctx.transfers,
    vault: ctx.vault,
    prompt,
    out,
    ethUsd: await ctx.ethUsd(),
  });
  return outcome.kind === "sent";
}

// ---------------------------------------------------------------- chat

export async function chat(
  { ctx, prompt, out }: CommandEnv,
  opts: { banner?: boolean } = {},
): Promise<void> {
  needWallet(ctx);
  // Hosted agent: the first message signs in with this wallet (free, not a transaction).
  const unlock = async () => {
    out.line(
      c.dim(
        "Signing in to the hosted agent at grandtransfer.agency with your wallet (free message, not a transaction).",
      ),
    );
    for (let i = 1; ; i++) {
      const password = await prompt.askHidden("Wallet password: ");
      try {
        await ctx.vault.unlock(password);
        return;
      } catch (err) {
        if (err instanceof VaultError && err.code === "WRONG_PASSWORD" && i < 3) {
          out.line(c.gold("Wrong password, try again."));
          continue;
        }
        throw err;
      }
    }
  };
  const agent = ctx.agent(unlock);
  if (opts.banner !== false) out.line(banner());
  out.line(
    c.dim(
      `Talk to your agent. Try "what's my balance?" or "send 0.01 eth to robinhood". /exit to leave.`,
    ),
  );
  if (ctx.hosted) {
    out.line(c.dim("Free to use, no API key needed. Daily message limit per wallet."));
  }
  for (;;) {
    let text: string;
    try {
      text = (await prompt.ask(`\n${c.pink("you ›")} `)).trim();
    } catch {
      break;
    }
    if (!text) continue;
    if (text === "/exit" || text === "/quit") break;
    if (text === "/help") {
      out.line(
        c.dim(
          "Ask about your balance, contacts or The Books, or tell it who to pay and how much. /exit to leave.",
        ),
      );
      continue;
    }
    let res;
    try {
      res = await agent.send(text);
    } catch (err) {
      out.line(fail(err instanceof Error ? err.message : String(err)));
      continue;
    }
    out.line(`${c.mint("agent ›")} ${res.message}`);

    if (res.contactProposal) {
      const p = res.contactProposal;
      out.line();
      const yes = (
        await prompt.ask(
          `Save contact ${c.bold(p.name)} → ${p.address}? Type ${c.bold("yes")} to save: `,
        )
      )
        .trim()
        .toLowerCase();
      if (yes === "yes") {
        try {
          agent.confirmContact(p.id);
          out.line(ok(`Saved ${p.name}.`));
          agent.noteOutcome(`User saved contact ${p.name} (${p.address}).`);
        } catch (err) {
          out.line(fail(err instanceof Error ? err.message : String(err)));
        }
      } else {
        out.line(c.dim("Not saved."));
        agent.noteOutcome(`User declined to save contact ${p.name}.`);
      }
    }

    if (res.paymentLink) out.line(c.mint(`  ${res.paymentLink.url}`));

    if (res.draft) {
      out.line();
      const outcome = await confirmAndSend(res.draft, {
        transfers: ctx.transfers,
        vault: ctx.vault,
        prompt,
        out,
        ethUsd: await ctx.ethUsd(),
      });
      const d = res.draft;
      const what = `${planAmount(d)} to ${d.contactName ?? d.to}`;
      if (outcome.kind === "sent")
        agent.noteOutcome(
          `User confirmed: sent ${what}, tx ${outcome.result.hash} (${outcome.result.status}).`,
        );
      else if (outcome.kind === "aborted")
        agent.noteOutcome(`User aborted the plan to send ${what}. Nothing was sent.`);
      else agent.noteOutcome(`Sending ${what} failed: ${outcome.reason}`);
    }

    const cost = res.usage.costUsd === undefined ? "" : ` · $${res.usage.costUsd.toFixed(4)}`;
    out.line(c.dim(`  ${res.usage.promptTokens + res.usage.completionTokens} tokens${cost}`));
  }
  out.line(c.dim("See you on the road."));
}

// ---------------------------------------------------------------- books

function preset(v: string | undefined): PeriodPreset {
  if (v === undefined) return "month";
  if (!(PRESETS as readonly string[]).includes(v))
    throw new UsageError(`Period must be one of: ${PRESETS.join(", ")}`);
  return v as PeriodPreset;
}

export async function sync({ ctx, out }: CommandEnv, args: string[]): Promise<void> {
  const a = needWallet(ctx);
  const i = args.indexOf("--from-block");
  const fromBlock = i >= 0 ? Number(args[i + 1]) : undefined;
  if (fromBlock !== undefined && (!Number.isInteger(fromBlock) || fromBlock < 0)) {
    throw new UsageError("--from-block needs a block number.");
  }
  const s = ctx.sync();
  out.line(c.dim("Syncing with Robinhood Chain…"));
  try {
    const r = await s.sync(a, fromBlock !== undefined ? { fromBlock } : {});
    if (r.initialized) {
      out.line(ok(`Tracking starts at block ${r.toBlock}. New activity will show up from now on.`));
      return;
    }
    const found = r.incoming + r.outgoingExternal + r.internalIncoming + r.tokenIncoming;
    out.line(ok(`Up to date at block ${r.toBlock}.`));
    out.line(
      `  ${found === 0 ? c.dim("No new transactions.") : `${c.lime(String(r.incoming))} received · ${r.outgoingExternal} sent elsewhere · ${r.internalIncoming} via contracts · ${r.tokenIncoming} $GTA in`}` +
        (r.settledPending ? ` · ${r.settledPending} pending settled` : "") +
        (r.dropped ? ` · ${r.dropped} dropped by the network (nothing moved)` : ""),
    );
    if (r.unexplained) out.line(warn(`${r.unexplained} balance drop(s) could not be explained.`));
  } catch (err) {
    const cp = s.getCheckpoint(a);
    out.line(
      fail(
        `Sync stopped: ${err instanceof Error ? (err.message.split("\n")[0] ?? err.message) : err}`,
      ),
    );
    if (cp)
      out.line(
        c.dim(`  Progress saved up to block ${cp.lastBlock}. Run gta sync again to continue.`),
      );
    process.exitCode = 1;
  }
}

export async function books({ ctx, out }: CommandEnv, args: string[]): Promise<void> {
  const a = needWallet(ctx);
  const p = preset(args[0]);
  const r = ctx.books.recap(a, ctx.books.period(p, a));
  const range = `${localDate(r.period.from)} → ${localDate(r.period.to - 1)}`;
  const usd = await ctx.ethUsd();
  const approx = (wei: bigint) => (usd && wei !== 0n ? c.dim(`  ≈ ${formatUsd(wei, usd)}`) : "");
  const net =
    (r.totals.netWei >= 0n
      ? c.lime(`+${eth(r.totals.netWei)}`)
      : c.red(`-${eth(-r.totals.netWei)}`)) + approx(r.totals.netWei);
  for (const l of box(
    [
      c.dim(range),
      "",
      ...rows([
        ["Received", c.mint(eth(r.totals.inWei)) + approx(r.totals.inWei)],
        ["Sent", c.pink(eth(r.totals.outWei)) + approx(r.totals.outWei)],
        ["Gas", eth(r.totals.feeWei)],
        ["Net", net],
        [
          "Transactions",
          `${r.totals.count}${r.totals.pending ? c.gold(` (${r.totals.pending} pending)`) : ""}`,
        ],
      ]),
    ],
    { title: c.bold(c.pink(`THE BOOKS · ${p.toUpperCase()}`)) },
  ))
    out.line(l);

  if (r.totals.count === 0) {
    out.line(c.dim("Nothing recorded in this period. Run `gta sync` to pick up incoming ETH."));
    return;
  }
  const active = r.series.filter((s) => s.inWei || s.outWei);
  const max = active.reduce((m, s) => (s.inWei > m ? s.inWei : s.outWei > m ? s.outWei : m), 0n);
  out.line();
  out.line(heading("Activity"));
  for (const s of active) {
    out.line(
      `${c.dim(s.key)}  ${c.mint("in ")} ${bar(s.inWei, max, 24, c.mint).padEnd(1)} ${c.dim(formatEth(s.inWei))}`,
    );
    out.line(
      `${" ".repeat(s.key.length)}  ${c.pink("out")} ${bar(s.outWei, max, 24, c.pink)} ${c.dim(formatEth(s.outWei))}`,
    );
  }
  out.line();
  out.line(heading("By category"));
  for (const x of r.byCategory)
    out.line(
      `  ${x.category.padEnd(16)} ${c.mint(`+${formatEth(x.inWei)}`)}  ${c.pink(`-${formatEth(x.outWei)}`)}`,
    );
  out.line();
  out.line(heading("Top counterparties"));
  for (const x of r.byCounterparty.slice(0, 5))
    out.line(
      `  ${x.label.padEnd(44)} ${c.mint(`+${formatEth(x.inWei)}`)}  ${c.pink(`-${formatEth(x.outWei)}`)}`,
    );
}

export async function history({ ctx, out }: CommandEnv, args: string[]): Promise<void> {
  const a = needWallet(ctx);
  const n = args[0] ? Number(args[0]) : 10;
  const list = ctx.ledger.recent(a, Number.isFinite(n) ? n : 10);
  if (!list.length) {
    out.line(c.dim("No transactions yet."));
    return;
  }
  for (const e of list) {
    const sign = e.direction === "in" ? c.mint("+") : c.pink("-");
    const who = e.contactName ?? (e.source === "internal" ? "contract transfer" : e.counterparty);
    const status =
      e.status === "confirmed"
        ? ""
        : e.status === "pending"
          ? c.gold(" pending")
          : c.red(" failed");
    const extra = [e.category && c.peach(`[${e.category}]`), e.note && c.dim(`“${e.note}”`)]
      .filter(Boolean)
      .join(" ");
    out.line(
      `${c.dim(localDateTime(e.timestamp))}  ${sign}${c.cream((e.token ? `${formatTokenAmount(e.token.amountUnits, e.token.decimals)} ${e.token.symbol}` : formatEth(e.amountWei)).padEnd(20))} ${who}${status} ${extra}`,
    );
    out.line(
      c.dim(
        `                  ${shortHash(ledgerTxHash(e.hash) ?? e.hash)}${ledgerTxHash(e.hash) ? `  ${explorerTxUrl(ledgerTxHash(e.hash)!)}` : ""}`,
      ),
    );
  }
}

export async function exportCsv({ ctx, out }: CommandEnv, args: string[]): Promise<void> {
  const a = needWallet(ctx);
  const file = args.find((x) => x.endsWith(".csv"));
  const p = preset(args.find((x) => (PRESETS as readonly string[]).includes(x)));
  const csv = ctx.books.exportCsv(a, ctx.books.period(p, a));
  const count = csv.trim().split("\r\n").length - 1;
  if (file) {
    writeFileSync(file, csv);
    out.line(ok(`Exported ${count} transactions (${p}) to ${file}`));
  } else {
    process.stdout.write(csv);
  }
}

export async function categories({ ctx, out }: CommandEnv, args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  const name = rest.join(" ");
  if (sub === "add") {
    out.line(ok(`Added category ${ctx.books.addCategory(name)}.`));
  } else if (sub === "remove") {
    ctx.books.removeCategory(name);
    out.line(ok(`Removed category ${name}.`));
  } else if (!sub) {
    for (const x of ctx.books.listCategories())
      out.line(`${c.peach(x.name)}${x.builtin ? "" : c.dim("  (custom)")}`);
  } else {
    throw new UsageError("Usage: gta categories [add <name> | remove <name>]");
  }
}

function resolveEntry(ctx: AppContext, prefix: string | undefined) {
  const a = needWallet(ctx);
  if (!prefix)
    throw new UsageError(
      "Give the transaction hash (at least the first 6 characters, see `gta history`).",
    );
  const found = ctx.ledger.findByPrefix(a, prefix);
  if (found.length === 0) throw new UsageError(`No transaction starting with ${prefix}.`);
  if (found.length > 1 && new Set(found.map((f) => f.hash)).size > 1) {
    throw new UsageError(`More than one transaction starts with ${prefix}. Use more characters.`);
  }
  return { wallet: a, entry: found[0]! };
}

export async function tag({ ctx, out }: CommandEnv, args: string[]): Promise<void> {
  const [prefix, ...rest] = args;
  const category = rest.join(" ");
  if (!category) throw new UsageError("Usage: gta tag <tx hash> <category | none>");
  const { wallet, entry } = resolveEntry(ctx, prefix);
  ctx.books.setCategory(wallet, entry.hash, category.toLowerCase() === "none" ? null : category);
  out.line(
    ok(
      `${shortHash(entry.hash)} → ${category.toLowerCase() === "none" ? "uncategorized" : category}`,
    ),
  );
}

export async function note({ ctx, out }: CommandEnv, args: string[]): Promise<void> {
  const [prefix, ...rest] = args;
  const text = rest.join(" ");
  if (!text) throw new UsageError("Usage: gta note <tx hash> <text | --clear>");
  const { wallet, entry } = resolveEntry(ctx, prefix);
  ctx.books.setNote(wallet, entry.hash, text === "--clear" ? null : text);
  out.line(ok(text === "--clear" ? "Note cleared." : "Note saved."));
}

export async function usage({ ctx, out }: CommandEnv): Promise<void> {
  const t = readUsageTotals(ctx.usagePath);
  for (const l of box(
    rows([
      ["Model", ctx.config.openRouterModel],
      ["AI calls", String(t.calls)],
      ["Tokens", `${t.promptTokens} in · ${t.completionTokens} out`],
      ["Cost so far", `$${t.costUsd.toFixed(4)}`],
    ]),
    { title: c.bold(c.pink("OPENROUTER USAGE")) },
  ))
    out.line(l);
}

export function help(out: Out): void {
  out.line(banner());
  out.line();
  const cmds: [string, string][] = [
    ["", "start here: sets up your wallet if needed, then opens the agent"],
    ["init", "create or import your wallet"],
    ["address", "show your address"],
    ["balance", "ETH balance and limits"],
    ["send <amount> <to>", "send ETH (contact name or address), with confirmation"],
    ["chat", "talk to the agent (free, no API key needed)"],
    ["contacts [add|remove|rename]", "your crew"],
    ["sync [--from-block N]", "pick up incoming ETH"],
    ["books [today|week|month|year|all]", "recap"],
    ["history [n]", "latest transactions"],
    ["tag <hash> <category>", "categorize a transaction"],
    ["note <hash> <text>", "add a note"],
    ["categories [add|remove <name>]", "manage categories"],
    ["export [file.csv] [period]", "CSV export"],
  ];
  for (const l of rows(cmds.map(([k, v]) => [c.pink(`gta ${k}`.trim()), v]))) out.line(`  ${l}`);
}

/**
 * `gta` on its own: ready to use right away. Without a wallet it walks through creating or
 * importing one, then opens the chat (no API key, no other setup).
 */
export async function start(env: CommandEnv): Promise<void> {
  if (!env.ctx.vault.exists()) {
    await init(env, { keepUnlocked: true });
    env.out.line();
    env.out.line(c.dim(`  Starting your agent… (${c.pink("gta help")} lists every command.)`));
    env.out.line();
    await chat(env, { banner: false });
    return;
  }
  await chat(env);
}
