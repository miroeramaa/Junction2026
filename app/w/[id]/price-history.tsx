"use client";

// Price history as step lines: a price holds until the next snapshot shows a different one.

import { useEffect, useMemo, useRef, useState } from "react";
import { formatUsd, type Series, type SeriesPoint } from "@/lib/pricing-view";
import { waybackUrl } from "./source";

const COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)"];
const H = 210;
const M = { top: 14, right: 132, bottom: 26, left: 48 };

function niceMax(v: number) {
  const pow = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * pow).find((x) => x >= v) ?? v;
}

/** Value of a step series at time t: the last observation at or before t. */
function valueAt(s: Series, t: number): number | null {
  let v: number | null = null;
  for (const p of s.points) if (p.t <= t) v = p.v;
  return v;
}

/** Where a reading came from: the archived copy for Wayback points, the live page otherwise. */
const pointHref = (pageUrl: string, p: SeriesPoint) => (p.source === "wayback" ? waybackUrl(pageUrl, new Date(p.t).toISOString()) : pageUrl);

/** The reading in effect at time t: the latest point at or before t across all series. */
function readingAt(series: Series[], t: number): SeriesPoint | null {
  let best: SeriesPoint | null = null;
  for (const s of series) for (const p of s.points) if (p.t <= t && (!best || p.t > best.t)) best = p;
  return best;
}

