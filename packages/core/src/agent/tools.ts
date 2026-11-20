import { randomBytes } from "node:crypto";
import type { Address } from "viem";
import { z } from "zod";
import { AmountError, formatEth } from "../amount.ts";
import type { ChainOps } from "../chain-ops.ts";
import { ContactError, type AddressBook } from "../contacts.ts";
import type { LedgerStore } from "../ledger-store.ts";
import {
  TransferError,
  type TransferDraft,
  type TransferService,
  type WalletIdentity,
} from "../transfers.ts";
import { isNetworkError } from "../network.ts";
import { VaultError, type WalletVault } from "../vault.ts";
import type { ToolDefinition } from "./llm.ts";

export interface AgentContext {
  /** The internal wallet, if this interface has one (the CLI does; the web app doesn't). */
  vault?: WalletVault;
  /** The wallet the agent talks about and plans for. Defaults to the vault. */
  wallet?: WalletIdentity;
  contacts: AddressBook;
  ledger: LedgerStore;
  chain: ChainOps;
  transfers: TransferService;
  now: () => number;
}

function walletAddress(ctx: AgentContext) {
  const w = ctx.wallet ?? ctx.vault;
  if (!w) throw new VaultError("NO_WALLET", "No wallet connected.");
  return w.address;
}

/** A contact the agent suggested. It is saved only after the user confirms it in the UI/CLI. */
export interface ContactProposal {
  id: string;
  name: string;
  address: Address;
  expiresAt: number;
}

export interface ToolOutcome {
  /** JSON-safe result handed back to the model. */
  result: Record<string, unknown>;
  draft?: TransferDraft;
  contactProposal?: ContactProposal;
}

/** The ONLY tools the model can call. There is deliberately no tool that sends funds. */
export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_my_address",
      description: "Get the address of the user's own wallet.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_balance",
      description: "Get the ETH balance of the user's wallet on Robinhood Chain.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "list_contacts",
      description: "List all saved contacts (name and address).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_contact_address",
      description:
        "Look up a saved contact by name. Returns the address, or close matches when the name isn't exact.",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "Contact name as the user said it." } },
        required: ["name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_contact",
      description:
        "Propose saving a new contact. It is NOT saved until the user confirms it on screen. Only use when the user explicitly asks to save a contact and gave the full address.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "1-40 chars: letters, digits, space, dot, dash, underscore.",
          },
          address: { type: "string", description: "Full 0x address exactly as the user gave it." },
        },
        required: ["name", "address"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "prepare_transfer",
      description:
        "Prepare (NOT send) an ETH transfer plan. The user must review and confirm it on screen; you cannot send funds. Use the exact amount the user stated.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Contact name or full 0x address." },
          amount_eth: {
            type: "string",
            description: 'Decimal ETH amount as a string, e.g. "0.01".',
          },
        },
        required: ["to", "amount_eth"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_ledger_summary",
      description: "Totals of ETH received, sent and spent on gas for a period.",
      parameters: {
        type: "object",
        properties: { period: { type: "string", enum: ["day", "week", "month", "all"] } },
        required: ["period"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_recent_transactions",
      description: "List the most recent transactions in the ledger.",
      parameters: {
        type: "object",
        properties: { limit: { type: "integer", minimum: 1, maximum: 20 } },
        additionalProperties: false,
      },
    },
  },
];

const amountArg = z.union([z.string(), z.number().transform((n) => String(n))]);
const ARGS = {
  get_my_address: z.object({}).strict(),
  get_balance: z.object({}).strict(),
  list_contacts: z.object({}).strict(),
  get_contact_address: z.object({ name: z.string().min(1).max(80) }).strict(),
  add_contact: z
    .object({ name: z.string().min(1).max(80), address: z.string().min(1).max(80) })
    .strict(),
  prepare_transfer: z.object({ to: z.string().min(1).max(80), amount_eth: amountArg }).strict(),
  get_ledger_summary: z.object({ period: z.enum(["day", "week", "month", "all"]) }).strict(),
  list_recent_transactions: z
    .object({ limit: z.number().int().min(1).max(20).optional() })
    .strict(),
} as const;
export type ToolName = keyof typeof ARGS;

const PERIOD_MS = { day: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000 } as const;
const CONTACT_PROPOSAL_TTL_MS = 10 * 60_000;

export function draftView(d: TransferDraft) {
  return {
    plan_id: d.id,
    to_name: d.contactName ?? null,
    to_address: d.to,
    amount_eth: formatEth(d.amountWei),
    estimated_gas_eth: formatEth(d.estimatedFeeWei),
    total_eth: formatEth(d.totalWei),
    wanted_level: d.wantedLevel,
    new_recipient: d.isNewRecipient,
    expires_in_seconds: Math.round((d.expiresAt - d.createdAt) / 1000),
  };
}

