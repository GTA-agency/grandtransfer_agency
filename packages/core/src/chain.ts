import { defineChain } from "viem";

/**
 * Robinhood Chain mainnet.
 *
 * Verified on 2026-11-18:
 * - chain ID 4663 (0x1237) returned by eth_chainId on publicnode and dRPC endpoints,
 *   both serving the same consecutive block heights;
 * - chain ID, RPC list and explorers match the chainlist registry (chainid.network, entry 4663).
 *
 * The official docs (docs.robinhood.com/chain) and the official RPC host could not be reached
 * from the developer's network (blocked by the ISP content filter), so third-party public RPCs
 * are listed first and the official RPC is kept as a last fallback.
 */
export const ROBINHOOD_CHAIN_ID = 4663;

export const DEFAULT_RPC_URLS = [
  "https://robinhood-rpc.publicnode.com",
  "https://robinhood.drpc.org",
  "https://rpc.mainnet.chain.robinhood.com",
] as const;

export const EXPLORER_URL = "https://robinhoodchain.blockscout.com";

export const robinhoodChain = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [...DEFAULT_RPC_URLS] },
  },
  blockExplorers: {
    default: { name: "Blockscout", url: EXPLORER_URL, apiUrl: `${EXPLORER_URL}/api` },
  },
});

export function explorerTxUrl(hash: string): string {
  return `${EXPLORER_URL}/tx/${hash}`;
}

export function explorerAddressUrl(address: string): string {
  return `${EXPLORER_URL}/address/${address}`;
}
