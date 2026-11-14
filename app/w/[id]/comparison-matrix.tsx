"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { comparisonLanguageName, comparisonLocale, comparisonPrices, profileNeedsRefresh, recentCompetitorEvents, safeSourceUrl, type ComparisonFact, type ComparisonProfile } from "@/lib/comparison";
import { formatUsd } from "@/lib/pricing-view";
import { timeAgo } from "@/lib/time";
import { displayName, SIGNAL_LABEL, type Battlecard, type Competitor, type EventRow, type MonitorStatus } from "@/lib/types";

type Props = { workspaceId: string; competitors: Competitor[]; cards: Record<string, Battlecard>; events: EventRow[]; monitors: MonitorStatus[]; onSelect: (id: string) => void; loading?: boolean; onProfileSaved?: (id: string, profile: ComparisonProfile) => void };

function Source({ url, children }: { url?: string | null; children: ReactNode }) {
  const href = safeSourceUrl(url);
  return href ? <a href={href} target="_blank" rel="noreferrer" className="underline decoration-hairline underline-offset-4 hover:decoration-ink">{children}<span className="sr-only"> (opens in a new tab)</span></a> : <span>{children}</span>;
}

function Unknown({ researched }: { researched: boolean }) {
  return <p className="text-[13px] text-graphite">{researched ? "No direct statement found" : "Research not captured yet"}</p>;
}

function Facts({ items, profile }: { items: ComparisonFact[]; profile?: ComparisonProfile | null }) {
  if (!items.length || !profile) return <Unknown researched={!!profile} />;
  return (
    <>
      <ul lang={profile.locale} dir="auto" className="space-y-2 text-[13px] leading-relaxed">
        {items.map((item) => <li key={item.text}>{item.text}</li>)}
      </ul>
      <details className="mt-3 text-[12px] text-graphite">
        <summary className="min-h-8 cursor-pointer font-semibold hover:text-ink">Evidence ({items.length})</summary>
        <div className="mt-1 space-y-3 border-l-2 border-hairline pl-3">
          <p className="font-semibold">Original source quotes</p>
          {items.map((item) => <div key={item.text}><blockquote lang="" dir="auto" className="leading-relaxed">“{item.quote}”</blockquote><p className="mt-1"><Source url={item.source_url ?? profile.source_url}>Open source page</Source> · Read {timeAgo(item.captured_at ?? profile.captured_at)}</p></div>)}
        </div>
      </details>
    </>
  );
}

export function Pricing({ competitor, card }: { competitor: Competitor; card?: Battlecard }) {
  if (!card?.pricing) return <p className="text-[13px] text-graphite">{competitor.pricing_url ? "Pricing has not been captured yet" : "No pricing page found"}</p>;
  const plans = card.pricing.plans;
  if (!plans.length) return <p className="text-[13px] text-graphite">No plans extracted. This does not mean the product is free.</p>;
  const prices = comparisonPrices(plans);
  return (
    <div className="space-y-3 text-[13px]">
      {prices.monthly && <p><strong className="tabular text-base">{formatUsd(prices.monthly.price_monthly_usd)}</strong>/month <span className="block text-graphite">{prices.monthly.name} · billed monthly</span>{prices.monthly.billing_note && <span className="block text-[12px] text-graphite">{prices.monthly.billing_note}</span>}</p>}
      {prices.annual && <p><strong className="tabular text-base">{formatUsd(prices.annual.price_monthly_usd_billed_yearly)}</strong>/month <span className="block text-graphite">{prices.annual.name} · billed annually</span>{prices.annual.billing_note && <span className="block text-[12px] text-graphite">{prices.annual.billing_note}</span>}</p>}
      {!prices.monthly && !prices.annual && <p>No numeric paid subscription price captured.</p>}
      {prices.hasFree && <p className="inline-block rounded bg-canvas px-2 py-1 text-[12px] font-semibold">Free plan listed</p>}
      <details className="text-[12px] text-graphite">
        <summary className="min-h-8 cursor-pointer font-semibold hover:text-ink">{plans.length} published {plans.length === 1 ? "plan" : "plans"} · billing details</summary>
        <ul className="mt-1 space-y-2">
          {plans.map((p, i) => <li key={`${p.name}-${i}`}><span className="font-semibold text-ink">{p.name}</span>{p.billing_note && <span> · {p.billing_note}</span>}{p.limits.length > 0 && <span className="block">{p.limits.join(" · ")}</span>}</li>)}
        </ul>
      </details>
      <p className="text-[12px] text-graphite"><Source url={competitor.pricing_url}>Pricing source</Source> · Read {timeAgo(card.pricing.captured_at)}</p>
    </div>
  );
}

