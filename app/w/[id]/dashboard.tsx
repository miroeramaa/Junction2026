"use client";

import { useEffect, useMemo, useState } from "react";
import { dayLabel, timeAgo } from "@/lib/time";
import { displayName, SIGNAL_LABEL, type Battlecard, type Competitor, type EventRow, type MonitorStatus, type Workspace } from "@/lib/types";
import { BattlecardView } from "./battlecard";
import { ChangeItem } from "./redline";
import { ComparisonMatrix } from "./comparison-matrix";
import type { ComparisonProfile } from "@/lib/comparison";
import { ChangeSearch, DigestSettings, MonitoringFrequency } from "./workspace-tools";
import { MarketBriefPanel } from "./market-brief";
import { ManageCompetitors, WorkspaceRemoval } from "./manage-competitors";
import { triageSignals, type Feedback } from "@/lib/signals";
import { useReadChanges } from "./use-read-changes";

type View = "matrix" | "changes" | "brief" | "manage";
type Props = {
  workspace:Workspace; competitors:Competitor[]; cards:Record<string,Battlecard>; events:EventRow[];
  fresh:Set<string>; monitors:MonitorStatus[]; dataLoading?:boolean; onControlsChanged:()=>void;
  onProfileSaved?:(id:string,profile:ComparisonProfile)=>void;
};
const eventTime=(event:EventRow)=>event.detected_at??event.received_at;

