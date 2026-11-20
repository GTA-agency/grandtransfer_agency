import { randomBytes } from "node:crypto";
import type { Address, Hash } from "viem";
import { AmountError, parseEthAmount } from "./amount.ts";
import { ROBINHOOD_CHAIN_ID, explorerTxUrl } from "./chain.ts";
import type { ChainOps } from "./chain-ops.ts";
import { ContactError, type AddressBook, type Contact } from "./contacts.ts";
import type { LedgerStore } from "./ledger-store.ts";
import { isNetworkError } from "./network.ts";
import { VaultError, type WalletVault } from "./vault.ts";

export type TransferErrorCode =
  | "INVALID_AMOUNT"
  | "INVALID_ADDRESS"
  | "UNKNOWN_RECIPIENT"
  | "AMBIGUOUS_RECIPIENT"
  | "SELF_TRANSFER"
  | "NO_WALLET"
  | "WALLET_LOCKED"
  | "WRONG_CHAIN"
  | "OVER_TX_LIMIT"
  | "OVER_DAILY_LIMIT"
  | "INSUFFICIENT_BALANCE"
  | "DRAFT_NOT_FOUND"
  | "DRAFT_EXPIRED"
  | "DRAFT_USED"
  | "NOT_CONFIRMED"
  | "GAS_ESTIMATE_FAILED"
  | "NOT_AUTHORIZED"
  | "TX_NOT_FOUND"
  | "TX_MISMATCH"
  | "NETWORK_UNAVAILABLE"
  | "SEND_FAILED";

export class TransferError extends Error {
  constructor(
    public readonly code: TransferErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "TransferError";
  }
}

export interface TransferDraft {
  id: string;
  from: Address;
  to: Address;
  contactName: string | undefined;
  amountWei: bigint;
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  /** Upper bound: gasLimit × maxFeePerGas. The real fee is usually lower. */
  estimatedFeeWei: bigint;
  totalWei: bigint;
  /** 1–5 stars: how big this run is relative to the per-transaction limit (+1 if new recipient). */
  wantedLevel: number;
  isNewRecipient: boolean;
  dailySentWei: bigint;
  createdAt: number;
  expiresAt: number;
}

export interface Confirmation {
  /** Must be literally `true`, set only by an explicit user action (button / typed "yes"). */
  confirmed: boolean;
}

export interface TransferResult {
  hash: Hash;
  status: "confirmed" | "failed" | "pending";
  explorerUrl: string;
  feeWei: bigint | undefined;
  blockNumber: bigint | undefined;
}

/** The exact transaction an external wallet (MetaMask) is asked to sign for an authorized plan. */
export interface ExternalTxRequest {
  draftId: string;
  chainId: number;
  from: Address;
  to: Address;
  value: bigint;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

/** Whose wallet plans are made for. The vault is one; a connected MetaMask address is another. */
export interface WalletIdentity {
  /** Throws (VaultError NO_WALLET) when there is no wallet. */
  readonly address: Address;
}

export interface TransferLimits {
  maxTxWei: bigint;
  maxDailyWei: bigint;
}

export interface TransferServiceDeps {
  /** Signs internal-wallet sends. Absent where only external wallets are used (the web app). */
  vault?: WalletVault;
  /** The wallet plans are made for. Defaults to the vault. */
  wallet?: WalletIdentity;
  contacts: AddressBook;
  ledger: LedgerStore;
  chain: ChainOps;
  limits: TransferLimits;
  now?: () => number;
  draftTtlMs?: number;
  receiptTimeoutMs?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

type StoredDraft = TransferDraft & {
  used: boolean;
  /** Set when an external wallet was cleared to sign this plan; recordExternal() needs it. */
  external?: "authorized" | "recorded";
};

/** Stars for the confirmation screen. Purely informational; limits are enforced separately. */
export function wantedLevel(amountWei: bigint, maxTxWei: bigint, isNewRecipient: boolean): number {
  const pct = Number((amountWei * 100n) / maxTxWei);
  const base = pct <= 20 ? 1 : pct <= 40 ? 2 : pct <= 60 ? 3 : pct <= 80 ? 4 : 5;
  return Math.min(5, base + (isNewRecipient ? 1 : 0));
}

/**
 * Two-step transfers. prepare() builds a draft and checks everything; nothing is signed.
 * execute() only accepts an unexpired, unused draft plus an explicit user confirmation,
 * re-checks chain, balance and limits, then signs and sends.
 *
 * The AI agent may call prepare() but never execute(): execution is wired to the UI/CLI only.
 */
/** How long an external wallet gets to sign an authorized plan before its reservation lapses. */
const EXTERNAL_RESERVATION_MS = 15 * 60_000;

export class TransferService {
  private readonly drafts = new Map<string, StoredDraft>();
  /**
   * Amounts cleared to be signed but not yet in the ledger. They count toward the daily limit,
   * so two confirmations at the same moment can't both squeeze under it.
   */
  private readonly reservations = new Map<
    string,
    { from: Address; amountWei: bigint; until: number }
  >();
  /** Serializes the "re-check limits, then reserve" step. */
  private gate: Promise<unknown> = Promise.resolve();
  private readonly now: () => number;
  private readonly draftTtlMs: number;
  private readonly receiptTimeoutMs: number;