function Audience({ profile, compact = false }: { profile?: ComparisonProfile | null; compact?: boolean }) {
  if (profile?.target_customers.length) return <div><span className="mb-2 inline-flex rounded-full bg-canvas px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-graphite">Company-stated</span><Facts items={profile.target_customers} profile={profile} /></div>;
  const analysis = profile?.audience_analysis;
  if (!analysis?.segments.length || analysis.basis_captured_at !== profile?.captured_at) return <p className="text-[13px] text-graphite">{profile ? "Audience insight is ready to generate." : "Research this company to understand its audience."}</p>;
  return <div>
    <span className="inline-flex rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700">AI estimate</span>
    <ul lang={analysis.locale ?? profile.locale} dir="auto" className="mt-2 space-y-3 text-[13px]">
      {analysis.segments.map(segment => <li key={segment.label}><p className="font-medium">{segment.label}</p>{!compact && <p className="mt-1 text-graphite leading-relaxed">{segment.reasoning}</p>}</li>)}
    </ul>
    <details className="mt-3 text-[12px] text-graphite"><summary className="min-h-8 cursor-pointer font-semibold">Why this audience?</summary><p className="my-2">AI interpretation of captured company facts, rather than a direct company statement.</p>{analysis.segments.map(segment => <div className="mt-4" key={segment.label}><p className="mb-2 font-medium text-ink">{segment.reasoning}</p><Facts items={segment.evidence} profile={profile} /></div>)}</details>
  </div>;
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return <section className="min-w-0"><h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">{title}</h4>{children}</section>;
}

