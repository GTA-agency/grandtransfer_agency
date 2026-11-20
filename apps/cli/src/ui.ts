/** Terminal styling in the GTA palette. Falls back to plain text without a color terminal. */

const colorOn = (): boolean =>
  process.stdout.isTTY === true && !process.env.NO_COLOR && process.env.TERM !== "dumb";

const rgb =
  (r: number, g: number, b: number) =>
  (s: string): string =>
    colorOn() ? `\x1b[38;2;${r};${g};${b}m${s}\x1b[39m` : s;
const style =
  (on: number, off: number) =>
  (s: string): string =>
    colorOn() ? `\x1b[${on}m${s}\x1b[${off}m` : s;

export const c = {
  pink: rgb(255, 156, 194),
  hot: rgb(255, 46, 147),
  mint: rgb(159, 227, 200),
  cream: rgb(246, 231, 193),
  lime: rgb(226, 245, 140),
  peach: rgb(247, 197, 159),
  gold: rgb(255, 210, 122),
  red: rgb(255, 95, 122),
  dim: rgb(140, 136, 170),
  bold: style(1, 22),
};

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;
export const visibleLength = (s: string): number => [...s.replace(ANSI, "")].length;
const padEndVisible = (s: string, width: number) =>
  s + " ".repeat(Math.max(0, width - visibleLength(s)));

export interface Out {
  line(text?: string): void;
}
export const stdout: Out = { line: (t = "") => process.stdout.write(`${t}\n`) };

/** A rounded box. `title` sits in the top border. */
export function box(
  lines: string[],
  opts: { title?: string; color?: (s: string) => string; width?: number } = {},
) {
  const paint = opts.color ?? c.pink;
  const inner = Math.max(
    opts.width ?? 0,
    ...lines.map(visibleLength),
    opts.title ? visibleLength(opts.title) + 2 : 0,
  );
  const top = opts.title
    ? `${paint("╭─ ")}${opts.title}${paint(` ${"─".repeat(Math.max(0, inner - visibleLength(opts.title) - 1))}╮`)}`
    : paint(`╭${"─".repeat(inner + 2)}╮`);
  return [
    top,
    ...lines.map((l) => `${paint("│")} ${padEndVisible(l, inner)} ${paint("│")}`),
    paint(`╰${"─".repeat(inner + 2)}╯`),
  ];
}

/** Label/value rows aligned on the label column. */
export function rows(pairs: [string, string][]): string[] {
  const w = Math.max(...pairs.map(([k]) => visibleLength(k)));
  return pairs.map(([k, v]) => `${c.dim(padEndVisible(k, w))}  ${v}`);
}

export function stars(level: number): string {
  const n = Math.max(0, Math.min(5, level));
  return c.gold("★".repeat(n)) + c.dim("☆".repeat(5 - n));
}

export function banner(): string {
  return `${c.hot("★")} ${c.bold(c.pink("GRAND TRANSFER AGENT"))} ${c.hot("★")}`;
}

export function heading(text: string): string {
  return c.bold(c.cream(text.toUpperCase()));
}

export function ok(text: string): string {
  return `${c.mint("✓")} ${text}`;
}

export function warn(text: string): string {
  return `${c.gold("!")} ${text}`;
}

export function fail(text: string): string {
  return `${c.red("✗")} ${text}`;
}

/** Horizontal bar for charts, scaled to `max`. */
export function bar(
  value: bigint,
  max: bigint,
  width: number,
  paint: (s: string) => string,
): string {
  if (max <= 0n || value <= 0n) return "";
  const cells = Number((value * BigInt(width * 8)) / max);
  const full = Math.floor(cells / 8);
  const part = cells % 8;
  return paint("█".repeat(full) + (part ? "▏▎▍▌▋▊▉"[part - 1]! : ""));
}

export const shortHash = (h: string) => (h.startsWith("internal:") ? h : `${h.slice(0, 10)}…`);

const pad2 = (n: number) => String(n).padStart(2, "0");
/** "YYYY-MM-DD" in the machine's local time zone. */
export const localDate = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
/** "YYYY-MM-DD HH:MM" in the machine's local time zone. */
export const localDateTime = (ms: number): string => {
  const d = new Date(ms);
  return `${localDate(ms)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
