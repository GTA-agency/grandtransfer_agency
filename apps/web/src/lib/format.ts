export const shortAddr = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

/** Trim an exact ETH string for display: keep up to `max` decimals, never round up. */
export function trimEth(eth: string, max = 6): string {
  const neg = eth.startsWith("-");
  const [i, f = ""] = (neg ? eth.slice(1) : eth).split(".");
  const cut = f.slice(0, max).replace(/0+$/, "");
  const shown = cut ? `${i}.${cut}` : i!;
  if (shown === "0" && /[1-9]/.test(f)) return `${neg ? "-" : ""}<0.${"0".repeat(max - 1)}1`;
  return (neg ? "-" : "") + shown;
}

/** A token amount with thousands separators, e.g. "1,000.5". */
export function fmtToken(amount: string, max = 4): string {
  const t = trimEth(amount, max);
  if (t.startsWith("<")) return t;
  const [i, f] = t.split(".");
  return i!.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f ? `.${f}` : "");
}

const pad = (n: number) => String(n).padStart(2, "0");
export const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
export const fmtDateTime = (ms: number) => {
  const d = new Date(ms);
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Wei string → number of ETH, only for drawing chart geometry (never for money math). */
export const weiToNumber = (wei: string) => Number(BigInt(wei) / 1_000_000_000n) / 1e9;

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
