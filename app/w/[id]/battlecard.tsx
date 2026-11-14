"use client";

// One competitor: what they charge, how that moved, and everything they changed.

import { Facts, Audience } from "./comparison-matrix";
import { useEffect, useState } from "react";
import { diffPlans, formatUsd, historySeries, planKey, priceOn, removedPlans, type CellChange } from "@/lib/pricing-view";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { timeAgo } from "@/lib/time";
import { displayName, type Battlecard, type Competitor, type EventRow, type MonitorStatus, type PricingSnapshot, type Signal } from "@/lib/types";
import { SOURCE_LABEL } from "@/lib/types";
import { parseHowToWin } from "@/lib/how-to-win-view";
import { PriceHistory } from "./price-history";
import { ChangeItem } from "./redline";
import { hostOf, SourceLink, sourceLabel, waybackIndex } from "./source";

const PLAN_ROWS = 6;

function usePricingSnapshots(competitorId: string, version: string | undefined, active: boolean) {
  const [snaps, setSnaps] = useState<PricingSnapshot[]>([]);
  useEffect(() => {
    if (!active) return;
    supabaseBrowser()
      .from("pricing_snapshots")
      .select("*")
      .eq("competitor_id", competitorId)
      .order("captured_at")
      .then(({ data }) => setSnaps(data ?? []));
  }, [competitorId, version, active]); // refetch when the battlecard's pricing changes
  return snaps;
}

function Panel({ title, note, children, className = "" }: { title: string; note?: React.ReactNode; children: React.ReactNode; className?: string }) {
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
          const broken = m.status.startsWith("error") || m.status === "failed";
          return (
            <li key={m.id} className="inline-flex items-center gap-1.5" title={broken ? m.status : undefined}>
              <span aria-hidden className={m.status === "paused" ? "text-muted" : broken ? "text-critical" : "text-good"}>{m.status === "paused" ? "Ⅱ" : broken ? "✕" : "●"}</span>
              {m.url ? (
                <a href={m.url} target="_blank" rel="noreferrer" title={sourceLabel(m.url, 60)} className="underline decoration-hairline underline-offset-2 hover:text-ink hover:decoration-current">
                  {SOURCE_LABEL[m.signal]}
                </a>
              ) : (
                SOURCE_LABEL[m.signal]
              )}
              <span className="text-muted">{m.status === "paused" ? "paused" : broken ? "can’t be read" : `checked ${timeAgo(m.last_run_at)}`}</span>
            </li>
          );
        })}
    </ul>
  );
}

