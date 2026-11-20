/**
 * ETH/USD spot price for display ("≈ $12.34"). Never used for limits or any money logic:
 * amounts stay exact in wei, the USD figure is a label.
 */

export interface EthUsdQuote {
  /** Decimal string, e.g. "1636.84". */
  usd: string;
  source: string;
  /** When the source was read (ms). */
  at: number;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

interface Source {
  name: string;
  url: string;
  read: (json: unknown) => unknown;
}

const SOURCES: Source[] = [
  {
    name: "CoinGecko",
    url: "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
    read: (j) => (j as { ethereum?: { usd?: unknown } }).ethereum?.usd,
  },
  {
    name: "Coinbase",
    url: "https://api.coinbase.com/v2/prices/ETH-USD/spot",
    read: (j) => (j as { data?: { amount?: unknown } }).data?.amount,
  },
  {
    name: "Kraken",
    url: "https://api.kraken.com/0/public/Ticker?pair=ETHUSD",
    read: (j) => {
      const r = (j as { result?: Record<string, { c?: unknown[] }> }).result;
      const first = r ? Object.values(r)[0] : undefined;
      return first?.c?.[0];
    },
  },
];

const PRICE = /^\d{1,7}(\.\d{1,12})?$/;

/** Tries each source in turn; caches a good answer for `ttlMs`, and keeps a stale one if all fail. */
export class EthUsdPrice {
  private cached: EthUsdQuote | undefined;
  private inflight: Promise<EthUsdQuote | undefined> | undefined;
  private readonly fetchFn: Fetch;

  constructor(
    private readonly opts: {
      fetch?: Fetch;
      ttlMs?: number;
      staleMs?: number;
      now?: () => number;
    } = {},
  ) {
    // Wrapped so Workers don't see fetch called with another `this`.
    this.fetchFn = opts.fetch ?? ((input, init) => fetch(input, init));
  }

  async get(): Promise<EthUsdQuote | undefined> {
    const now = (this.opts.now ?? Date.now)();
    if (this.cached && now - this.cached.at < (this.opts.ttlMs ?? 60_000)) return this.cached;
    this.inflight ??= this.refresh(now).finally(() => (this.inflight = undefined));
    return this.inflight;
  }

  private async refresh(now: number): Promise<EthUsdQuote | undefined> {
    for (const s of SOURCES) {
      try {
        const res = await this.fetchFn(s.url, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) continue;
        const raw = s.read(await res.json());
        const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw : "";
        if (!PRICE.test(text) || Number(text) <= 0) continue;
        this.cached = { usd: text, source: s.name, at: now };
        return this.cached;
      } catch {
        /* next source */
      }
    }
    // Every source failed: a recent-enough old price beats none.
    if (this.cached && now - this.cached.at < (this.opts.staleMs ?? 30 * 60_000)) {
      return this.cached;
    }
    return undefined;
  }
}

/** wei × price → whole cents (bigint math; the price string is parsed exactly). */
export function weiToUsdCents(wei: bigint, usd: string): bigint {
  const [int, frac = ""] = usd.split(".");
  const micro = BigInt(int!) * 1_000_000n + BigInt((frac + "000000").slice(0, 6));
  // wei × micro-dollars ÷ 1e18 wei per ETH ÷ 1e4 micro-dollars per cent, rounded half up
  const div = 10n ** 22n;
  const scaled = wei * micro;
  return scaled >= 0n ? (scaled + div / 2n) / div : -((-scaled + div / 2n) / div);
}

/** "$1,234.56", or "$0" for zero. */
export function formatUsdCents(cents: bigint): string {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  if (abs === 0n) return "$0";
  const dollars = abs / 100n;
  const rest = (abs % 100n).toString().padStart(2, "0");
  const grouped = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}$${grouped}.${rest}`;
}

/** USD label for an amount in wei: "$12.34", "<$0.01" for dust, "$0" for zero. */
export function formatUsd(wei: bigint, usd: string): string {
  const cents = weiToUsdCents(wei, usd);
  if (cents === 0n && wei !== 0n) return wei > 0n ? "<$0.01" : "-<$0.01";
  return formatUsdCents(cents);
}
