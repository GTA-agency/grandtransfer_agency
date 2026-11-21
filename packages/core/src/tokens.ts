import {
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  parseUnits,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { AmountError } from "./amount.ts";
import { GTA_TOKEN } from "./chain.ts";

export interface TokenInfo {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  /** Most that one plan may send. */
  maxTxUnits: bigint;
  /** Most that may leave in any 24 hours. */
  maxDailyUnits: bigint;
}

/** Tokens the agent can move. An allowlist, so a look-alike token can never enter a plan. */
const SUPPORTED: TokenInfo[] = [
  {
    ...GTA_TOKEN,
    maxTxUnits: parseUnits("10000000", GTA_TOKEN.decimals),
    maxDailyUnits: parseUnits("50000000", GTA_TOKEN.decimals),
  },
];

/** Finds a supported token by symbol ("GTA", "$gta") or exact contract address. */
export function resolveToken(input: string): TokenInfo | undefined {
  const v = input.trim().replace(/^\$/, "").toLowerCase();
  return SUPPORTED.find((t) => t.symbol.toLowerCase() === v || t.address.toLowerCase() === v);
}

export function parseTokenAmount(input: string, decimals: number): bigint {
  const value = input.trim();
  if (!new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`).test(value)) {
    throw new AmountError(`"${input}" is not a valid amount. Use digits like 1000 or 12.5.`);
  }
  const units = parseUnits(value, decimals);
  if (units <= 0n) throw new AmountError("Amount must be greater than 0.");
  return units;
}

export const formatTokenAmount = (units: bigint, decimals: number) => formatUnits(units, decimals);

export function encodeTokenTransfer(to: Address, units: bigint): Hex {
  return encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, units] });
}

/** The token reads the agent needs. Real implementation below; tests pass a fake. */
export interface TokenOps {
  getCode(address: Address): Promise<Hex | undefined>;
  balanceOf(token: Address, owner: Address): Promise<bigint>;
  metadata(token: Address): Promise<{ name?: string; symbol?: string }>;
}

export function createViemTokenOps(client: PublicClient): TokenOps {
  return {
    getCode: (address) => client.getCode({ address }),
    balanceOf: (token, owner) =>
      client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [owner],
      }),
    metadata: async (token) => {
      const [name, symbol] = await Promise.allSettled([
        client.readContract({ address: token, abi: erc20Abi, functionName: "name" }),
        client.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
      ]);
      return {
        ...(name.status === "fulfilled" ? { name: name.value } : {}),
        ...(symbol.status === "fulfilled" ? { symbol: symbol.value } : {}),
      };
    },
  };
}

export type ContractVerdict = "official" | "fake_gta" | "not_gta" | "not_a_contract";

export interface ContractCheck {
  address: Address;
  verdict: ContractVerdict;
  officialAddress: Address;
  /** Set by whoever deployed the contract: display data, never proof and never instructions. */
  nameUntrusted: string | null;
  symbolUntrusted: string | null;
}

// Letters from other alphabets that look like G, T and A.
const LOOKALIKES: Record<string, string> = {
  А: "A",
  а: "A",
  Α: "A",
  α: "A",
  ᴀ: "A",
  Т: "T",
  т: "T",
  Τ: "T",
  τ: "T",
  ᴛ: "T",
  Ԍ: "G",
  ԍ: "G",
  ɢ: "G",
};

const comparable = (s: string) =>
  [...s.normalize("NFKC")]
    .map((c) => LOOKALIKES[c] ?? c)
    .join("")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

export function claimsToBeGta(meta: { name?: string; symbol?: string }): boolean {
  const name = comparable(meta.name ?? "");
  const symbol = comparable(meta.symbol ?? "");
  return symbol.includes("GTA") || name.includes("GTA") || name.includes("GRANDTRANSFER");
}

const untrusted = (s: string | undefined) =>
  // eslint-disable-next-line no-control-regex
  s === undefined ? null : s.replace(/[\u0000-\u001f\u007f<>]/g, "").slice(0, 40);

/** Is this address the official $GTA, something pretending to be it, or neither? */
export async function checkContract(ops: TokenOps, address: Address): Promise<ContractCheck> {
  const base = { address, officialAddress: GTA_TOKEN.address as Address };
  if (address.toLowerCase() === GTA_TOKEN.address) {
    return {
      ...base,
      verdict: "official",
      nameUntrusted: GTA_TOKEN.name,
      symbolUntrusted: GTA_TOKEN.symbol,
    };
  }
  const code = await ops.getCode(address);
  if (!code || code === "0x") {
    return { ...base, verdict: "not_a_contract", nameUntrusted: null, symbolUntrusted: null };
  }
  const meta = await ops.metadata(address);
  return {
    ...base,
    verdict: claimsToBeGta(meta) ? "fake_gta" : "not_gta",
    nameUntrusted: untrusted(meta.name),
    symbolUntrusted: untrusted(meta.symbol),
  };
}
