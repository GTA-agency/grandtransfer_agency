/** Shapes the API sends to the browser. Amounts are exact decimal strings, never floats. */

export type Hex = `0x${string}`;

export interface SessionDto {
  session: { address: Hex } | null;
  network: { chainId: number; name: string; explorer: string };
  limits: { maxTxEth: string; maxDailyEth: string };
  idleMinutes: number;
  /** True when this server serves the public (data per wallet, AI quotas). */
  publicMode: boolean;
}

export interface OverviewDto {
  address: Hex;
  explorerUrl: string;
  balanceEth: string | null;
  balanceError: string | null;
  sentLast24hEth: string;
  dailyUsedPct: number;
  limits: { maxTxEth: string; maxDailyEth: string };
  recent: EntryDto[];
  lastSyncedBlock: number | null;
  /** Today's agent messages when a daily quota applies; null when unlimited. */
  aiMessages: { used: number; limit: number; holder: boolean } | null;
  /** The wallet's $GTA, exact; null when it couldn't be read. */
  gtaBalance: string | null;
}

export interface DraftDto {
  id: string;
  from: Hex;
  to: Hex;
  contactName: string | null;
  amountEth: string;
  estimatedFeeEth: string;
  totalEth: string;
  wantedLevel: number;
  isNewRecipient: boolean;
  dailySentEth: string;
  expiresAt: number;
  explorerAddressUrl: string;
  /** Set when this plan moves a token instead of ETH. */
  token: { symbol: string; address: Hex; amount: string } | null;
}

export interface ResultDto {
  hash: Hex;
  status: "confirmed" | "failed" | "pending";
  explorerUrl: string;
  feeEth: string | null;
}

export interface ProposalDto {
  id: string;
  name: string;
  address: Hex;
}

export interface ChatReplyDto {
  message: string;
  draft: DraftDto | null;
  contactProposal: ProposalDto | null;
  paymentLink: PaymentLinkDto | null;
  costUsd: number | null;
}

export interface PaymentLinkDto {
  url: string;
  amount: string;
  asset: "eth" | "gta";
}

export interface ContactDto {
  name: string;
  address: Hex;
  explorerUrl: string;
}

export interface EntryDto {
  hash: string;
  direction: "in" | "out";
  counterparty: Hex;
  contactName: string | null;
  amountEth: string;
  amountWei: string;
  feeEth: string | null;
  status: "pending" | "confirmed" | "failed";
  timestamp: number;
  category: string | null;
  note: string | null;
  source: "agent" | "sync" | "internal";
  explorerUrl: string;
  /** Set when this run moved a token (amountEth is then 0). */
  token: { symbol: string; amount: string } | null;
}

export type PeriodPreset = "today" | "week" | "month" | "year" | "all";

export interface RecapDto {
  period: { from: number; to: number; bucket: "day" | "month" };
  totals: {
    inEth: string;
    outEth: string;
    feeEth: string;
    netEth: string;
    netNegative: boolean;
    count: number;
    pending: number;
  };
  byCategory: {
    category: string;
    inEth: string;
    outEth: string;
    inWei: string;
    outWei: string;
    count: number;
  }[];
  byCounterparty: {
    label: string;
    address: Hex | null;
    inEth: string;
    outEth: string;
    count: number;
  }[];
  series: {
    key: string;
    start: number;
    inWei: string;
    outWei: string;
    inEth: string;
    outEth: string;
  }[];
  entries: EntryDto[];
}

export interface CategoryDto {
  name: string;
  builtin: boolean;
}

export interface ExternalTxDto {
  draftId: string;
  chainId: number;
  from: Hex;
  to: Hex;
  value: string;
  /** Contract call for a token send. */
  data?: Hex;
  gas: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
}

export interface SyncDto {
  initialized: boolean;
  toBlock: number;
  incoming: number;
  outgoingExternal: number;
  internalIncoming: number;
  tokenIncoming: number;
  settledPending: number;
  dropped: number;
  /** More blocks to go: call sync again to continue. */
  partial: boolean;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}
