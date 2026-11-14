"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { comparisonLocale, safeSourceUrl } from "@/lib/comparison";
import type { BriefRow, StrategicInsight } from "@/lib/market-brief";
import { timeAgo } from "@/lib/time";
import { SIGNAL_LABEL } from "@/lib/types";

type State = { row:BriefRow|null; eligible_events:number; stale:boolean; can_generate:boolean };
export function MarketBriefPanel({workspaceId, companyName, eventVersion, loading=false}: {workspaceId:string; companyName:string; eventVersion:string; loading?:boolean}) {
  const [data,setData] = useState<State|null>(null);
  const [locale,setLocale] = useState("en");
  const [fetching,setFetching] = useState(true);
  const [updating,setUpdating] = useState(false);
  const [error,setError] = useState<string|null>(null);
  const [unavailable,setUnavailable] = useState(false);
  const requestVersion = useRef(0);
  const mounted = useRef(true);
  const busy = useRef(false);
  useEffect(()=>{ mounted.current=true;setLocale(comparisonLocale(navigator.languages?.[0]??navigator.language)); return ()=>{mounted.current=false;requestVersion.current++;};},[workspaceId]);
  const load = useCallback(async()=>{
    const version=++requestVersion.current;
    try {
      const response=await fetch(`/api/workspaces/${workspaceId}/brief?locale=${encodeURIComponent(locale)}`,{cache:"no-store"});
      const result=await response.json();
      if (!mounted.current || version!==requestVersion.current) return;
      if (!response.ok) {setUnavailable(result.code==="storage");throw new Error("read");}
      setData(result);setUnavailable(false);setError(null);
    } catch {if(mounted.current&&version===requestVersion.current)setError("Couldn’t load the latest brief. Your saved insights will stay visible.");}
    finally {if(mounted.current&&version===requestVersion.current)setFetching(false);}
  },[workspaceId,locale]);
  useEffect(()=>{if(!loading&&!busy.current)void load();},[load,loading,eventVersion]);
  useEffect(()=>{
    if(loading)return;
    const timer=setInterval(()=>{if(!busy.current&&document.visibilityState==="visible")void load();},data?.row?.status==="generating"?5000:30000);
    return ()=>clearInterval(timer);
  },[data?.row?.status,load,loading]);
  async function generate() {
    if(busy.current)return;
    busy.current=true;setUpdating(true);setError(null);requestVersion.current++;
    try {
      const response=await fetch(`/api/workspaces/${workspaceId}/brief`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({locale})});
      const result=await response.json();
      if(!mounted.current)return;
      if(!response.ok){setError(result.code==="busy"?"Your brief is already updating. Check back in a moment.":result.code==="cooldown"?"Please wait a moment before updating again.":"The update couldn’t finish. Your saved insights are still available.");return;}
      setData(old=>({...old,eligible_events:old?.eligible_events??0,can_generate:old?.can_generate??false,stale:false,row:result.row}));
      await load();
    } catch {if(mounted.current)setError("The update couldn’t finish. Your saved insights are still available.");}
    finally {busy.current=false;if(mounted.current)setUpdating(false);}
  }
  const row=data?.row;
  const generating=updating||row?.status==="generating" && !!row.lease_until && Date.parse(row.lease_until)>Date.now();
  const insights=row?.content?.insights??[];
  return <section aria-labelledby="market-brief-heading" className="relative mb-7 min-w-0 rounded-xl border border-hairline bg-surface p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-widest text-muted">What this means for {companyName}</p><h2 id="market-brief-heading" className="mt-1 text-xl font-semibold tracking-tight">Market brief</h2><p className="mt-1 text-[12px] text-graphite">Strategic interpretations of recent competitor changes, with evidence.</p></div><div className="flex items-center gap-3">{row?.generated_at&&<span className="text-[11px] text-muted">Updated {timeAgo(row.generated_at)}</span>}<button type="button" disabled={generating||fetching||loading||unavailable||!data?.can_generate&&!row?.content} onClick={()=>void generate()} className="min-h-10 rounded-lg border border-hairline px-3 text-[12px] font-semibold hover:bg-canvas disabled:opacity-50">{generating?"Updating brief…":row?.content?"Refresh brief":"Generate brief"}</button></div></div>
    {data?.stale&&<p className="mt-3 text-[12px] text-graphite">New evidence is available. Refresh to update these interpretations.</p>}
    {error&&!unavailable&&<div role="status" className="mt-3 flex flex-wrap items-center gap-3 text-[12px] text-graphite"><p>{error}</p><button type="button" onClick={()=>void load()} className="min-h-9 font-semibold text-ink">Try loading again</button></div>}
    {!!insights.length&&<div className={`mt-5 grid min-w-0 gap-4 ${insights.length===2?"lg:grid-cols-2":insights.length>=3?"xl:grid-cols-3":""}`}>{insights.map((insight,index)=><InsightCard key={`${index}-${insight.headline}`} insight={insight} companyName={companyName} locale={row?.content?.locale} wide={insights.length===1} />)}</div>}
    {!insights.length&&<p role="status" className="mt-4 text-[13px] leading-relaxed text-graphite">{loading||fetching?"Loading your brief…":unavailable?"Market briefs will be available once workspace setup is complete.":row?.content?"No strong strategic conclusions from the checked changes yet. We’ll show fewer insights rather than turn weak evidence into a story.":data?.can_generate?"Recent changes are ready to analyze. Generate a brief to connect the evidence to your company’s priorities.":"Waiting for enough evidence: a significant change or related signals from multiple company pages. Routine updates alone won’t produce a strategy story."}</p>}
  </section>;
}