export function BattlecardView({
  competitor: c,
  card,
  events,
  fresh,
  onRate,
  monitors,
  onManage,
  filterMode = "important",
  onFilterChange,
}: {
  competitor: Competitor;
  card?: Battlecard;
  events: EventRow[];
  fresh: Set<string>;
  onRate?: (id:string,rating:"useful"|"not_useful")=>Promise<boolean>;
  monitors: MonitorStatus[];
  onManage?:()=>void;
  filterMode?:"important"|"all";
  onFilterChange?:(mode:"important"|"all")=>void;
}) {
  const [tab,setTab]=useState<"overview"|"pricing"|"activity">("overview");
  useEffect(()=>{const restore=()=>{const value=new URLSearchParams(location.search).get("profile");setTab(value==="pricing"||value==="activity"?value:"overview");};restore();window.addEventListener("popstate",restore);return()=>window.removeEventListener("popstate",restore);},[]);
  const snaps = usePricingSnapshots(c.id, card?.pricing?.captured_at, tab==="pricing");
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
    <article className="min-w-0 break-words">
      <header className="flex flex-wrap items-start gap-3">
        {c.logo_url ? <img src={c.logo_url} alt="" className="h-10 w-10 rounded-md bg-surface object-contain p-1" /> : <span className="h-10 w-10 rounded-md bg-surface" />}
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-semibold tracking-tight">{displayName(c)}</h2>
          <p className="max-w-3xl text-[13px] text-graphite">
            <a href={c.homepage_url ?? `https://${c.domain}`} target="_blank" rel="noreferrer" className="break-all font-semibold hover:underline">{c.domain}</a>
          </p>
          {c.why && <p className="mt-0.5 line-clamp-2 max-w-3xl text-[13px] text-muted">{c.why}</p>}
          <p className="mt-2 text-[11px] text-graphite">{monitors.length} monitored sources</p>
        </div>
      </header>

      <div role="group" aria-label="Company view" className="my-6 flex w-fit gap-1 rounded-lg border border-hairline bg-surface p-1">{(["overview","pricing","activity"] as const).map(value=><button key={value} type="button" aria-pressed={tab===value} onClick={()=>{setTab(value);const url=new URL(location.href);url.searchParams.set("profile",value);history.replaceState(null,"",url);}} className="min-h-10 rounded-md px-4 text-[12px] font-semibold capitalize aria-pressed:bg-ink aria-pressed:text-white">{value[0].toUpperCase()+value.slice(1)}</button>)}</div>
      {tab==="overview"&&<div className="space-y-5">
        <div className="grid gap-5 lg:grid-cols-2"><Panel title="Positioning"><Facts profile={card?.comparison_profile} items={card?.comparison_profile?.positioning?[card.comparison_profile.positioning]:[]}/></Panel><Panel title="Who they serve"><Audience profile={card?.comparison_profile}/></Panel><div className="lg:col-span-2"><Panel title="Products & services"><Facts profile={card?.comparison_profile} items={card?.comparison_profile?.capabilities??[]}/></Panel></div></div>
        {events[0]&&<section className="rounded-xl border border-hairline bg-surface p-5"><h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted">Latest change</h3><p className="mt-2 text-[14px] font-semibold">{events[0].title}</p><p className="mt-1 text-[12px] text-graphite">{events[0].summary}</p><button type="button" onClick={()=>{setTab("activity");const url=new URL(location.href);url.searchParams.set("profile","activity");history.replaceState(null,"",url);}} className="mt-2 min-h-10 text-[12px] font-semibold">View activity →</button></section>}
        <details className="rounded-lg border border-hairline bg-surface p-4"><summary className="min-h-8 cursor-pointer text-[12px] font-semibold">Monitored sources</summary><SourceHealth monitors={monitors}/>{onManage&&<button type="button" onClick={onManage} className="mt-2 min-h-11 text-[12px] font-semibold">Manage sources →</button>}</details>
        {!!card?.how_to_win&&<details className="rounded-lg border border-hairline bg-surface p-4"><summary className="min-h-8 cursor-pointer text-[12px] font-semibold">Sales analysis</summary><HowToWinPanel name={displayName(c)} text={card.how_to_win} pricingUrl={card.pricing?c.pricing_url:null} changeCount={events.length}/></details>}
      </div>}

      {tab==="pricing"&&<div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <Panel
          title="Pricing now"
          note={
            card?.pricing ? (
              <>
                Read {timeAgo(card.pricing.captured_at)} from {c.pricing_url ? <SourceLink href={c.pricing_url} /> : "the pricing page"}
              </>
            ) : (
              "Reading the pricing page…"
            )
          }
        >
          {plans.length ? (
            <>
              <table className="w-full table-fixed text-[12px] sm:text-[13px]">
                <thead className="text-[12px] text-muted">
                  <tr>
                    <th className="w-[34%] py-1 text-left font-normal">Plan</th>
                    <th className="py-1 text-right font-normal">Monthly</th>
                    {showYearly && <th className="py-1 text-right font-normal">Yearly</th>}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p) => {
                    const ch = changes.get(planKey(p.name));
                    return (
                      <tr key={p.name} className="border-t border-hairline">
                        <td className="break-words py-2 pr-1 sm:pr-2">
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
              : snaps.length - live.length > 0 ? (
                <>
                  From{" "}
                  {c.pricing_url ? (
                    <SourceLink href={waybackIndex(c.pricing_url)} label={`${snaps.length - live.length} archived copies`} />
                  ) : (
                    `${snaps.length - live.length} archived copies`
                  )}{" "}
                  of the pricing page since {new Date(firstSnap!).toLocaleDateString(undefined, { month: "long", year: "numeric" })}, plus live readings. Click a
                  point to open its source.
                </>
              ) : (
                "From live readings of the pricing page. No archived copies were found."
              )
          }
        >
          {series.length ? (
          <PriceHistory series={series} pageUrl={c.pricing_url} />
          ) : (
            <p className="text-[13px] text-muted">No archived pricing pages found for this company, so history starts today.</p>
          )}
        </Panel>
      </div>}

      {tab==="activity"&&<div className="max-w-4xl">
        <section className="rounded-lg border border-hairline bg-surface">
          <header className="px-4 pt-3.5 pb-2">
            <h3 className="font-semibold">Changes</h3>
            <p className="text-[12px] text-muted">Watching for {watchedFor}.</p>
            {onFilterChange&&<div role="group" aria-label="Company changes shown" className="mt-3 flex gap-2">{(["important","all"] as const).map(mode=><button key={mode} type="button" aria-pressed={filterMode===mode} onClick={()=>onFilterChange(mode)} className="min-h-10 rounded-md border border-hairline px-3 text-[12px] aria-pressed:bg-ink aria-pressed:text-white">{mode==="important"?"Important":"All changes"}</button>)}</div>}
          </header>
          {events.length ? (
            <ul className="divide-y divide-hairline border-t border-hairline">
              {events.map((e) => (
                <ChangeItem key={e.id} event={e} fresh={fresh.has(e.id)} showCompetitor={false} onRate={onRate} />
              ))}
            </ul>
          ) : (
            <p className="px-4 pb-4 text-[13px] text-muted">No changes since we started watching. Use Check now to look right away.</p>
          )}
        </section>

      </div>}
    </article>
  );
}

function HowToWinPanel({
  name,
  text,
  pricingUrl,
  changeCount,
}: {
  name: string;
  text: string | null | undefined;
  pricingUrl: string | null;
  changeCount: number;
}) {
  const brief = parseHowToWin(text);
  return (
    <section aria-labelledby="htw-h" className="mt-6 rounded-lg border border-ink/15 bg-surface px-5 py-4">
      <h3 id="htw-h" className="font-semibold">How to win against {name}</h3>
      {brief ? (
        <>
          <p className="mt-1 max-w-3xl text-[15px]">{brief.headline}</p>
          <div className="mt-4 grid gap-6 md:grid-cols-2">
            <div>
              <h4 className="text-[13px] font-semibold text-graphite">Say this</h4>
              <ul className="mt-1.5 list-disc space-y-1.5 pl-4 text-[14px] marker:text-muted">
                {brief.say_this.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            </div>
            <div>
              <h4 className="text-[13px] font-semibold text-graphite">Watch out for</h4>
              <ul className="mt-1.5 list-disc space-y-1.5 pl-4 text-[14px] marker:text-muted">
                {brief.watch_out.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            </div>
          </div>
          <p className="mt-3 text-[12px] text-muted">
            Written by Claude {timeAgo(brief.generated_at)} from{" "}
            {pricingUrl ? <SourceLink href={pricingUrl} label="their pricing page" /> : "their pricing"}
            {changeCount > 0 && <>, the {Math.min(changeCount, 15)} latest changes below</>} and the press, hiring and messaging feeds on this page. Rewritten whenever{" "}
            {name} changes something.
          </p>
        </>
      ) : (
        <p className="mt-1 text-[13px] text-muted">The brief is written once pricing has been read, and rewritten whenever {name} changes something.</p>
      )}
    </section>
  );
}
