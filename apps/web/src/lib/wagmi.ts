import { createConfig, http, injected } from "wagmi";
import { DEFAULT_RPC_URLS, robinhoodChain } from "@gta/core/chain";

export const wagmiConfig = createConfig({
  chains: [robinhoodChain],
  // Wallets that support EIP-6963 (Bitget Wallet, MetaMask, Rabby, OKX…) are discovered
  // automatically; this generic connector covers older ones that only set window.ethereum.
  connectors: [injected()],
  multiInjectedProviderDiscovery: true,
  transports: { [robinhoodChain.id]: http(DEFAULT_RPC_URLS[0]) },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