  constructor(private readonly deps: TransferServiceDeps) {
    this.now = deps.now ?? Date.now;
    this.draftTtlMs = deps.draftTtlMs ?? 2 * 60_000;
    this.receiptTimeoutMs = deps.receiptTimeoutMs ?? 120_000;
  }

  async prepare(input: { to: string; amountEth: string }): Promise<TransferDraft> {
    this.pruneDrafts();
    const from = this.walletAddress();
    const amountWei = this.parseAmount(input.amountEth);
    const { address: to, contact } = this.resolveRecipient(input.to);
    if (to.toLowerCase() === from.toLowerCase()) {
      throw new TransferError("SELF_TRANSFER", "That's your own wallet address.");
    }

    await this.assertChain();
    const dailySentWei = this.checkLimits(from, amountWei);

    // Balance first: nodes refuse to estimate gas for a value the wallet can't cover, and that
    // refusal is easy to misread as a network failure.
    const balance = await this.net(() => this.deps.chain.getBalance(from));
    if (balance < amountWei) {
      throw new TransferError("INSUFFICIENT_BALANCE", "Not enough ETH for this amount.", {
        balanceWei: balance,
        neededWei: amountWei,
      });
    }
    let gasEstimate: bigint;
    let fees: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };
    try {
      [gasEstimate, fees] = await Promise.all([
        this.deps.chain.estimateGas({ from, to, value: amountWei }),
        this.deps.chain.estimateFees(),
      ]);
    } catch {
      throw new TransferError(
        "GAS_ESTIMATE_FAILED",
        "Couldn't estimate gas for this transfer (network problem or the node rejected it). Try again shortly.",
      );
    }
    const gasLimit = (gasEstimate * 120n) / 100n; // 20% headroom (L2 data cost can move)
    const estimatedFeeWei = gasLimit * fees.maxFeePerGas;
    const totalWei = amountWei + estimatedFeeWei;
    if (balance < totalWei) {
      throw new TransferError("INSUFFICIENT_BALANCE", "Not enough ETH for this amount plus gas.", {
        balanceWei: balance,
        neededWei: totalWei,
      });
    }

    const isNewRecipient = !contact && !this.deps.ledger.hasSentTo(from, to);
    const createdAt = this.now();
    const draft: TransferDraft = {
      id: randomBytes(16).toString("hex"),
      from,
      to,
      contactName: contact?.name,
      amountWei,
      gasLimit,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      estimatedFeeWei,
      totalWei,
      wantedLevel: wantedLevel(amountWei, this.deps.limits.maxTxWei, isNewRecipient),
      isNewRecipient,
      dailySentWei,
      createdAt,
      expiresAt: createdAt + this.draftTtlMs,
    };
    this.drafts.set(draft.id, { ...draft, used: false });
    return draft;
  }

  getDraft(id: string): TransferDraft | undefined {
    const d = this.drafts.get(id);
    if (!d) return undefined;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { used: _used, external: _external, ...draft } = d;
    return draft;
  }

  async execute(draftId: string, confirmation: Confirmation): Promise<TransferResult> {
    const draft = this.checkConfirmation(draftId, confirmation);

    let account;
    try {
      if (!this.deps.vault)
        throw new TransferError("NO_WALLET", "This app has no internal wallet.");
      account = this.deps.vault.getAccount();
    } catch (err) {
      if (err instanceof VaultError && err.code === "LOCKED") {
        throw new TransferError("WALLET_LOCKED", "Wallet is locked. Unlock it and try again.");
      }
      if (err instanceof VaultError && err.code === "NO_WALLET") {
        throw new TransferError("NO_WALLET", err.message);
      }
      throw err;
    }
    if (account.address.toLowerCase() !== draft.from.toLowerCase()) {
      throw new TransferError("DRAFT_NOT_FOUND", "That plan belongs to a different wallet.");
    }

    // Single use from here on, even if a later check fails.
    draft.used = true;
    await this.recheckAndReserve(draft, this.now() + 5 * 60_000);

    let hash: Hash;
    try {
      hash = await this.deps.chain.sendTransaction(account, {
        to: draft.to,
        value: draft.amountWei,
        gas: draft.gasLimit,
        maxFeePerGas: draft.maxFeePerGas,
        maxPriorityFeePerGas: draft.maxPriorityFeePerGas,
      });
    } catch {
      this.reservations.delete(draft.id);
      // We can't be sure the node didn't broadcast it before failing, so never retry blindly.
      throw new TransferError(
        "SEND_FAILED",
        "The network didn't confirm it received the transaction. Run a sync before trying again, so nothing gets sent twice.",
      );
    }
    return this.recordAndSettle(draft, hash);
  }

