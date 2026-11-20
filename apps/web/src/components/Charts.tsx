"use client";
import { useEffect, useRef, useState } from "react";
import { trimEth, weiToNumber } from "@/lib/format";
import type { RecapDto } from "@/shared/types";

const IN = "var(--chart-in)";
const OUT = "var(--chart-out)";

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Bar with a 4px rounded top, anchored square on the baseline. */
function barPath(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h);
  return `M ${x} ${y + h} V ${y + r} Q ${x} ${y} ${x + r} ${y} H ${x + w - r} Q ${x + w} ${y} ${x + w} ${y + r} V ${y + h} Z`;
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}

const fmtAxis = (v: number) =>
  v === 0
    ? "0"
    : v >= 1
      ? v.toLocaleString("en-US", { maximumFractionDigits: 2 })
      : String(Number(v.toPrecision(2)));

export function Legend() {
  return (
    <div className="legend">
      <span>
        <i style={{ background: IN }} /> Received
      </span>
      <span>
        <i style={{ background: OUT }} /> Sent
      </span>
    </div>
  );
}

export function InOutChart({ recap }: { recap: RecapDto }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const series = recap.series;
  const hasData = series.some((s) => s.inWei !== "0" || s.outWei !== "0");
  const H = 240;
  const padL = 46;
  const padB = 26;
  const padT = 10;
  const plotW = Math.max(0, width - padL - 4);
  const plotH = H - padB - padT;
  const max = niceMax(
    Math.max(0, ...series.map((s) => Math.max(weiToNumber(s.inWei), weiToNumber(s.outWei)))),
  );
  const n = Math.max(1, series.length);
  const group = plotW / n;
  const barW = Math.max(2, Math.min(16, (group - 6) / 2 - 1));
  const y = (v: number) => padT + plotH - (v / max) * plotH;
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 64))));
  const fmtKey = (start: number) =>
    new Date(start).toLocaleDateString(
      "en-US",
      recap.period.bucket === "month" ? { month: "short" } : { month: "short", day: "numeric" },
    );

  return (
    <div className="chart-box" ref={ref} onMouseLeave={() => setHover(null)}>
      {!hasData ? (
        <div className="chart-empty">No runs in this period yet.</div>
      ) : (
        width > 0 && (
          <svg
            width={width}
            height={H}
            role="img"
            aria-label="Received and sent ETH over time. The table below lists every transaction."
          >
            {[0, 0.5, 1].map((t) => (
              <g key={t}>
                <line
                  x1={padL}
                  x2={width}
                  y1={y(max * t)}
                  y2={y(max * t)}
                  stroke="var(--border)"
                  strokeDasharray={t === 0 ? undefined : "3 4"}
                />
                <text
                  x={padL - 8}
                  y={y(max * t) + 4}
                  textAnchor="end"
                  fontSize="11"
                  fill="var(--text-3)"
                >
                  {fmtAxis(max * t)}
                </text>
              </g>
            ))}
            {series.map((s, i) => {
              const gx = padL + i * group;
              const cx = gx + group / 2;
              const vi = weiToNumber(s.inWei);
              const vo = weiToNumber(s.outWei);
              const hi = vi > 0 ? Math.max(2, plotH - (y(vi) - padT)) : 0;
              const ho = vo > 0 ? Math.max(2, plotH - (y(vo) - padT)) : 0;
              return (
                <g key={s.key}>
                  {hover === i && (
                    <rect
                      x={gx + 1}
                      y={padT}
                      width={group - 2}
                      height={plotH}
                      rx="6"
                      fill="rgb(255 255 255 / 0.05)"
                    />
                  )}
                  {hi > 0 && (
                    <path d={barPath(cx - barW - 1, padT + plotH - hi, barW, hi)} fill={IN} />
                  )}
                  {ho > 0 && <path d={barPath(cx + 1, padT + plotH - ho, barW, ho)} fill={OUT} />}
                  {i % labelEvery === 0 && (
                    <text x={cx} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--text-3)">
                      {fmtKey(s.start)}
                    </text>
                  )}
                  <rect
                    x={gx}
                    y={padT}
                    width={group}
                    height={plotH + padB}
                    fill="transparent"
                    onMouseEnter={() => setHover(i)}
                    onFocus={() => setHover(i)}
                  />
                </g>
              );
            })}
          </svg>
        )
      )}
      {hover !== null && series[hover] && hasData && (
        <div className="tooltip" style={{ left: padL + hover * group + group / 2, top: padT + 8 }}>
          <div className="t">{fmtKey(series[hover].start)}</div>
          <div className="r">
            <i
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                background: IN,
                display: "inline-block",
              }}
            />{" "}
            Received
            <b>{trimEth(series[hover].inEth)} ETH</b>
          </div>
          <div className="r">
            <i
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                background: OUT,
                display: "inline-block",
              }}
            />{" "}
            Sent
            <b>{trimEth(series[hover].outEth)} ETH</b>
          </div>
        </div>
      )}
    </div>
  );
}

export function CategoryChart({ recap }: { recap: RecapDto }) {
  const rows = recap.byCategory;
  if (!rows.length) return <div className="chart-empty">Tag runs to see where your ETH goes.</div>;
  const max = Math.max(
    ...rows.flatMap((r) => [weiToNumber(r.inWei), weiToNumber(r.outWei)]),
    1e-18,
  );
  return (
    <div className="cat-rows">
      {rows.slice(0, 7).map((r) => (
        <div className="cat-row" key={r.category}>
          <div className="top">
            <strong>{r.category}</strong>
            <span className="faint">
              {r.count} run{r.count === 1 ? "" : "s"}
            </span>
          </div>
          {[
            { v: r.inWei, eth: r.inEth, c: IN, l: "Received" },
            { v: r.outWei, eth: r.outEth, c: OUT, l: "Sent" },
          ].map((b) => (
            <div className="cat-bar" key={b.l} title={`${b.l}: ${b.eth} ETH`}>
              <span className="sr-only">{b.l}</span>
              <div className="track">
                {b.v !== "0" && (
                  <div
                    className="fill"
                    style={{ width: `${(weiToNumber(b.v) / max) * 100}%`, background: b.c }}
                  />
                )}
              </div>
              <span className="val">{b.v === "0" ? "–" : `${trimEth(b.eth)} ETH`}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