export function Dashboard({workspace,competitors,cards,events,fresh,monitors,dataLoading,onProfileSaved,onControlsChanged}:Props) {
  const [selected,setSelected]=useState<string|null>(null);
  const [view,setView]=useState<View>("matrix");
  const [settings,setSettings]=useState<"sources"|"digest">("sources");
  const [filter,setFilter]=useState<"important"|"all">("important");
  const [query,setQuery]=useState("");
  const [feedback,setFeedback]=useState<Feedback>({});
  const [feedbackError,setFeedbackError]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();
    fetch(`/api/workspaces/${workspace.id}/events/feedback`,{signal:controller.signal}).then(async response=>{
      if(!response.ok)throw new Error("feedback");
      const result=await response.json();if(!controller.signal.aborted){setFeedback(old=>({...result.feedback,...old}));setFeedbackError(false);}
    }).catch(()=>{if(!controller.signal.aborted)setFeedbackError(true);});
    return ()=>controller.abort();
  },[workspace.id]);
  useEffect(()=>{
    const restore=()=>{
      const params=new URLSearchParams(location.search);
      setSelected(params.get("c"));
      const requested=params.get("view");
      setView(requested==="changes"||requested==="brief"||requested==="manage"?requested:"matrix");
      setFilter(params.get("signals")==="all"?"all":"important");
      setSettings(params.get("settings")==="digest"?"digest":"sources");
    };
    restore();window.addEventListener("popstate",restore);
    return ()=>window.removeEventListener("popstate",restore);
  },[]);
  function select(id:string|null,nextView:View="matrix") {
    setSelected(id);setView(nextView);setQuery("");
    const url=new URL(location.href);
    url.searchParams.delete("profile");
    if(id)url.searchParams.set("c",id);else url.searchParams.delete("c");
    url.searchParams.set("view",nextView);history.replaceState(null,"",url);
  }
  function changeFilter(mode:"important"|"all") {
    setFilter(mode);const url=new URL(location.href);
    if(mode==="all")url.searchParams.set("signals","all");else url.searchParams.delete("signals");
    history.replaceState(null,"",url);
  }
  async function rate(eventId:string,rating:NonNullable<Feedback[string]>):Promise<boolean> {
    try {
      const response=await fetch(`/api/workspaces/${workspace.id}/events/${eventId}/feedback`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({rating})});
      if(!response.ok)return false;
      setFeedback(old=>({...old,[eventId]:rating}));return true;
    }catch{return false;}
  }
  const assessed=useMemo(()=>triageSignals(events.filter(event=>competitors.some(c=>c.id===event.competitor_id)),feedback),[events,competitors,feedback]);
  const visibleEvents=useMemo(()=>filter==="all"?assessed:assessed.filter(event=>event.assessment.priority!=="quiet"),[assessed,filter]);
  const current=competitors.find(c=>c.id===selected);
  const isUnread=useReadChanges(workspace.id,visibleEvents,current?.id??null,!selected&&view==="changes",!!dataLoading);
  const unreadCount=visibleEvents.filter(isUnread).length;
  const names=Object.fromEntries(competitors.map(c=>[c.id,displayName(c)]));
  const profileEvents=current?visibleEvents.filter(event=>event.competitor_id===current.id):[];

  return <div className="flex min-w-0 flex-1 flex-col lg:flex-row">
    <nav aria-label="Competitors" className="min-w-0 border-b border-hairline bg-surface lg:w-60 lg:shrink-0 lg:border-r lg:border-b-0">
      <ul className="grid grid-cols-2 gap-1 p-2 sm:grid-cols-4 lg:flex lg:flex-col lg:p-3">
        <RailItem active={!selected&&view==="matrix"} onClick={()=>select(null,"matrix")} label="Competitor overview" count={0}/>
        <RailItem active={!selected&&view==="changes"} onClick={()=>select(null,"changes")} label="All changes" count={unreadCount}/>
        <RailItem active={!selected&&view==="brief"} onClick={()=>select(null,"brief")} label="Market brief" count={0}/>
        <RailItem active={!selected&&view==="manage"} onClick={()=>select(null,"manage")} label="Manage watchlist" count={0}/>
      </ul>
      <label className="mx-3 mb-3 block text-[11px] font-medium text-graphite lg:hidden">Open competitor<select value={selected??""} onChange={event=>select(event.target.value||null)} className="mt-1 min-h-11 w-full rounded-lg border border-hairline bg-surface px-3 text-[13px] text-ink"><option value="">Choose a company</option>{competitors.map(c=><option key={c.id} value={c.id}>{displayName(c)}</option>)}</select></label>
      <div className="hidden border-t border-hairline px-3 pt-4 lg:block"><p className="px-3 text-[10px] font-semibold uppercase tracking-widest text-muted">Companies · {competitors.length}</p><ul className="mt-2 space-y-1">{competitors.map(c=>{
        const list=visibleEvents.filter(event=>event.competitor_id===c.id);
        return <RailItem key={c.id} active={selected===c.id} onClick={()=>select(c.id)} label={displayName(c)} logo={c.logo_url} count={list.filter(isUnread).length} live={list.some(event=>fresh.has(event.id)&&isUnread(event))}/>;
      })}</ul></div>
    </nav>
    <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8"><div className="mx-auto w-full max-w-7xl">
      {current?<BattlecardView key={current.id} competitor={current} card={cards[current.id]} events={profileEvents} fresh={fresh} onRate={rate} monitors={monitors.filter(m=>m.competitor_id===current.id)} onManage={()=>select(null,"manage")} filterMode={filter} onFilterChange={changeFilter}/>
      :view==="matrix"?<ComparisonMatrix workspaceId={workspace.id} competitors={competitors} cards={cards} events={visibleEvents} monitors={monitors} onSelect={select} loading={dataLoading} onProfileSaved={onProfileSaved}/>
      :view==="brief"?<div className="mx-auto w-full max-w-5xl"><MarketBriefPanel workspaceId={workspace.id} companyName={workspace.name} eventVersion={events.map(event=>`${event.id}:${event.processed_at??""}`).join("|")+JSON.stringify(feedback)} loading={dataLoading}/></div>
      :view==="manage"?<>
        <div role="group" aria-label="Watchlist settings" className="mb-6 flex w-fit gap-1 rounded-lg border border-hairline bg-surface p-1">{(["sources","digest"] as const).map(mode=><button key={mode} type="button" aria-pressed={settings===mode} onClick={()=>{setSettings(mode);const url=new URL(location.href);url.searchParams.set("settings",mode);history.replaceState(null,"",url);}} className="min-h-10 rounded-md px-4 text-[12px] font-semibold aria-pressed:bg-ink aria-pressed:text-white">{mode==="sources"?"Competitors & sources":"Email digest"}</button>)}</div>
        {settings==="digest"?<DigestSettings workspaceId={workspace.id}/>:<><ManageCompetitors workspaceId={workspace.id} competitors={competitors} monitors={monitors} onChanged={onControlsChanged}><MonitoringFrequency workspaceId={workspace.id} names={names} monitors={monitors}/></ManageCompetitors><WorkspaceRemoval workspaceId={workspace.id} companyName={workspace.name}/></>}
      </>:<>
        <header className="mb-6"><p className="text-[10px] font-semibold uppercase tracking-widest text-muted">Evidence, as it arrives</p><h2 className="mt-1 text-3xl font-semibold tracking-tight">All changes</h2><p className="mt-2 text-[13px] text-graphite">Review competitor developments and open the original sources.</p></header>
        <section aria-label="Signal filtering" className="mb-6 flex flex-wrap items-center gap-3 border-b border-hairline pb-4">
          <ChangeSearch query={query} onChange={setQuery}/><div role="group" aria-label="Changes shown" className="flex gap-1 rounded-lg border border-hairline bg-surface p-1">{(["important","all"] as const).map(mode=><button key={mode} type="button" aria-pressed={filter===mode} onClick={()=>changeFilter(mode)} className="min-h-9 rounded-md px-3 text-[12px] font-medium aria-pressed:bg-ink aria-pressed:text-white">{mode==="important"?"Important":"All changes"}</button>)}</div>
          <p className="basis-full text-[11px] text-graphite">{assessed.filter(event=>event.assessment.priority==="quiet").length} routine, repeated or hidden updates {filter==="all"?"included":"filtered out"}.{feedbackError?" Team preferences couldn’t load; basic filtering is active.":""}</p>
        </section>
        <ChangeFeed competitors={competitors} events={visibleEvents.filter(event=>!query.trim()||[event.title,event.summary,event.diff,names[event.competitor_id],SIGNAL_LABEL[event.signal]].some(text=>text?.toLowerCase().includes(query.trim().toLowerCase())))} fresh={fresh} onSelect={select} onRate={rate} query={query}/>
      </>}
    </div></main>
  </div>;
}

