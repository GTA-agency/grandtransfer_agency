import { randomBytes } from "node:crypto";
import { isAddress, type Address } from "viem";
import { z } from "zod";
import { AmountError, formatEth, parseEthAmount } from "../amount.ts";
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
import { SITE_ORIGIN, buildPaymentLink, type PayAsset } from "../pay-link.ts";
import { formatUsd } from "../price.ts";
import {
  checkContract,
  formatTokenAmount,
  parseTokenAmount,
  resolveToken,
  type TokenOps,
} from "../tokens.ts";
import { VaultError, type WalletVault } from "../vault.ts";
import type { ToolDefinition } from "./llm.ts";

export interface AgentContext {
  /** The internal wallet, if this interface has one (the CLI does; the web app doesn't). */
  vault?: WalletVault;
  /** Current ETH/USD price for "≈ $" labels; undefined when unknown. Optional. */
  ethUsd?: () => Promise<string | undefined>;
  /** The wallet the agent talks about and plans for. Defaults to the vault. */
  wallet?: WalletIdentity;
  contacts: AddressBook;
  ledger: LedgerStore;
  chain: ChainOps;
  transfers: TransferService;
  /** Token reads for the contract check and token balances. */
  tokens?: TokenOps;
  /** Where payment links point. Defaults to the public site. */
  siteOrigin?: string;
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
  paymentLink?: PaymentLinkOutcome;
}