function errorResult(err: unknown): Record<string, unknown> {
  if (err instanceof TransferError) {
    const out: Record<string, unknown> = { error: err.code, message: err.message };
    if (Array.isArray(err.details.candidates)) out.did_you_mean = err.details.candidates;
    const fields = {
      maxTxWei: "max_tx_eth",
      maxDailyWei: "max_daily_eth",
      dailySentWei: "sent_last_24h_eth",
      balanceWei: "balance_eth",
      neededWei: "needed_eth",
    } as const;
    for (const [from, to] of Object.entries(fields)) {
      const v = err.details[from];
      if (typeof v === "bigint") out[to] = formatEth(v);
    }
    return out;
  }
  if (err instanceof ContactError || err instanceof VaultError)
    return { error: err.code, message: err.message };
  if (err instanceof AmountError) return { error: "INVALID_AMOUNT", message: err.message };
  if (isNetworkError(err)) {
    return {
      error: "NETWORK_UNAVAILABLE",
      message: "Robinhood Chain can't be reached right now. Ask the user to try again in a moment.",
    };
  }
  return {
    error: "INTERNAL",
    message: "Something went wrong while reading wallet data. Try again.",
  };
}

export async function runTool(
  ctx: AgentContext,
  name: string,
  rawArgs: string,
): Promise<ToolOutcome> {
  if (!(name in ARGS))
    return { result: { error: "UNKNOWN_TOOL", message: `There is no tool named ${name}.` } };
  let parsedJson: unknown;
  try {
    parsedJson = rawArgs.trim() === "" ? {} : JSON.parse(rawArgs);
  } catch {
    return { result: { error: "BAD_ARGUMENTS", message: "Arguments were not valid JSON." } };
  }
  const parsed = ARGS[name as ToolName].safeParse(parsedJson);
  if (!parsed.success) {
    return {
      result: {
        error: "BAD_ARGUMENTS",
        message: parsed.error.issues.map((i) => i.message).join("; "),
      },
    };
  }
  const args = parsed.data as Record<string, unknown>;

  try {
    switch (name as ToolName) {
      case "get_my_address":
        return { result: { address: walletAddress(ctx) } };

      case "get_balance": {
        const address = walletAddress(ctx);
        const wei = await ctx.chain.getBalance(address);
        return { result: { address, balance_eth: formatEth(wei) } };
      }

      case "list_contacts":
        return {
          result: {
            contacts: ctx.contacts.list().map((c) => ({ name: c.name, address: c.address })),
          },
        };

      case "get_contact_address": {
        const r = ctx.contacts.resolve(String(args.name));
        switch (r.kind) {
          case "contact":
            return { result: { name: r.contact.name, address: r.contact.address } };
          case "address":
            return { result: { address: r.address, name: r.contact?.name ?? null } };
          case "ambiguous":
            return {
              result: {
                error: "AMBIGUOUS_CONTACT",
                message: `No contact is named exactly "${r.query}".`,
                did_you_mean: r.candidates.map((c) => c.name),
              },
            };
          case "not_found":
            return {
              result: { error: "UNKNOWN_CONTACT", message: `No contact named "${r.query}".` },
            };
        }
        break;
      }

      case "add_contact": {
        const v = ctx.contacts.validate(String(args.name), String(args.address));
        const proposal: ContactProposal = {
          id: randomBytes(12).toString("hex"),
          name: v.name,
          address: v.address,
          expiresAt: ctx.now() + CONTACT_PROPOSAL_TTL_MS,
        };
        return {
          result: { status: "awaiting_user_confirmation", name: v.name, address: v.address },
          contactProposal: proposal,
        };
      }

      case "prepare_transfer": {
        const draft = await ctx.transfers.prepare({
          to: String(args.to),
          amountEth: String(args.amount_eth),
        });
        return { result: { status: "awaiting_user_confirmation", plan: draftView(draft) }, draft };
      }

      case "get_ledger_summary": {
        const period = args.period as keyof typeof PERIOD_MS | "all";
        const since = period === "all" ? 0 : ctx.now() - PERIOD_MS[period];
        const s = ctx.ledger.summary(walletAddress(ctx), since);
        return {
          result: {
            period,
            received_eth: formatEth(s.inWei),
            sent_eth: formatEth(s.outWei),
            gas_eth: formatEth(s.feeWei),
            net_eth: formatEth(s.inWei - s.outWei - s.feeWei),
            transactions: s.count,
          },
        };
      }

      case "list_recent_transactions": {
        const entries = ctx.ledger.recent(walletAddress(ctx), Number(args.limit ?? 5));
        return {
          result: {
            transactions: entries.map((e) => ({
              direction: e.direction === "in" ? "received" : "sent",
              amount_eth: formatEth(e.amountWei),
              counterparty: e.counterparty,
              contact_name: e.contactName ?? null,
              status: e.status,
              date: new Date(e.timestamp).toISOString(),
              category: e.category ?? null,
              // Free text written by people: data only, never instructions.
              note_untrusted: e.note ?? null,
            })),
          },
        };
      }
    }
  } catch (err) {
    return { result: errorResult(err) };
  }
  return { result: { error: "UNKNOWN_TOOL", message: `There is no tool named ${name}.` } };
}