export function PriceHistory({ series, pageUrl }: { series: Series[]; pageUrl?: string | null }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hoverT, setHoverT] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(320, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geo = useMemo(() => {
    const all = series.flatMap((s) => s.points);
    const t0 = Math.min(...all.map((p) => p.t));
    const t1 = Math.max(Date.now(), ...all.map((p) => p.t));
    const yMax = niceMax(Math.max(...all.map((p) => p.v)) * 1.1);
    const iw = width - M.left - M.right;
    const ih = H - M.top - M.bottom;
    const x = (t: number) => M.left + ((t - t0) / Math.max(1, t1 - t0)) * iw;
    const y = (v: number) => M.top + ih - (v / yMax) * ih;
    const yTicks = [0, yMax / 4, yMax / 2, (3 * yMax) / 4, yMax];
    const mid = t0 + (t1 - t0) / 2;
    const xTicks = [t0, mid, t1];
    return { t0, t1, x, y, yTicks, xTicks, iw, ih };
  }, [series, width]);

  if (!series.length) return null;
  const { t0, t1, x, y, yTicks, xTicks, iw } = geo;

  const path = (s: Series) => {
    let d = "";
    s.points.forEach((p, i) => {
      d += i === 0 ? `M${x(p.t)},${y(p.v)}` : `H${x(p.t)}V${y(p.v)}`;
    });
    return d + `H${x(t1)}`;
  };

  // Direct labels at the right edge, nudged apart so they never overlap.
  const labels = series
    .map((s, i) => ({ s, i, y: y(s.points.at(-1)!.v) }))
    .sort((a, b) => a.y - b.y);
  for (let k = 1; k < labels.length; k++) labels[k].y = Math.max(labels[k].y, labels[k - 1].y + 15);

  const span = t1 - t0;
  const fmtDate = (t: number) =>
    span < 2 * 86_400_000
      ? new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      : new Date(t).toLocaleDateString(undefined, span < 60 * 86_400_000 ? { day: "numeric", month: "short" } : { month: "short", year: "numeric" });
  const hoverX = hoverT != null ? x(hoverT) : null;

  return (
    <figure ref={wrap} className="relative">
      {series.length > 1 && (
        <figcaption className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-graphite">
          {series.map((s, i) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-3.5 rounded" style={{ background: COLORS[i] }} />
              {s.name}
              {s.basis === "yearly" && <span className="text-muted">(billed yearly)</span>}
            </span>
          ))}
        </figcaption>
      )}
      <svg
        width={width}
        height={H}
        role="img"
        aria-label={`Price history for ${series.map((s) => s.name).join(", ")}`}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = e.clientX - r.left;
          if (px < M.left || px > M.left + iw) return setHoverT(null);
          setHoverT(t0 + ((px - M.left) / iw) * (t1 - t0));
        }}
        onPointerLeave={() => setHoverT(null)}
        className="block touch-none"
      >
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={M.left} x2={M.left + iw} y1={y(v)} y2={y(v)} stroke={v === 0 ? "#c3c8d0" : "var(--hairline)"} />
            <text x={M.left - 8} y={y(v)} dy="0.32em" textAnchor="end" className="tabular fill-muted text-[11px]">
              ${Math.round(v)}
            </text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text
            key={t}
            x={x(t)}
            y={H - 6}
            textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}
            className="fill-muted text-[11px]"
          >
            {i === xTicks.length - 1 ? "Now" : fmtDate(t)}
          </text>
        ))}

        {series.map((s, i) => (
          <g key={s.key}>
            <path d={path(s)} fill="none" stroke={COLORS[i]} strokeWidth={2} strokeLinejoin="round" />
            {s.points.map((p) => {
              const dot = <circle cx={x(p.t)} cy={y(p.v)} r={4} fill={COLORS[i]} stroke="var(--surface)" strokeWidth={2} />;
              if (!pageUrl) return <g key={p.t}>{dot}</g>;
              const when = new Date(p.t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
              return (
                <a key={p.t} href={pointHref(pageUrl, p)} target="_blank" rel="noreferrer" className="cursor-pointer">
                  <title>{`${s.name} ${formatUsd(p.v)}, ${p.source === "wayback" ? `archived copy from ${when}` : `read live on ${when}`}. Open source.`}</title>
                  {/* Larger invisible hit area so the dot is easy to click. */}
                  <circle cx={x(p.t)} cy={y(p.v)} r={9} fill="transparent" />
                  {dot}
                </a>
              );
            })}
          </g>
        ))}

        {labels.map(({ s, i, y: ly }) => (
          <text key={s.key} x={M.left + iw + 8} y={ly} dy="0.32em" className="text-[12px]">
            <tspan fill={COLORS[i]}>●</tspan>
            <tspan className="fill-ink" dx={4}>
              {s.name.length > 12 ? `${s.name.slice(0, 11)}…` : s.name}
            </tspan>
            <tspan className="tabular fill-graphite" dx={4}>
              {formatUsd(s.points.at(-1)!.v)}
            </tspan>
          </text>
        ))}

        {hoverX != null && <line x1={hoverX} x2={hoverX} y1={M.top} y2={H - M.bottom} stroke="#9aa0aa" />}
      </svg>

      {hoverT != null && hoverX != null && (
        <div
          className="pointer-events-none absolute top-8 z-10 min-w-40 rounded-md border border-hairline bg-surface px-3 py-2 text-[12px] shadow-sm"
          style={{ left: hoverX > width / 2 ? hoverX - 172 : hoverX + 12 }}
        >
          <p className="mb-1 text-muted">{new Date(hoverT).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</p>
          {series.map((s, i) => (
            <p key={s.key} className="flex items-center justify-between gap-4">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: COLORS[i] }} />
                {s.name}
              </span>
              <span className="tabular font-semibold">{formatUsd(valueAt(s, hoverT))}</span>
            </p>
          ))}
          {(() => {
            const r = readingAt(series, hoverT);
            if (!r) return null;
            const when = new Date(r.t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
            return (
              <p className="mt-1.5 border-t border-hairline pt-1.5 text-muted">
                {r.source === "wayback" ? `Archived copy, ${when}` : `Live reading, ${when}`}
                {pageUrl && <span className="block">Click a point to open it</span>}
              </p>
            );
          })()}
        </div>
      )}

      <table className="sr-only">
        <caption>Price history</caption>
        <thead>
          <tr>
            <th>Plan</th>
            <th>Date</th>
            <th>Price per month</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {series.flatMap((s) =>
            s.points.map((p) => (
              <tr key={`${s.key}-${p.t}`}>
                <td>{s.name}</td>
                <td>{new Date(p.t).toLocaleDateString()}</td>
                <td>{formatUsd(p.v)}</td>
                <td>
                  {pageUrl ? (
                    <a href={pointHref(pageUrl, p)}>{p.source === "wayback" ? "Archived copy" : "Live pricing page"}</a>
                  ) : p.source === "wayback" ? "Archived copy" : "Live pricing page"}
                </td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </figure>
  );
}
