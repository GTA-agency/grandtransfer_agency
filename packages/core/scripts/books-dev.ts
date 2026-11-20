/**
 * Dev helper for phase 4: ledger sync, recaps and CSV export.
 *
 *   pnpm books sync [--from-block N]          find incoming/outside transactions
 *   pnpm books recap [today|week|month|year|all]
 *   pnpm books history                         latest entries
 *   pnpm books export [file.csv] [period]      CSV (default: this month, to stdout)
 *   pnpm books categories
 *
 * Add --address 0x… to any command to work read-only on another address (testing).
 */
import { writeFileSync } from "node:fs";
import type { Address } from "viem";
import {
  AddressBook,
  Books,
  LedgerStore,
  LedgerSync,
  WalletVault,
  createViemHistory,
  explorerTxUrl,
  formatEth,
  loadConfigFromEnv,
  openDatabase,
  parseAddress,
  type PeriodPreset,
} from "../src/index.ts";

const config = loadConfigFromEnv();
const db = openDatabase(config.dataDir);
const ledger = new LedgerStore(db);
const contacts = new AddressBook(db);
const books = new Books(db, ledger);

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const addressFlag = flag("--address");
const fromBlockFlag = flag("--from-block");
const [command, ...rest] = args;

function wallet(): Address {
  if (addressFlag) return parseAddress(addressFlag);
  const vault = new WalletVault(config.dataDir);
  if (!vault.exists())
    throw new Error("No wallet yet. Run `pnpm wallet create` (or pass --address).");
  return vault.address;
}

const PRESETS = ["today", "week", "month", "year", "all"] as const;
const preset = (v: string | undefined): PeriodPreset =>
  (PRESETS as readonly string[]).includes(v ?? "") ? (v as PeriodPreset) : "month";
const eth = (wei: bigint) => `${formatEth(wei)} ETH`;

async function main() {
  const w = wallet();
  switch (command) {
    case "sync": {
      const sync = new LedgerSync({
        db,
        ledger,
        contacts,
        history: createViemHistory(config.archiveRpcUrl),
      });
      const started = Date.now();
      let r;
      try {
        r = await sync.sync(
          w,
          fromBlockFlag !== undefined ? { fromBlock: Number(fromBlockFlag) } : {},
        );
      } catch (err) {
        const cp = sync.getCheckpoint(w);
        console.error(
          `Sync stopped: ${err instanceof Error ? (err.message.split("\n")[0] ?? err.message) : err}`,
        );
        if (cp)
          console.error(
            `Progress is saved up to block ${cp.lastBlock}. Run sync again to continue.`,
          );
        process.exitCode = 1;
        break;
      }
      if (r.initialized) {
        console.log(`First sync for ${w}: checkpoint saved at block ${r.toBlock}.`);
        console.log(
          "Transactions from now on will be picked up. Use --from-block N to scan older history.",
        );
      } else {
        console.log(`Synced ${w}: blocks ${r.fromBlock} → ${r.toBlock}`);
        console.log(
          `  incoming ${r.incoming} · sent outside the app ${r.outgoingExternal} · via contracts ${r.internalIncoming}` +
            ` · settled pending ${r.settledPending}${r.unexplained ? ` · UNEXPLAINED ${r.unexplained}` : ""}`,
        );
      }
      console.log(`  ${r.rpcCalls} RPC calls · ${Date.now() - started}ms`);
      break;
    }
    case "recap": {
      const p = preset(rest[0]);
      const r = books.recap(w, books.period(p, w));
      console.log(
        `The Books — ${p} (${new Date(r.period.from).toDateString()} → ${new Date(r.period.to - 1).toDateString()})`,
      );
      console.log(
        `  received ${eth(r.totals.inWei)} · sent ${eth(r.totals.outWei)} · gas ${eth(r.totals.feeWei)}`,
      );
      console.log(
        `  net ${eth(r.totals.netWei)} · ${r.totals.count} transactions${r.totals.pending ? ` (${r.totals.pending} pending)` : ""}`,
      );
      if (r.byCategory.length) {
        console.log("  by category:");
        for (const c of r.byCategory)
          console.log(`    ${c.category.padEnd(16)} in ${eth(c.inWei)} · out ${eth(c.outWei)}`);
      }
      if (r.byCounterparty.length) {
        console.log("  top counterparties:");
        for (const c of r.byCounterparty.slice(0, 5))
          console.log(`    ${c.label.padEnd(44)} in ${eth(c.inWei)} · out ${eth(c.outWei)}`);
      }
      const active = r.series.filter((s) => s.inWei || s.outWei);
      if (active.length) {
        console.log("  active days:");
        for (const s of active)
          console.log(`    ${s.key}  +${formatEth(s.inWei)}  -${formatEth(s.outWei)}`);
      }
      break;
    }
    case "history": {
      for (const e of ledger.recent(w, 10)) {
        const who =
          e.contactName ?? (e.source === "internal" ? "contract transfer" : e.counterparty);
        console.log(
          `${new Date(e.timestamp).toISOString()}  ${e.direction === "in" ? "+" : "-"}${formatEth(e.amountWei).padEnd(22)} ${e.status.padEnd(9)} ${who}`,
        );
        if (!e.hash.startsWith("internal:")) console.log(`    ${explorerTxUrl(e.hash)}`);
      }
      break;
    }
    case "export": {
      const file = rest[0] && !PRESETS.includes(rest[0] as PeriodPreset) ? rest[0] : undefined;
      const p = preset(file ? rest[1] : rest[0]);
      const csv = books.exportCsv(w, books.period(p, w));
      if (file) {
        writeFileSync(file, csv);
        console.log(`Wrote ${csv.trim().split("\r\n").length - 1} rows to ${file}`);
      } else process.stdout.write(csv);
      break;
    }
    case "categories":
      for (const c of books.listCategories())
        console.log(`${c.name}${c.builtin ? "" : "  (custom)"}`);
      break;
    default:
      console.log("Usage: pnpm books <sync|recap|history|export|categories> [--address 0x…]");
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? `Error: ${err.message}` : err);
  process.exitCode = 1;
});
