"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EntryDto, OverviewDto, SyncDto } from "@/shared/types";
import { api } from "./api";
import { fmtToken, shortAddr, trimEth } from "./format";
import { usdLabel } from "./usd";

const CHECK_EVERY_MS = 60_000;
const PREF_KEY = "gta.notify-incoming";

const amountOf = (e: EntryDto) =>
  e.token ? `${fmtToken(e.token.amount)} ${e.token.symbol}` : `${trimEth(e.amountEth)} ETH`;
const usdOf = (e: EntryDto, ethUsd: string | null) =>
  e.token ? null : usdLabel(e.amountEth, ethUsd);

export type NotifyState = "on" | "off" | "blocked" | "unsupported";

function readPref(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) === "1";
  } catch {
    return false;
  }
}
function writePref(on: boolean) {
  try {
    localStorage.setItem(PREF_KEY, on ? "1" : "0");
  } catch {
    /* storage unavailable: the switch just won't be remembered */
  }
}

function permission(): NotifyState {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  return Notification.permission === "granted" && readPref() ? "on" : "off";
}

/**
 * Watches the chain for ETH and $GTA arriving while the dashboard is open (also in a background tab):
 * syncs every minute, and for every new incoming entry calls `onIncoming` and, when the user
 * switched it on, shows a browser notification.
 */
export function useIncomingWatch(opts: {
  ethUsd: string | null;
  onIncoming: (entries: EntryDto[], overview: OverviewDto) => void;
}) {
  const [notify, setNotify] = useState<NotifyState>("off");
  const seen = useRef<Set<string> | null>(null);
  const latest = useRef(opts);
  latest.current = opts;

  useEffect(() => setNotify(permission()), []);

  const toggle = useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (notify === "on") {
      writePref(false);
      setNotify("off");
      return;
    }
    const p =
      Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;
    writePref(p === "granted");
    setNotify(p === "granted" ? "on" : p === "denied" ? "blocked" : "off");
  }, [notify]);

  useEffect(() => {
    let stopped = false;
    const check = async () => {
      try {
        if (seen.current === null) {
          // First look: everything already on the record is old news.
          const o = await api<OverviewDto>("/api/overview");
          seen.current = new Set(o.recent.filter((e) => e.direction === "in").map((e) => e.hash));
        }
        const r = await api<SyncDto>("/api/books/sync", { body: {} });
        if (stopped || r.incoming + r.internalIncoming + r.tokenIncoming === 0) return;
        const o = await api<OverviewDto>("/api/overview");
        const fresh = o.recent.filter((e) => e.direction === "in" && !seen.current!.has(e.hash));
        fresh.forEach((e) => seen.current!.add(e.hash));
        if (fresh.length === 0) return;
        latest.current.onIncoming(fresh, o);
        if (permission() === "on") {
          for (const e of fresh) {
            const usd = usdOf(e, latest.current.ethUsd);
            const who =
              e.contactName ?? (e.source === "internal" ? "a contract" : shortAddr(e.counterparty));
            new Notification(`+${amountOf(e)} received`, {
              body: `${usd ? `${usd} · ` : ""}from ${who}`,
              icon: "/icon.png",
              tag: e.hash,
            });
          }
        }
      } catch {
        /* offline or rate-limited: try again next round */
      }
    };
    void check();
    const t = setInterval(check, CHECK_EVERY_MS);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, []);

  return { notify, toggle };
}

export function incomingToast(entries: EntryDto[], ethUsd: string | null): string {
  if (entries.length > 1) return `${entries.length} incoming transfers just landed`;
  const e = entries[0]!;
  const usd = usdOf(e, ethUsd);
  const who = e.contactName ?? (e.source === "internal" ? "a contract" : shortAddr(e.counterparty));
  return `+${amountOf(e)}${usd ? ` (${usd})` : ""} received from ${who}`;
}
