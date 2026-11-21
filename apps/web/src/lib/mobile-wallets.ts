export interface MobileWallet {
  id: string;
  name: string;
  /** A link that opens `page` inside the wallet app's own browser. */
  link: (page: URL) => string;
}

// Formats from each wallet's developer docs (checked 2026-11-22).
export const MOBILE_WALLETS: MobileWallet[] = [
  {
    id: "metamask",
    name: "MetaMask",
    link: (p) => `https://link.metamask.io/dapp/${p.host}${p.pathname}${p.search}`,
  },
  {
    id: "bitget",
    name: "Bitget Wallet",
    link: (p) =>
      `https://bkcode.vip?action=dapp&url=${encodeURIComponent(p.origin + p.pathname + p.search)}`,
  },
  {
    id: "trust",
    name: "Trust Wallet",
    link: (p) =>
      `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(p.origin + p.pathname + p.search)}`,
  },
];

/** iPadOS reports a desktop Mac user agent, so touch support tells them apart. */
export function isMobileBrowser(userAgent: string, touchPoints = 0): boolean {
  return (
    /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent) ||
    (/Macintosh/.test(userAgent) && touchPoints > 1)
  );
}