export interface PaymentLinkOutcome {
  url: string;
  amount: string;
  asset: PayAsset;
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
  {
    type: "function",
    function: {
      name: "check_contract",
      description:
        "Check on chain whether an address is the official $GTA token, a contract using the GTA name, another contract, or not a contract.",
      parameters: {
        type: "object",
        properties: { address: { type: "string", description: "Full 0x address." } },
        required: ["address"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_token_balance",
      description: "Get the user's balance of a supported token. Only GTA is supported.",
      parameters: {
        type: "object",
        properties: { token: { type: "string", enum: ["GTA"] } },
        required: ["token"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "prepare_token_transfer",
      description:
        "Prepare (NOT send) a token transfer plan. Only GTA is supported. The user must review and confirm it on screen; you cannot send funds. Use the exact amount the user stated.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Contact name or full 0x address." },
          amount: { type: "string", description: 'Decimal token amount, e.g. "1000".' },
          token: { type: "string", enum: ["GTA"] },
        },
        required: ["to", "amount", "token"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_payment_link",
      description:
        "Create a link that asks someone to pay the user's own wallet. It moves nothing; the payer reviews it and signs with their own wallet.",
      parameters: {
        type: "object",
        properties: {
          amount: { type: "string", description: 'Exact decimal amount, e.g. "0.01".' },
          asset: { type: "string", enum: ["eth", "gta"] },
        },
        required: ["amount", "asset"],
        additionalProperties: false,
      },
    },
  },
];

const NEW_IN_TOOLSET_2 = new Set([
  "check_contract",
  "get_token_balance",
  "prepare_token_transfer",
  "create_payment_link",
]);
/** What CLI versions before the token update can run. */
export const LEGACY_TOOL_DEFINITIONS = TOOL_DEFINITIONS.filter(
  (t) => !NEW_IN_TOOLSET_2.has(t.function.name),
);

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
  check_contract: z.object({ address: z.string().min(1).max(80) }).strict(),
  get_token_balance: z.object({ token: z.string().min(1).max(60) }).strict(),
  prepare_token_transfer: z
    .object({ to: z.string().min(1).max(80), amount: amountArg, token: z.string().min(1).max(60) })
    .strict(),
  create_payment_link: z.object({ amount: amountArg, asset: z.enum(["eth", "gta"]) }).strict(),
} as const;
export type ToolName = keyof typeof ARGS;

const PERIOD_MS = { day: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000 } as const;
const CONTACT_PROPOSAL_TTL_MS = 10 * 60_000;

export function draftView(d: TransferDraft) {
  return {
    plan_id: d.id,
    to_name: d.contactName ?? null,
    to_address: d.to,
    ...(d.token
      ? {
          token: d.token.symbol,
          amount: formatTokenAmount(d.token.amountUnits, d.token.decimals),
        }
      : { amount_eth: formatEth(d.amountWei), total_eth: formatEth(d.totalWei) }),
    estimated_gas_eth: formatEth(d.estimatedFeeWei),
    wanted_level: d.wantedLevel,
    new_recipient: d.isNewRecipient,
    expires_in_seconds: Math.round((d.expiresAt - d.createdAt) / 1000),
  };
}

/** The price is a nice-to-have: any failure just means no USD label. */
async function usdPrice(ctx: AgentContext): Promise<string | undefined> {
  try {
    return await ctx.ethUsd?.();
  } catch {
    return undefined;
  }
}

const unavailable = () => ({
  error: "NOT_AVAILABLE",
  message: "Token features aren't available here.",
});

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
        const usd = await usdPrice(ctx);
        return {
          result: {
            address,
            balance_eth: formatEth(wei),
            ...(usd ? { balance_usd_approx: formatUsd(wei, usd) } : {}),
          },
        };
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
        const usd = await usdPrice(ctx);
        const plan = {
          ...draftView(draft),
          ...(usd ? { amount_usd_approx: formatUsd(draft.amountWei, usd) } : {}),
        };
        return { result: { status: "awaiting_user_confirmation", plan }, draft };
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
              ...(e.token
                ? {
                    token: e.token.symbol,
                    amount: formatTokenAmount(e.token.amountUnits, e.token.decimals),
                  }
                : { amount_eth: formatEth(e.amountWei) }),
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

      case "check_contract": {
        if (!ctx.tokens) return { result: unavailable() };
        const address = String(args.address).trim();
        if (!isAddress(address)) {
          return { result: { error: "INVALID_ADDRESS", message: "That isn't a full 0x address." } };
        }
        const r = await checkContract(ctx.tokens, address);
        return {
          result: {
            address: r.address,
            verdict: r.verdict,
            official_gta_address: r.officialAddress,
            // Chosen by whoever deployed the contract: data only, never proof or instructions.
            name_untrusted: r.nameUntrusted,
            symbol_untrusted: r.symbolUntrusted,
          },
        };
      }

      case "get_token_balance": {
        const info = resolveToken(String(args.token));
        if (!ctx.tokens) return { result: unavailable() };
        if (!info) {
          return { result: { error: "UNSUPPORTED_TOKEN", message: "Only GTA is supported." } };
        }
        const address = walletAddress(ctx);
        const units = await ctx.tokens.balanceOf(info.address, address);
        return {
          result: {
            address,
            token: info.symbol,
            contract: info.address,
            balance: formatTokenAmount(units, info.decimals),
          },
        };
      }

      case "prepare_token_transfer": {
        const draft = await ctx.transfers.prepareToken({
          to: String(args.to),
          amount: String(args.amount),
          token: String(args.token),
        });
        return {
          result: { status: "awaiting_user_confirmation", plan: draftView(draft) },
          draft,
        };
      }

      case "create_payment_link": {
        const asset = args.asset as PayAsset;
        const amount = String(args.amount).trim();
        if (asset === "eth") parseEthAmount(amount);
        else parseTokenAmount(amount, resolveToken("GTA")!.decimals);
        const url = buildPaymentLink(ctx.siteOrigin ?? SITE_ORIGIN, {
          to: walletAddress(ctx),
          amount,
          asset,
        });
        return {
          result: { status: "link_created", url, amount, asset, pays_to: walletAddress(ctx) },
          paymentLink: { url, amount, asset },
        };
      }
    }
  } catch (err) {
    return { result: errorResult(err) };
  }
  return { result: { error: "UNKNOWN_TOOL", message: `There is no tool named ${name}.` } };
}