function InsightCard({insight,companyName,locale,wide}: {insight:StrategicInsight;companyName:string;locale?:string;wide:boolean}) {
  return <article aria-label={insight.headline} className={`min-w-0 rounded-lg border border-hairline p-4 [overflow-wrap:anywhere] ${wide?"grid gap-x-7 md:grid-cols-2":""}`} lang={locale}>
    <div>
      <div className="flex flex-wrap gap-2 text-[10px] font-semibold uppercase tracking-wide text-graphite"><span className="rounded-full bg-indigo-50 px-2 py-1 text-indigo-700">AI interpretation</span><span className="py-1">{insight.kind==="pattern"?"Pattern":"Significant change"} · {insight.confidence==="moderate"?"Moderate":"Tentative"} confidence</span></div>
      <h3 className="mt-3 text-[15px] font-semibold leading-snug">{insight.headline}</h3><p className="mt-2 text-[13px] leading-relaxed text-graphite">{insight.interpretation}</p>
    </div>
    <div>
      <h4 className={`${wide?"mt-4 md:mt-0":"mt-4"} text-[10px] font-semibold uppercase tracking-wide text-muted`}>Why it matters to {companyName}</h4><p className="mt-1 text-[13px] leading-relaxed">{insight.relevance}</p><h4 className="mt-4 text-[10px] font-semibold uppercase tracking-wide text-muted">Suggested investigation</h4><p className="mt-1 text-[13px] leading-relaxed">{insight.next_step}</p>
    </div>
    <details className={`mt-4 text-[12px] ${wide?"md:col-span-2":""}`}><summary className="min-h-9 cursor-pointer font-semibold">Observed changes ({insight.evidence.length})</summary><ul className={`mt-2 ${wide?"grid gap-4 md:grid-cols-2":"space-y-4"}`}>{insight.evidence.map(source=><li key={source.id}><p className="text-[10px] text-muted">{source.competitor_name} · {SIGNAL_LABEL[source.signal]} · {new Date(source.at).toLocaleDateString()}</p><a href={safeSourceUrl(source.url)} target="_blank" rel="noreferrer" className="mt-1 block font-medium underline decoration-hairline underline-offset-4">{source.title}<span className="sr-only"> (opens in a new tab)</span></a>{source.summary&&<p className="mt-1 leading-relaxed text-graphite">{source.summary}</p>}</li>)}</ul></details>
  </article>;
}