  /**
   * External wallet (MetaMask), step 1: the same confirmation and re-checks as execute(), then
   * return the exact transaction to sign. The plan is single use from here on.
   */
  async authorizeExternal(draftId: string, confirmation: Confirmation): Promise<ExternalTxRequest> {
    const draft = this.checkConfirmation(draftId, confirmation);
    draft.used = true;
    await this.recheckAndReserve(draft, this.now() + EXTERNAL_RESERVATION_MS);
    draft.external = "authorized";
    return {
      draftId: draft.id,
      chainId: ROBINHOOD_CHAIN_ID,
      from: draft.from,
      to: draft.to,
      value: draft.amountWei,
      gas: draft.gasLimit,
      maxFeePerGas: draft.maxFeePerGas,
      maxPriorityFeePerGas: draft.maxPriorityFeePerGas,
    };
  }

  /**
   * External wallet, step 2: after the wallet broadcast the transaction, check on chain that it
   * is the authorized plan (sender, recipient, amount, chain), record it and wait for the receipt.
   */
  async recordExternal(draftId: string, hash: Hash): Promise<TransferResult> {
    const draft = this.drafts.get(draftId);
    if (!draft || draft.external !== "authorized") {
      throw new TransferError(
        "NOT_AUTHORIZED",
        "That plan wasn't authorized for an external wallet.",
      );
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
      throw new TransferError("TX_NOT_FOUND", "That isn't a transaction hash.");
    }
    const tx = await this.net(() => this.deps.chain.getTransaction(hash));
    if (!tx) {
      throw new TransferError(
        "TX_NOT_FOUND",
        "The network doesn't know this transaction yet. Run a sync later to pick it up.",
      );
    }
    const same = (a: string | null, b: string) => a !== null && a.toLowerCase() === b.toLowerCase();
    if (
      !same(tx.from, draft.from) ||
      !same(tx.to, draft.to) ||
      tx.value !== draft.amountWei ||
      tx.chainId !== ROBINHOOD_CHAIN_ID
    ) {
      throw new TransferError(
        "TX_MISMATCH",
        "That transaction doesn't match the plan you confirmed. A sync will still log whatever was sent.",
      );
    }
    draft.external = "recorded";
    return this.recordAndSettle(draft, hash);
  }

  /** Draft lookup plus the user's confirmation, shared by both send paths. */
  private checkConfirmation(draftId: string, confirmation: Confirmation): StoredDraft {
    const draft = this.drafts.get(draftId);
    if (!draft)
      throw new TransferError("DRAFT_NOT_FOUND", "That plan doesn't exist. Prepare a new one.");
    if (draft.used)
      throw new TransferError("DRAFT_USED", "That plan was already used. Prepare a new one.");
    if (this.now() > draft.expiresAt) {
      throw new TransferError(
        "DRAFT_EXPIRED",
        "That plan expired. Prepare a new one to get fresh gas prices.",
      );
    }
    if (confirmation.confirmed !== true) {
      throw new TransferError("NOT_CONFIRMED", "The transfer was not confirmed.");
    }
    return draft;
  }

  /**
   * Chain, limits and balance again, right before signing, then reserve the amount against the
   * daily limit until it is in the ledger. One draft at a time passes through here, so
   * simultaneous confirmations are counted against each other.
   */
  private recheckAndReserve(draft: TransferDraft, until: number): Promise<void> {
    const run = this.gate.then(async () => {
      await this.recheck(draft);
      this.reservations.set(draft.id, { from: draft.from, amountWei: draft.amountWei, until });
    });
    this.gate = run.catch(() => undefined);
    return run;
  }

  private async recheck(draft: TransferDraft): Promise<void> {
    await this.assertChain();
    this.checkLimits(draft.from, draft.amountWei);
    const balance = await this.net(() => this.deps.chain.getBalance(draft.from));
    if (balance < draft.totalWei) {
      throw new TransferError(
        "INSUFFICIENT_BALANCE",
        "Not enough ETH any more for this amount plus gas.",
        {
          balanceWei: balance,
          neededWei: draft.totalWei,
        },
      );
    }
  }

