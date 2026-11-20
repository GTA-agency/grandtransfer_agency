import { createPublicClient, fallback, http, type PublicClient } from "viem";
import { ROBINHOOD_CHAIN_ID, robinhoodChain } from "./chain.ts";

export class WrongChainError extends Error {
  constructor(public readonly actual: number) {
    super(`RPC returned chain ID ${actual}, expected ${ROBINHOOD_CHAIN_ID} (Robinhood Chain).`);
    this.name = "WrongChainError";
  }
}

/** Public client that tries each RPC URL in order and falls back on failure. */
export function createChainClient(rpcUrls: readonly string[]): PublicClient {
  return createPublicClient({
    chain: robinhoodChain,
    transport: fallback(
      rpcUrls.map((url) => http(url, { timeout: 15_000, retryCount: 1 })),
      { rank: false },
    ),
  });
}

/** Throws WrongChainError unless the connected RPC really is Robinhood Chain mainnet. */
export async function assertRobinhoodChain(client: Pick<PublicClient, "getChainId">) {
  const id = await client.getChainId();
  if (id !== ROBINHOOD_CHAIN_ID) throw new WrongChainError(id);
  return id;
}
