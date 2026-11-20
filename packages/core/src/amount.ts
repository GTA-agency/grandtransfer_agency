import { formatEther, parseEther } from "viem";

export class AmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmountError";
  }
}

const ETH_AMOUNT = /^\d+(\.\d{1,18})?$/;

/**
 * Parse a user-facing ETH amount ("0.01", "1", "0.000000000000000001") into wei.
 * Exact decimal math only: no floats, no exponent notation, no commas, max 18 decimals.
 */
export function parseEthAmount(input: string | number): bigint {
  if (typeof input === "number") {
    throw new AmountError("Amount must be a decimal string, not a number (avoids float rounding).");
  }
  const value = input.trim();
  if (!ETH_AMOUNT.test(value)) {
    throw new AmountError(
      `"${input}" is not a valid ETH amount. Use digits like 0.01 (max 18 decimals).`,
    );
  }
  const wei = parseEther(value);
  if (wei <= 0n) throw new AmountError("Amount must be greater than 0.");
  return wei;
}

/** Format wei as an ETH string without trailing zeros, e.g. 10000000000000000n → "0.01". */
export function formatEth(wei: bigint): string {
  return formatEther(wei);
}