  private async recordAndSettle(draft: TransferDraft, hash: Hash): Promise<TransferResult> {
    this.deps.ledger.recordOutgoingPending({
      hash,
      wallet: draft.from,
      to: draft.to,
      contactName: draft.contactName,
      amountWei: draft.amountWei,
      timestamp: this.now(),
    });
    // From here the ledger counts it toward the limit.
    this.reservations.delete(draft.id);

    try {
      const receipt = await this.deps.chain.waitForReceipt(hash, this.receiptTimeoutMs);
      const status = receipt.status === "success" ? "confirmed" : "failed";
      const feeWei = receipt.gasUsed * receipt.effectiveGasPrice;
      this.deps.ledger.markSettled(hash, status, feeWei, receipt.blockNumber);
      return {
        hash,
        status,
        explorerUrl: explorerTxUrl(hash),
        feeWei,
        blockNumber: receipt.blockNumber,
      };
    } catch {
      // Sent, but no receipt yet. It stays "pending" in the ledger and still counts toward limits.
      return {
        hash,
        status: "pending",
        explorerUrl: explorerTxUrl(hash),
        feeWei: undefined,
        blockNumber: undefined,
      };
    }
  }

  private walletAddress(): Address {
    try {
      const w = this.deps.wallet ?? this.deps.vault;
      if (!w) throw new TransferError("NO_WALLET", "No wallet connected.");
      return w.address;
    } catch (err) {
      if (err instanceof VaultError) throw new TransferError("NO_WALLET", err.message);
      throw err;
    }
  }

  private parseAmount(amountEth: string): bigint {
    try {
      return parseEthAmount(amountEth);
    } catch (err) {
      if (err instanceof AmountError) throw new TransferError("INVALID_AMOUNT", err.message);
      throw err;
    }
  }

  private resolveRecipient(input: string): { address: Address; contact: Contact | undefined } {
    let r;
    try {
      r = this.deps.contacts.resolve(input);
    } catch (err) {
      if (err instanceof ContactError) throw new TransferError("INVALID_ADDRESS", err.message);
      throw err;
    }
    switch (r.kind) {
      case "contact":
        return { address: r.contact.address, contact: r.contact };
      case "address":
        return { address: r.address, contact: r.contact };
      case "ambiguous":
        throw new TransferError(
          "AMBIGUOUS_RECIPIENT",
          `No contact is named exactly "${r.query}".`,
          {
            candidates: r.candidates.map((c) => c.name),
          },
        );
      case "not_found":
        throw new TransferError(
          "UNKNOWN_RECIPIENT",
          `No contact named "${r.query}" and it isn't an address.`,
        );
    }
  }

  /** Chain reads: a node that can't be reached becomes a clear, coded error. */
  private async net<T>(read: () => Promise<T>): Promise<T> {
    try {
      return await read();
    } catch (err) {
      if (!(err instanceof TransferError) && isNetworkError(err)) {
        throw new TransferError(
          "NETWORK_UNAVAILABLE",
          "Couldn't reach Robinhood Chain right now. Nothing was sent. Try again in a moment.",
        );
      }
      throw err;
    }
  }

  private async assertChain(): Promise<void> {
    const id = await this.net(() => this.deps.chain.getChainId());
    if (id !== ROBINHOOD_CHAIN_ID) {
      throw new TransferError(
        "WRONG_CHAIN",
        `Connected to chain ${id}, expected Robinhood Chain (${ROBINHOOD_CHAIN_ID}).`,
      );
    }
  }

  /** Enforces both limits; returns what was already sent in the last 24h. */
  private checkLimits(from: Address, amountWei: bigint): bigint {
    const { maxTxWei, maxDailyWei } = this.deps.limits;
    if (amountWei > maxTxWei) {
      throw new TransferError("OVER_TX_LIMIT", "That's above your per-transaction limit.", {
        maxTxWei,
      });
    }
    const t = this.now();
    let reservedWei = 0n;
    for (const [id, r] of this.reservations) {
      if (t > r.until) this.reservations.delete(id);
      else if (r.from.toLowerCase() === from.toLowerCase()) reservedWei += r.amountWei;
    }
    const dailySentWei = this.deps.ledger.sumOutgoingSince(from, t - DAY_MS) + reservedWei;
    if (dailySentWei + amountWei > maxDailyWei) {
      throw new TransferError("OVER_DAILY_LIMIT", "That would go over your 24-hour limit.", {
        maxDailyWei,
        dailySentWei,
      });
    }
    return dailySentWei;
  }

  private pruneDrafts(): void {
    const t = this.now();
    for (const [id, d] of this.drafts)
      // Keep plans an external wallet is still signing; recordExternal() needs them.
      if (d.external === "authorized" && t <= d.expiresAt + EXTERNAL_RESERVATION_MS) continue;
      else if (d.used || t > d.expiresAt + 60_000) this.drafts.delete(id);
  }
}