export function ComparisonMatrix({ workspaceId, competitors, cards, events, monitors, onSelect, loading = false, onProfileSaved }: Props) {
  const [includeDemo, setIncludeDemo] = useState(false);
  const [category, setCategory] = useState("overview");
  const [profiles, setProfiles] = useState<Record<string, ComparisonProfile>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<{ done: number; total: number; name: string } | null>(null);
  const [message, setMessage] = useState("");
  const [locale, setLocale] = useState("en");
  const [stopRequested, setStopRequested] = useState(false);
  const running = useRef(false);
  const retryActions = useRef<Record<string, "research" | "audience">>({});
  const stop = useRef(false);
  useEffect(() => { stop.current = false; return () => { stop.current = true; }; }, []);
  useEffect(() => {
    const updateLanguage = () => setLocale(comparisonLocale(navigator.languages?.[0] ?? navigator.language));
    updateLanguage();
    window.addEventListener("languagechange", updateLanguage);
    return () => window.removeEventListener("languagechange", updateLanguage);
  }, []);

  const shown = competitors.filter((c) => includeDemo || !c.is_sandbox);
  // Realtime is authoritative when newer; the response makes successful saves visible immediately.
  const profileFor = (id: string) => {
    const local = profiles[id];
    const saved = cards[id]?.comparison_profile;
    return local && (!saved || local.captured_at > saved.captured_at) ? local : saved;
  };
  const missing = shown.filter((c) => !profileFor(c.id));
  const researched = shown.length - missing.length;

  function research(targets: Competitor[], action: "research" | "audience" = "research") {
    if (running.current || !targets.length || loading) return;
    void runResearch(targets, action);
  }

  async function runResearch(targets: Competitor[], action: "research" | "audience") {
    if (running.current) return;
    running.current = true;
    stop.current = false;
    setStopRequested(false);
    setMessage("");
    let succeeded = 0;
    let attempted = 0;
    try {
      // Sequential requests keep account load predictable and progress useful.
      for (const c of targets) {
        if (stop.current) break;
        setProgress({ done: attempted, total: targets.length, name: displayName(c) });
        retryActions.current[c.id] = action;
        setErrors((old) => { const next = { ...old }; delete next[c.id]; return next; });
        try {
          const response = await fetch(`/api/workspaces/${workspaceId}/comparison`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ competitorId: c.id, locale, action }),
          });
          const data = await response.json();
          attempted++;
          if (!response.ok) {
            setErrors((old) => ({ ...old, [c.id]: data.error ?? "Could not research this company. Try again." }));
            if (data.stopQueue || [401, 403, 500, 503].includes(response.status)) break;
            continue;
          }
          if (!data.profile) throw new Error("The server returned no profile.");
          setProfiles((old) => ({ ...old, [c.id]: data.profile }));
          onProfileSaved?.(c.id, data.profile);
          succeeded++;
        } catch {
          setErrors((old) => ({ ...old, [c.id]: "Connection lost while researching. Reload to check whether the profile was saved before retrying." }));
          break; // An unknown outcome must not silently spend credits on subsequent requests.
        }
      }
      setMessage(`Updated ${succeeded} of ${targets.length} ${targets.length === 1 ? "company" : "companies"}.${succeeded < targets.length ? " Saved research remains available." : ""}`);
    } finally {
      running.current = false;
      setProgress(null);
    }
  }

  const audienceGaps = shown.filter(c => { const p = profileFor(c.id); return p && !p.target_customers.length && !p.audience_analysis?.segments.length; });
  const categories = [{ id: "overview", label: "Overview" }, { id: "positioning", label: "Positioning" }, { id: "audience", label: "Audience" }, { id: "offering", label: "Offering" }, { id: "pricing", label: "Pricing" }, { id: "signals", label: "Signals" }];
  const show = (name: string) => category === "overview" || category === name;

  if (loading) return <section aria-busy="true"><h2 className="text-2xl font-semibold">Competitor overview</h2><p role="status" className="mt-3 text-graphite">Loading your competitive landscape…</p></section>;
  return <section aria-labelledby="comparison-heading" className="min-w-0">
    <div className="flex flex-wrap items-start justify-between gap-5">
      <div><p className="text-[11px] font-semibold uppercase tracking-widest text-muted">Competitive landscape</p><h2 id="comparison-heading" className="mt-1 text-3xl font-semibold tracking-tight">Competitor overview</h2><p className="mt-2 max-w-xl text-[14px] text-graphite">See where competitors focus, who they serve and what’s changing.</p></div>
      <div className="flex flex-wrap gap-2">
        {!!audienceGaps.length && <button type="button" disabled={!!progress} onClick={() => { setCategory("audience"); research(audienceGaps, "audience"); }} className="min-h-11 rounded-lg border border-hairline bg-surface px-4 text-[12px] font-semibold disabled:opacity-50">Fill audience gaps ({audienceGaps.length})</button>}
        <button type="button" disabled={!!progress || !shown.length} onClick={() => research(missing.length ? missing : shown)} className="min-h-11 rounded-lg bg-ink px-4 text-[12px] font-semibold text-white disabled:opacity-50">{progress ? `Updating ${progress.done + 1} of ${progress.total}…` : missing.length ? `Research ${missing.length} companies` : "Refresh research"}</button>
      </div>
    </div>
    <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-b border-hairline pb-4">
      <div role="group" aria-label="Compare by category" className="flex flex-wrap gap-1 rounded-lg bg-surface p-1 ring-1 ring-hairline">{categories.map(item => <button key={item.id} type="button" aria-pressed={category === item.id} onClick={() => setCategory(item.id)} className={`min-h-10 rounded-md px-3 text-[12px] font-medium transition-colors ${category === item.id ? "bg-ink text-white" : "text-graphite hover:bg-canvas hover:text-ink"}`}>{item.label}</button>)}</div>
      <p className="text-[12px] text-graphite">{shown.length} competitors <span className="mx-1 text-hairline">/</span> {researched} researched</p>
    </div>
    {competitors.some(c => c.is_sandbox) && <label className="mt-3 flex min-h-9 w-fit cursor-pointer items-center gap-2 text-[12px] text-graphite"><input type="checkbox" checked={includeDemo} onChange={e => setIncludeDemo(e.target.checked)} />Include demo competitor</label>}
    <div role="status" aria-live="polite" className={progress || message ? "mt-4 rounded-lg border border-hairline bg-surface px-4 py-3 text-[12px] text-graphite" : "sr-only"}>
      {progress ? <div className="flex flex-wrap items-center justify-between gap-2"><p>Updating {progress.name} · {progress.done} of {progress.total} complete</p><button type="button" disabled={stopRequested} onClick={() => { stop.current = true; setStopRequested(true); }} className="min-h-9 font-semibold text-ink">{stopRequested ? "Finishing this company…" : "Stop after this company"}</button></div> : message}
    </div>
    {!shown.length ? <div className="mt-6 rounded-xl border border-dashed border-hairline p-10 text-center"><h3 className="font-semibold">No competitors to compare</h3><p className="mt-2 text-graphite">Confirmed competitors will appear here once setup completes.</p></div> :
    <div className="mt-5 grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3" aria-label="Competitor profiles">
      {shown.map(c => {
        const p = profileFor(c.id);
        const recent = recentCompetitorEvents(events.filter(e => e.competitor_id === c.id));
        const stale = profileNeedsRefresh(p, events.filter(e => e.competitor_id === c.id));
        const broken = monitors.filter(m => m.competitor_id === c.id && (m.status.startsWith("error") || ["failed", "paused"].includes(m.status))).length;
        return <article key={c.id} aria-label={`${displayName(c)} profile`} className="relative flex min-w-0 flex-col rounded-xl border border-hairline bg-surface [overflow-wrap:anywhere]">
          <header className="flex items-center gap-3 border-b border-hairline px-5 py-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-hairline bg-white">{c.logo_url ? <img src={c.logo_url} alt="" className="h-7 w-7 object-contain" /> : <span className="font-semibold">{displayName(c).slice(0,1)}</span>}</div>
            <div className="min-w-0 flex-1"><h3 className="text-[15px] font-semibold"><button type="button" className="min-h-8 text-left hover:underline" onClick={() => onSelect(c.id)}>{displayName(c)}</button></h3><p className="text-[11px] text-graphite"><Source url={c.homepage_url ?? `https://${c.domain}`}>{c.domain}</Source></p></div>
            <span className="text-[10px] text-muted">{p ? timeAgo(p.captured_at) : "New"}</span>
          </header>
          <div className="flex-1 space-y-5 p-5">
            {errors[c.id] && <div className="rounded-lg bg-canvas p-3 text-[12px] text-graphite"><p role="status">{p ? "Last update couldn't finish. Your saved research is still shown." : "Research couldn't finish just now. Please try again."}</p><button type="button" disabled={!!progress} onClick={() => research([c], retryActions.current[c.id] ?? "research")} className="mt-1 min-h-9 font-semibold text-ink">Retry {displayName(c)} update</button></div>}
            {show("positioning") && <Block title="Positioning"><Facts profile={p} items={p?.positioning ? [p.positioning] : []} /></Block>}
            {show("audience") && <Block title="Who they serve"><Audience profile={p} compact={category === "overview"} />{p && !p.target_customers.length && !p.audience_analysis?.segments.length && <button type="button" disabled={!!progress} onClick={() => research([c], "audience")} className="mt-2 min-h-9 text-[12px] font-semibold underline decoration-hairline underline-offset-4">Estimate {displayName(c)} audience</button>}</Block>}
            {show("offering") && <Block title="Products & services"><Facts profile={p} items={category === "overview" ? p?.capabilities.slice(0, 3) ?? [] : p?.capabilities ?? []} />{category === "overview" && (p?.capabilities.length ?? 0) > 3 && <button type="button" className="mt-1 min-h-9 text-[12px] font-medium text-graphite hover:text-ink" onClick={() => setCategory("offering")}>View all offerings →</button>}</Block>}
            {category === "pricing" && <Block title="Pricing & business model">{p?.pricing_model && <div className="mb-4"><Facts profile={p} items={[p.pricing_model]} /></div>}<Pricing competitor={c} card={cards[c.id]} /></Block>}
            {(category === "signals" || category === "overview" && recent.length > 0) && <Block title="Recent signals">{recent.length ? <ul className="space-y-3">{recent.map(e => <li key={e.id} className="text-[13px]"><p className="mb-1 text-[10px] text-muted">{SIGNAL_LABEL[e.signal]} · {timeAgo(e.detected_at ?? e.received_at)}</p><Source url={e.url}>{e.title ?? e.summary ?? "Change detected"}</Source></li>)}</ul> : <p className="text-[13px] text-graphite">No recent changes detected.</p>}</Block>}
          </div>
          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline px-5 py-3 text-[11px] text-graphite">
            <details><summary className="min-h-9 cursor-pointer content-center">{stale ? "Research may need updating" : "Research details"}</summary><div className="max-w-xs space-y-2 py-2"><p>{p ? `Updated ${timeAgo(p.captured_at)} · ${p.pages?.length ?? 1} company pages` : "Research not captured yet"}</p>{p?.locale && <p>Summary language: {comparisonLanguageName(p.locale)}</p>}{!!broken && <p>Some live sources need attention.</p>}{p?.warnings?.length ? <p>Some company pages were unavailable during the last update.</p> : null}<p>Sources show company statements. AI audience estimates are interpretations.</p></div></details>
            <button type="button" disabled={!!progress} onClick={() => research([c])} aria-label={`${p ? "Refresh" : "Research"} ${displayName(c)} profile`} className="min-h-9 font-medium text-ink hover:underline">{p ? "Refresh" : "Research"} ↗</button>
          </footer>
        </article>;
      })}
    </div>}
  </section>;
}
