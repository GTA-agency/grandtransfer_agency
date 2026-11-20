import {
  TransferError,
  VaultError,
  explorerAddressUrl,
  formatEth,
  type TransferDraft,
  type TransferResult,
  type TransferService,
  type WalletVault,
} from "@gta/core";
import type { Prompter } from "./prompt.ts";
import { box, c, rows, stars, type Out } from "./ui.ts";

export type SendOutcome =
  | { kind: "sent"; result: TransferResult }
  | { kind: "aborted"; reason: string }
  | { kind: "busted"; reason: string };

export interface SendFlowDeps {
  transfers: Pick<TransferService, "execute">;
  vault: Pick<WalletVault, "isUnlocked" | "unlock">;
  prompt: Pick<Prompter, "ask" | "askHidden">;
  out: Out;
}

const MAX_TRIES = 3;

/** The confirmation box shown before anything is signed. */
export function planBox(d: TransferDraft): string[] {
  const lines = rows([
    ["To", d.contactName ? c.bold(c.cream(d.contactName)) : c.gold("unknown address")],
    ["Address", c.cream(d.to)],
    ["Amount", c.bold(c.cream(`${formatEth(d.amountWei)} ETH`))],
    ["Est. gas", `${formatEth(d.estimatedFeeWei)} ETH ${c.dim("(max)")}`],
    ["Total", c.bold(`${formatEth(d.totalWei)} ETH`)],
    ["Wanted level", stars(d.wantedLevel)],
    ["Network", "Robinhood Chain (4663)"],
  ]);
  if (d.isNewRecipient) {
    lines.push(
      "",
      c.gold("⚠ NEW RECIPIENT: never sent here, not a contact."),
      c.gold("  Check every character of the address."),
    );
  }
  const out = box(lines, { title: c.bold(c.pink("THE PLAN")) });
  // Long URL outside the box so the box fits an 80-column terminal.
  if (d.isNewRecipient) out.push(c.dim(`  Look it up: ${explorerAddressUrl(d.to)}`));
  return out;
}

function successBox(r: TransferResult, d: TransferDraft): string[] {
  const head =
    r.status === "confirmed" ? c.bold(c.lime("CLEAN GETAWAY")) : c.bold(c.gold("ON THE ROAD"));
  const lines = [
    `${formatEth(d.amountWei)} ETH → ${d.contactName ?? d.to}`,
    ...rows([
      ["Tx", r.hash],
      ...(r.feeWei !== undefined
        ? ([["Gas paid", `${formatEth(r.feeWei)} ETH`]] as [string, string][])
        : []),
    ]),
  ];
  if (r.status === "pending") {
    lines.push(
      "",
      c.gold("Sent, still waiting for confirmation. Run `gta sync` later to update it."),
    );
  }
  const out = box(lines, { title: head, color: r.status === "confirmed" ? c.lime : c.gold });
  // Long URL outside the box so the box fits an 80-column terminal.
  out.push(c.dim(`  ${r.explorerUrl}`));
  return out;
}

export function bustedBox(reason: string): string[] {
  return box(
    [c.cream(reason), c.dim("Nothing was sent unless a transaction hash is shown above.")],
    {
      title: c.bold(c.red("BUSTED")),
      color: c.red,
    },
  );
}

/**
 * Show the plan (with a loud warning for new recipients), require an explicit "yes", unlock if
 * needed, then execute. Every exit path is reported to the user.
 */
export async function confirmAndSend(
  draft: TransferDraft,
  deps: SendFlowDeps,
): Promise<SendOutcome> {
  const { out, prompt } = deps;
  for (const l of planBox(draft)) out.line(l);
  out.line();

  const answer = (await prompt.ask(`Type ${c.bold("yes")} to send, anything else to abort: `))
    .trim()
    .toLowerCase();
  if (answer !== "yes") {
    out.line(c.dim("Run aborted. Nothing was sent."));
    return { kind: "aborted", reason: "not confirmed" };
  }

  if (!deps.vault.isUnlocked()) {
    for (let i = 1; ; i++) {
      const password = await prompt.askHidden("Wallet password: ");
      try {
        await deps.vault.unlock(password);
        break;
      } catch (err) {
        if (err instanceof VaultError && err.code === "WRONG_PASSWORD" && i < MAX_TRIES) {
          out.line(c.gold("Wrong password, try again."));
          continue;
        }
        const reason = err instanceof Error ? err.message : String(err);
        for (const l of bustedBox(reason)) out.line(l);
        return { kind: "busted", reason };
      }
    }
  }

  try {
    const result = await deps.transfers.execute(draft.id, { confirmed: true });
    if (result.status === "failed") {
      const reason = `The transaction was mined but reverted. Gas was spent; the ETH did not move. ${result.explorerUrl}`;
      for (const l of bustedBox(reason)) out.line(l);
      return { kind: "busted", reason };
    }
    for (const l of successBox(result, draft)) out.line(l);
    return { kind: "sent", result };
  } catch (err) {
    const reason =
      err instanceof TransferError
        ? err.message
        : `Couldn't send: ${err instanceof Error ? (err.message.split("\n")[0] ?? err.message) : String(err)}`;
    for (const l of bustedBox(reason)) out.line(l);
    return { kind: "busted", reason };
  }
}
