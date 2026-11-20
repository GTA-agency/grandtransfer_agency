"use client";
import { useSyncExternalStore } from "react";
import { parseEther } from "viem";
import { formatUsd } from "@gta/core/price";

/**
 * One shared ETH/USD price for the whole page: fetched from /api/price on first use and every
 * minute while anything shows a USD label. Purely a display aid.
 */
let price: string | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

async function refresh() {
  try {
    const r = await fetch("/api/price", { cache: "no-store" });
    const j = (await r.json()) as { ethUsd?: string | null };
    const next = typeof j.ethUsd === "string" ? j.ethUsd : null;
    if (next !== price) {
      price = next;
      listeners.forEach((l) => l());
    }
  } catch {
    /* keep the last price */
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    void refresh();
    timer = setInterval(refresh, 60_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) clearInterval(timer);
  };
}

/** The current ETH/USD price as a decimal string, or null while unknown. */
export function useEthUsd(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => price,
    () => null,
  );
}

/** "≈ $12.34" for an exact ETH decimal string, or null when the price or amount is unknown. */
export function usdLabel(eth: string | null | undefined, usd: string | null): string | null {
  if (!usd || !eth) return null;
  try {
    const neg = eth.startsWith("-");
    const wei = parseEther(neg ? eth.slice(1) : eth);
    return `≈ ${neg ? "-" : ""}${formatUsd(wei, usd)}`;
  } catch {
    return null;
  }
}
