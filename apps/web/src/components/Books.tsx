"use client";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime, shortAddr, trimEth } from "@/lib/format";
import type { CategoryDto, EntryDto, PeriodPreset, RecapDto, SyncDto } from "@/shared/types";
import { CategoryChart, InOutChart, Legend } from "./Charts";
import { IconDownload, IconExternal, IconRefresh } from "./Icons";
import { useToast } from "./Toast";

const PERIODS: { id: PeriodPreset; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
  { id: "year", label: "This year" },
  { id: "all", label: "All time" },
];

interface Props {
  /** Bumped by the parent after a send, so the books reload. */
  version: number;
  onSynced: () => void;
}

export function Books({ version, onSynced }: Props) {
  const toast = useToast();
  const [period, setPeriod] = useState<PeriodPreset>("month");
  const [recap, setRecap] = useState<RecapDto | null>(null);
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, c] = await Promise.all([
        api<{ recap: RecapDto }>(`/api/books?period=${period}`),
        api<{ categories: CategoryDto[] }>("/api/categories"),
      ]);
      setRecap(r.recap);
      setCategories(c.categories);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [period]);

  useEffect(() => {
    void load();
  }, [load, version]);

  const sync = async () => {
    setSyncing(true);
    try {
      // A long gap is synced in chunks (hosts cap outgoing requests per call): keep going.
      let found = 0;
      let dropped = 0;
      let r: SyncDto;
      let rounds = 0;
      do {
        r = await api<SyncDto>("/api/books/sync", { body: {} });
        found += r.incoming + r.outgoingExternal + r.internalIncoming;
        dropped += r.dropped;
        rounds += 1;
        if (r.partial) toast(`Syncing… block ${r.toBlock.toLocaleString()}`);
      } while (r.partial && rounds < 80);
      toast(
        dropped
          ? `${dropped} stuck transfer${dropped === 1 ? " was" : "s were"} dropped by the network (nothing moved)`
          : r.initialized
            ? `Tracking starts at block ${r.toBlock.toLocaleString()}`
            : r.partial
              ? `Synced up to block ${r.toBlock.toLocaleString()}. Press Sync again to continue.`
              : found
                ? `Found ${found} new transaction${found === 1 ? "" : "s"}`
                : "Up to date",
      );
      await load();
      onSynced();
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setSyncing(false);
    }
  };

  const t = recap?.totals;
  return (
    <section id="books" className="section" aria-labelledby="books-title">
      <div className="section-head">
        <div>
          <p className="eyebrow">The books</p>
          <h2 id="books-title" className="display lg">
            Every run on the record
          </h2>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn ghost"
            onClick={() => void sync()}
            disabled={syncing}
          >
            {syncing ? <span className="spinner" /> : <IconRefresh size={15} />}{" "}
            {syncing ? "Syncing…" : "Sync with chain"}
          </button>
          <a className="btn peach" href={`/api/books/export?period=${period}`} download>
            <IconDownload size={15} /> Export CSV
          </a>
        </div>
      </div>

      <div className="books-wrap">
        <div className="toolbar">
          <div className="seg" role="group" aria-label="Period">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={period === p.id}
                onClick={() => setPeriod(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
          {recap && (
            <span className="faint" style={{ fontSize: 13 }}>
              {new Date(recap.period.from).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}{" "}
              →{" "}
              {new Date(recap.period.to - 1).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          )}
        </div>

        {error && <p className="form-error">{error}</p>}

        <div className="tiles reveal">
          <Tile k="Received" v={t ? signed("+", t.inEth) : "…"} accent="var(--chart-in)" />
          <Tile k="Sent" v={t ? signed("-", t.outEth) : "…"} accent="var(--chart-out)" />
          <Tile k="Gas spent" v={t ? trimEth(t.feeEth, 9) : "…"} accent="var(--peach)" />
          <Tile
            k="Net"
            v={t ? (t.netNegative ? trimEth(t.netEth, 9) : signed("+", t.netEth, 9)) : "…"}
            accent="var(--lime)"
            sub={
              t
                ? `${t.count} run${t.count === 1 ? "" : "s"}${t.pending ? ` · ${t.pending} pending` : ""}`
                : undefined
            }
          />
        </div>

        {recap && (
          <div className="charts reveal">
            <div className="chart-card">
              <div className="chart-head">
                <h3>In vs out</h3>
                <Legend />
              </div>
              <InOutChart recap={recap} />
            </div>
            <div className="chart-card">
              <div className="chart-head">
                <h3>By category</h3>
                <Legend />
              </div>
              <CategoryChart recap={recap} />
            </div>
          </div>
        )}

        {recap && <LedgerTable entries={recap.entries} categories={categories} onChanged={load} />}
      </div>
    </section>
  );
}

/** "+0.5" / "-0.5", but a plain "0" when nothing moved. */
const signed = (sign: string, eth: string, max = 6) =>
  eth === "0" || eth === "0.0" ? "0" : `${sign}${trimEth(eth, max)}`;

function Tile({
  k,
  v,
  accent,
  sub,
}: {
  k: string;
  v: string;
  accent: string;
  sub?: string | undefined;
}) {
  return (
    <div className="tile" style={{ ["--accent" as string]: accent }}>
      <div className="k">{k}</div>
      <div className="v">
        {v} <span style={{ fontSize: "0.5em", color: "var(--text-2)" }}>ETH</span>
      </div>
      {sub && <div className="s">{sub}</div>}
    </div>
  );
}

function LedgerTable({
  entries,
  categories,
  onChanged,
}: {
  entries: EntryDto[];
  categories: CategoryDto[];
  onChanged: () => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const save = async (hash: string, change: { category?: string; note?: string }) => {
    try {
      await api("/api/books/entries", { method: "PATCH", body: { hash, ...change } });
      onChanged();
    } catch (err) {
      toast(errorMessage(err));
    }
  };

  if (!entries.length) {
    return (
      <div className="table-card">
        <div className="crew-empty" style={{ padding: 36 }}>
          Nothing on the record for this period. Press <strong>Sync with chain</strong> to pull in
          transfers you made elsewhere.
        </div>
      </div>
    );
  }
  return (
    <div className="table-card">
      <div className="table-scroll">
        <table className="ledger">
          <caption className="sr-only">Transactions in this period</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Amount</th>
              <th scope="col">Who</th>
              <th scope="col">Category</th>
              <th scope="col">Note</th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className="sr-only">Explorer</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={`${e.hash}-${e.direction}`}>
                <td className="faint" style={{ whiteSpace: "nowrap" }}>
                  {fmtDateTime(e.timestamp)}
                </td>
                <td className={`amt ${e.direction}`}>
                  {e.direction === "in" ? "+" : "-"}
                  {trimEth(e.amountEth, 9)} ETH
                  {e.feeEth && e.direction === "out" && (
                    <div className="faint" style={{ fontWeight: 400, fontSize: 11.5 }}>
                      gas {trimEth(e.feeEth, 9)}
                    </div>
                  )}
                </td>
                <td>
                  <div style={{ fontWeight: 600 }}>
                    {e.contactName ??
                      (e.source === "internal" ? "Via contract" : shortAddr(e.counterparty))}
                  </div>
                  {e.contactName && <div className="crew-addr">{shortAddr(e.counterparty)}</div>}
                </td>
                <td>
                  <label className="sr-only" htmlFor={`cat-${e.hash}`}>
                    Category
                  </label>
                  <select
                    id={`cat-${e.hash}`}
                    value={e.category ?? ""}
                    onChange={(ev) => void save(e.hash, { category: ev.target.value })}
                  >
                    <option value="">Uncategorized</option>
                    {categories.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  {editing === e.hash ? (
                    <form
                      onSubmit={(ev) => {
                        ev.preventDefault();
                        setEditing(null);
                        void save(e.hash, { note });
                      }}
                    >
                      <label className="sr-only" htmlFor={`note-${e.hash}`}>
                        Note
                      </label>
                      <input
                        id={`note-${e.hash}`}
                        className="note-input"
                        value={note}
                        maxLength={280}
                        autoFocus
                        onChange={(ev) => setNote(ev.target.value)}
                        onBlur={() => {
                          setEditing(null);
                          if (note !== (e.note ?? "")) void save(e.hash, { note });
                        }}
                        onKeyDown={(ev) => ev.key === "Escape" && setEditing(null)}
                      />
                    </form>
                  ) : (
                    <button
                      type="button"
                      className={`note-btn${e.note ? "" : " empty"}`}
                      onClick={() => {
                        setEditing(e.hash);
                        setNote(e.note ?? "");
                      }}
                    >
                      {e.note ?? "Add a note"}
                    </button>
                  )}
                </td>
                <td>
                  <StatusPill e={e} />
                </td>
                <td>
                  <a
                    className="icon-btn"
                    href={e.explorerUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label="Open on Blockscout"
                    title="Open on Blockscout"
                  >
                    <IconExternal size={14} />
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function StatusPill({ e }: { e: Pick<EntryDto, "status" | "direction"> }) {
  if (e.status === "pending") return <span className="pill gold">On the road</span>;
  if (e.status === "failed") return <span className="pill red">Busted</span>;
  return e.direction === "in" ? (
    <span className="pill mint">Incoming</span>
  ) : (
    <span className="pill lime">Clean getaway</span>
  );
}