function RailItem({
  active,
  onClick,
  label,
  logo,
  count,
  hint,
  live,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  logo?: string | null;
  count: number;
  hint?: string;
  live?: boolean;
}) {
  return (
    <li className="shrink-0">
      <button
        onClick={onClick}
        aria-current={active ? "page" : undefined}
        className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left ${active ? "bg-canvas" : "hover:bg-canvas/60"} ${live ? "just-arrived" : ""}`}
      >
        {logo !== undefined && (logo ? <img src={logo} alt="" className="h-5 w-5 rounded object-contain" /> : <span className="h-5 w-5 rounded bg-canvas" />)}
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[14px] ${active ? "font-semibold" : ""}`}>{label}</span>
          {hint && <span className="hidden text-[12px] text-muted lg:block">{hint}</span>}
        </span>
        {count > 0 && (
          <span className="tabular rounded-full bg-redline px-1.5 text-[12px] font-semibold text-white" title={`${count} unread ${count === 1 ? "change" : "changes"}`}>
            {count}
          </span>
        )}
      </button>
    </li>
  );
}

function ChangeFeed({competitors,events,fresh,onSelect,onRate,query}: {competitors:Competitor[];events:EventRow[];fresh:Set<string>;onSelect:(id:string)=>void;onRate:(id:string,rating:"useful"|"not_useful")=>Promise<boolean>;query:string}) {
  const byId=Object.fromEntries(competitors.map(c=>[c.id,c]));
  const groups=useMemo(()=>{
    const result:{day:string;items:EventRow[]}[]=[];
    const ordered=[...events].sort((a,b)=>dayLabel(eventTime(a))===dayLabel(eventTime(b))?Number(b.assessment?.priority==="high")-Number(a.assessment?.priority==="high")||eventTime(b).localeCompare(eventTime(a)):eventTime(b).localeCompare(eventTime(a)));
    for(const event of ordered){const day=dayLabel(eventTime(event));if(result.at(-1)?.day===day)result.at(-1)!.items.push(event);else result.push({day,items:[event]});}
    return result;
  },[events]);
  return <section aria-label="Changes" className="max-w-4xl">
    {query&&<p role="status" className="mb-4 text-[12px] text-graphite">{events.length} matching {events.length===1?"change":"changes"}</p>}
    {groups.length?groups.map(group=><div key={group.day} className="mb-6"><h3 className="mb-3 text-[12px] font-semibold text-graphite">{group.day}</h3><ul className="divide-y divide-hairline rounded-xl border border-hairline bg-surface">{group.items.map(event=><ChangeItem key={event.id} event={event} competitor={byId[event.competitor_id]} fresh={fresh.has(event.id)} onSelectCompetitor={onSelect} onRate={onRate}/>)}</ul></div>):<div className="rounded-xl border border-dashed border-hairline bg-surface p-8 text-center"><p className="font-semibold">{query?"No matching changes":"No changes in this view"}</p><p className="mt-2 text-[13px] text-graphite">{query?"Try a shorter phrase, another company, or include All changes.":"Try All changes to include filtered updates, or check again later."}</p></div>}
  </section>;
}
