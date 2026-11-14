"use client";

// One competitor: what they charge, how that moved, and everything they changed.

import { useEffect, useState } from "react";
import { diffPlans, formatUsd, historySeries, planKey, priceOn, removedPlans, type CellChange } from "@/lib/pricing-view";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { timeAgo } from "@/lib/time";
import { displayName, type Battlecard, type Competitor, type EventRow, type FeedItem, type MonitorStatus, type PricingSnapshot, type Signal } from "@/lib/types";
import { SOURCE_LABEL } from "@/lib/types";
import { PriceHistory } from "./price-history";
import { ChangeItem } from "./redline";

const PLAN_ROWS = 6;

function usePricingSnapshots(competitorId: string, version: string | undefined) {
  const [snaps, setSnaps] = useState<PricingSnapshot[]>([]);
  useEffect(() => {
    supabaseBrowser()
      .from("pricing_snapshots")
      .select("*")
      .eq("competitor_id", competitorId)
      .order("captured_at")
      .then(({ data }) => setSnaps(data ?? []));
  }, [competitorId, version]); // refetch when the battlecard's pricing changes
  return snaps;
}

function Panel({ title, note, children, className = "" }: { title: string; note?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-hairline bg-surface ${className}`}>
      <header className="px-4 pt-3.5 pb-2">
        <h3 className="font-semibold">{title}</h3>
        {note && <p className="text-[12px] text-muted">{note}</p>}
      </header>
      <div className="px-4 pb-4">{children}</div>
    </section>
  );
}

function Price({ value, change }: { value: number | null; change?: CellChange }) {
  if (!change) return <>{formatUsd(value)}</>;
  return (
    <span className="whitespace-nowrap">
      <span className="struck mr-1.5 font-normal">{formatUsd(change.before)}</span>
      <span className="inserted">{formatUsd(change.after)}</span>
    </span>
  );
}

function SourceHealth({ monitors }: { monitors: MonitorStatus[] }) {
  if (!monitors.length) return null;
  const order: Signal[] = ["pricing", "launches", "news", "hiring", "positioning"];
  return (
    <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-graphite">
      {[...monitors]
        .sort((a, b) => order.indexOf(a.signal) - order.indexOf(b.signal))
        .map((m) => {
          const broken = m.status.startsWith("error") || m.status === "failed" || m.status === "paused";
          return (
            <li key={m.id} className="inline-flex items-center gap-1.5" title={broken ? m.status : undefined}>
              <span aria-hidden className={broken ? "text-critical" : "text-good"}>{broken ? "✕" : "●"}</span>
              {SOURCE_LABEL[m.signal]}
              <span className="text-muted">{broken ? "can’t be read" : `checked ${timeAgo(m.last_run_at)}`}</span>
            </li>
          );
        })}
    </ul>
  );
}

function FeedList({ items, empty }: { items: FeedItem[]; empty: string }) {
  if (!items?.length) return <p className="text-[13px] text-muted">{empty}</p>;
  return (
    <ul className="space-y-2.5">
      {items.slice(0, 5).map((it, i) => (
        <li key={i} className="text-[13px]">
          {it.url ? (
            <a href={it.url} target="_blank" rel="noreferrer" className="font-semibold hover:underline">{it.title}</a>
          ) : (
            <span className="font-semibold">{it.title}</span>
          )}
          {it.summary && <span className="block text-graphite">{it.summary}</span>}
          <span className="block text-[12px] text-muted">{timeAgo(it.at)}</span>
        </li>
      ))}
    </ul>
  );
}

export function BattlecardView({
  competitor: c,
  card,
  events,
  fresh,
  monitors,
}: {
  competitor: Competitor;
  card?: Battlecard;
  events: EventRow[];
  fresh: Set<string>;
  monitors: MonitorStatus[];
}) {
  const snaps = usePricingSnapshots(c.id, card?.pricing?.captured_at);
  const [allPlans, setAllPlans] = useState(false);

  const plans = card?.pricing?.plans ?? [];
  const live = snaps.filter((s) => s.source === "live");
  // Redline against the snapshot before the latest one we know of.
  const ordered = [...snaps].sort((a, b) => a.captured_at.localeCompare(b.captured_at));
  const previous = ordered.length > 1 ? ordered[ordered.length - 2].plans : undefined;
  const lastPricingEvent = events.find((e) => e.signal === "pricing");
  const changes = lastPricingEvent ? diffPlans(previous, plans) : new Map();
  const removed = lastPricingEvent ? removedPlans(previous, plans) : [];
  const showYearly = plans.some((p) => p.price_monthly_usd_billed_yearly != null);
  const shown = allPlans ? plans : plans.slice(0, PLAN_ROWS);
  const series = historySeries(snaps.filter((s) => s.plans.length));
  const firstSnap = ordered[0]?.captured_at;
  const watchedFor = timeAgo(c.created_at).replace(" ago", "");

  return (
    <article>
      <header className="flex flex-wrap items-start gap-3">
        {c.logo_url ? <img src={c.logo_url} alt="" className="h-10 w-10 rounded-md bg-surface object-contain p-1" /> : <span className="h-10 w-10 rounded-md bg-surface" />}
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-semibold tracking-tight">{displayName(c)}</h2>
          <p className="max-w-3xl text-[13px] text-graphite">
            <a href={c.homepage_url ?? `https://${c.domain}`} target="_blank" rel="noreferrer" className="font-semibold hover:underline">{c.domain}</a>
          </p>
          {c.why && <p className="mt-0.5 line-clamp-2 max-w-3xl text-[13px] text-muted">{c.why}</p>}
          <SourceHealth monitors={monitors} />
        </div>
      </header>

      <div className="mt-6 grid items-start gap-4 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <Panel
          title="Pricing now"
          note={card?.pricing ? `Read from the pricing page ${timeAgo(card.pricing.captured_at)}.` : "Reading the pricing page…"}
        >
          {plans.length ? (
            <>
              <table className="w-full text-[13px]">
                <thead className="text-[12px] text-muted">
                  <tr>
                    <th className="py-1 text-left font-normal">Plan</th>
                    <th className="py-1 text-right font-normal">Billed monthly</th>
                    {showYearly && <th className="py-1 text-right font-normal">Billed yearly</th>}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p) => {
                    const ch = changes.get(planKey(p.name));
                    return (
                      <tr key={p.name} className="border-t border-hairline">
                        <td className="py-2 pr-2">
                          {ch?.added ? <span className="inserted">{p.name}</span> : p.name}
                          {ch?.added && <span className="ml-1.5 text-[11px] text-inserted">new plan</span>}
                          {p.limits[0] && <span className="block text-[12px] text-muted">{p.limits[0]}</span>}
                        </td>
                        <td className="tabular py-2 text-right font-semibold"><Price value={priceOn(p, "monthly")} change={ch?.monthly} /></td>
                        {showYearly && (
                          <td className="tabular py-2 pl-3 text-right font-semibold"><Price value={priceOn(p, "yearly")} change={ch?.yearly} /></td>
                        )}
                      </tr>
                    );
                  })}
                  {removed.map((name) => (
                    <tr key={`removed-${name}`} className="border-t border-hairline">
                      <td className="py-2" colSpan={showYearly ? 3 : 2}>
                        <span className="struck">{name}</span> <span className="text-[11px] text-redline">plan removed</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {plans.length > PLAN_ROWS && (
                <button className="mt-2 text-[13px] font-semibold text-graphite hover:text-ink" onClick={() => setAllPlans((v) => !v)}>
                  {allPlans ? "Show fewer plans" : `Show all ${plans.length} plans`}
                </button>
              )}
            </>
          ) : (
            <p className="text-[13px] text-muted">{c.pricing_url ? "No plans found on the pricing page yet." : "We couldn’t find a pricing page for this company."}</p>
          )}
        </Panel>

        <Panel
          title="Price history"
          note={
            !series.length
              ? undefined
              : snaps.length - live.length > 0
                ? `From ${snaps.length - live.length} archived copies of the pricing page since ${new Date(firstSnap!).toLocaleDateString(undefined, { month: "long", year: "numeric" })}, plus live readings.`
                : "From live readings of the pricing page. No archived copies were found."
          }
        >
          {series.length ? (
            <PriceHistory series={series} />
          ) : (
            <p className="text-[13px] text-muted">No archived pricing pages found for this company, so history starts today.</p>
          )}
        </Panel>
      </div>

      <div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <section className="rounded-lg border border-hairline bg-surface">
          <header className="px-4 pt-3.5 pb-2">
            <h3 className="font-semibold">Changes</h3>
            <p className="text-[12px] text-muted">Watching for {watchedFor}.</p>
          </header>
          {events.length ? (
            <ul className="divide-y divide-hairline border-t border-hairline">
              {events.map((e) => (
                <ChangeItem key={e.id} event={e} fresh={fresh.has(e.id)} showCompetitor={false} />
              ))}
            </ul>
          ) : (
            <p className="px-4 pb-4 text-[13px] text-muted">No changes since we started watching. Use Check now to look right away.</p>
          )}
        </section>

        <div className="space-y-4">
          <Panel title="New pages">
            <FeedList items={card?.launches ?? []} empty="No new blog posts or pages yet." />
          </Panel>
          <Panel title="Press">
            <FeedList items={card?.news ?? []} empty="No new coverage yet." />
          </Panel>
          <Panel title="Hiring">
            <FeedList items={card?.hiring ?? []} empty={c.careers_url ? "No new or removed job posts yet." : "No careers page found."} />
          </Panel>
          <Panel title="Messaging">
            <FeedList items={card?.positioning ? [card.positioning] : []} empty="Homepage headline hasn’t changed." />
          </Panel>
        </div>
      </div>
    </article>
  );
}
