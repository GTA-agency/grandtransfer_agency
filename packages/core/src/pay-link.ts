import { isAddress, zeroAddress, type Address } from "viem";
import { GTA_TOKEN } from "./chain.ts";

export const SITE_ORIGIN = "https://grandtransfer.agency";

export type PayAsset = "eth" | "gta";

/** What a payment link asks for. There is no free text on purpose: a link can't carry a pitch. */
export interface PaymentRequest {
  to: Address;
  amount: string;
  asset: PayAsset;
}

const AMOUNT = /^\d{1,27}(\.\d{1,18})?$/;

/** Reads a link's query. Anything invalid means "no request", never a partly filled one. */
export function parsePaymentRequest(params: {
  get(name: string): string | null;
}): PaymentRequest | null {
  const to = params.get("to")?.trim() ?? "";
  const amount = params.get("amount")?.trim() ?? "";
  const asset = (params.get("asset")?.trim().toLowerCase() || "eth") as PayAsset;
  if (!isAddress(to)) return null;
  const lower = to.toLowerCase();
  if (lower === zeroAddress || lower === GTA_TOKEN.address) return null;
  if (!AMOUNT.test(amount) || !/[1-9]/.test(amount)) return null;
  if (asset !== "eth" && asset !== "gta") return null;
  return { to, amount, asset };
}

export function buildPaymentLink(origin: string, r: PaymentRequest): string {
  const q = new URLSearchParams({ to: r.to, amount: r.amount, asset: r.asset });
  return `${origin.replace(/\/$/, "")}/pay?${q.toString()}`;
}
