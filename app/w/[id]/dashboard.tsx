"use client";

// Watching state: competitor list on the left, all changes or one battlecard on the right.

import { useEffect, useMemo, useState } from "react";
import { entryPrice, formatUsd } from "@/lib/pricing-view";
import { dayLabel, timeAgo } from "@/lib/time";
import { displayName, type Battlecard, type Competitor, type EventRow, type MonitorStatus, type Workspace } from "@/lib/types";
import { BattlecardView } from "./battlecard";
import { ChangeItem } from "./redline";
import { ComparisonMatrix } from "./comparison-matrix";
import type { ComparisonProfile } from "@/lib/comparison";
import { sourceLabel } from "./source";
import { WorkspaceTools } from "./workspace-tools";
import { MarketBriefPanel } from "./market-brief";
import { ManageCompetitors } from "./manage-competitors";
import { triageSignals, type Feedback } from "@/lib/signals";
import { useReadChanges } from "./use-read-changes";

type Props = {
  workspace: Workspace;
  competitors: Competitor[];
  cards: Record<string, Battlecard>;
  events: EventRow[];
  fresh: Set<string>;
  monitors: MonitorStatus[];
  dataLoading?: boolean;
  onControlsChanged: () => void;
  onProfileSaved?: (id: string, profile: ComparisonProfile) => void;
};

const eventTime = (e: EventRow) => e.detected_at ?? e.received_at;

export function Dashboard({ workspace, competitors, cards, events, fresh, monitors, dataLoading, onProfileSaved, onControlsChanged }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<"matrix" | "changes" | "manage">("matrix");

  const [filter,setFilter] = useState<"important"|"all">("important");
  const [feedback,setFeedback] = useState<Feedback>({});
  const [feedbackError,setFeedbackError] = useState(false);
  useEffect(()=>{
    const controller=new AbortController();
    fetch(`/api/workspaces/${workspace.id}/events/feedback`,{signal:controller.signal}).then(async response=>{
      if(!response.ok)throw new Error("feedback");
      const result=await response.json();if(!controller.signal.aborted){setFeedback(old=>({...result.feedback,...old}));setFeedbackError(false);}
    }).catch(()=>{if(!controller.signal.aborted)setFeedbackError(true);});
    return ()=>controller.abort();
  },[workspace.id]);
  async function rate(eventId:string,rating:NonNullable<Feedback[string]>):Promise<boolean> {
    try {
      const response=await fetch(`/api/workspaces/${workspace.id}/events/${eventId}/feedback`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({rating})});
      if(!response.ok)return false;
      setFeedback(old=>({...old,[eventId]:rating}));return true;
    }catch{return false;}
  }
  const assessed=useMemo(()=>triageSignals(events.filter(event=>competitors.some(c=>c.id===event.competitor_id)),feedback),[events,competitors,feedback]);
  const visibleEvents=useMemo(()=>filter==="all"?assessed:assessed.filter(event=>event.assessment.priority!=="quiet"),[assessed,filter]);
  const scope=selected?assessed.filter(event=>event.competitor_id===selected):assessed;
  const quietCount=scope.filter(event=>event.assessment.priority==="quiet").length;
  // Remember the selection in the URL so a refresh (or a teammate) lands on the same view.
  useEffect(() => {
    const restore = () => {
      const params = new URLSearchParams(window.location.search);
      setSelected(params.get("c"));
      setView(params.get("view") === "manage" ? "manage" : params.get("view") === "changes" ? "changes" : "matrix");
      setFilter(params.get("signals") === "all" ? "all" : "important");
    };
    restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  const select = (id: string | null, nextView: "matrix" | "changes" | "manage" = view === "manage" ? "matrix" : view) => {
    setSelected(id);
    setView(nextView);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("c", id);
    else url.searchParams.delete("c");
    url.searchParams.set("view", nextView);
    window.history.replaceState(null, "", url);
  };

  const byCompetitor = useMemo(() => {
    const m: Record<string, EventRow[]> = {};
    for (const e of visibleEvents) (m[e.competitor_id] ??= []).push(e);
    return m;
  }, [visibleEvents]);

  const current = competitors.find((c) => c.id === selected);
  const isUnread = useReadChanges(workspace.id, visibleEvents, current?.id ?? null, !selected && view === "changes", !!dataLoading);
  const unreadCount = visibleEvents.filter(isUnread).length;
  const names = Object.fromEntries(competitors.map((c) => [c.id, displayName(c)]));

  return (
    <div className="flex min-w-0 flex-1 flex-col lg:flex-row">
      <nav aria-label="Competitors" className="min-w-0 border-b border-hairline bg-surface lg:w-64 lg:shrink-0 lg:border-r lg:border-b-0">
        <ul className="flex gap-1 overflow-x-auto p-2 [scrollbar-width:thin] lg:flex-col lg:overflow-visible">
          <RailItem active={!selected && view === "matrix"} onClick={() => select(null, "matrix")} label="Competitor overview" count={0} />
          <RailItem active={!selected && view === "changes"} onClick={() => select(null, "changes")} label="All changes" count={unreadCount} />
          <RailItem active={!selected && view === "manage"} onClick={() => select(null, "manage")} label="Manage watchlist" count={0} />
          <li className="hidden px-3 pt-4 pb-1 text-[12px] text-muted lg:block">Competitors</li>
          {competitors.map((c) => {
            const list = byCompetitor[c.id] ?? [];
            return (
              <RailItem
                key={c.id}
                active={selected === c.id}
                onClick={() => select(c.id)}
                label={displayName(c)}
                logo={c.logo_url}
                count={list.filter(isUnread).length}
                hint={list[0] ? `Changed ${timeAgo(eventTime(list[0]))}` : "No changes yet"}
                live={list.some((e) => fresh.has(e.id) && isUnread(e))}
              />
            );
          })}
        </ul>
      </nav>

      <main className="min-w-0 flex-1 px-3 py-4 sm:px-4 sm:py-6 lg:px-8">
        <WorkspaceTools workspaceId={workspace.id} events={assessed} names={names} monitors={monitors} feedback={feedback} onFeedbackSaved={(id,rating)=>setFeedback(old=>({...old,[id]:rating}))} />
        {!current && view !== "manage" && <MarketBriefPanel key={workspace.id} workspaceId={workspace.id} companyName={workspace.name} eventVersion={events.map(event => `${event.id}:${event.processed_at ?? ""}`).join("|") + JSON.stringify(feedback)} loading={dataLoading} />}
        {view !== "manage" && <section aria-label="Signal filtering" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-hairline bg-surface p-3">
          <div><p className="text-[12px] font-semibold">Focus on meaningful changes</p><p className="mt-1 text-[11px] text-graphite">{quietCount ? `${quietCount} routine, repeated or hidden updates ${filter==="all"?"included":"filtered out"}.` : "Noise is filtered without deleting captured history."}{feedbackError?" Team preferences couldn’t load; basic filtering is still active.":""}</p></div>
          <div role="group" aria-label="Changes shown" className="flex rounded-lg bg-canvas p-1">{(["important","all"] as const).map(mode=><button key={mode} type="button" aria-pressed={filter===mode} onClick={()=>{setFilter(mode);const url=new URL(location.href);if(mode==="all")url.searchParams.set("signals","all");else url.searchParams.delete("signals");history.replaceState(null,"",url);}} className="min-h-10 rounded-md px-3 text-[12px] font-medium aria-pressed:bg-ink aria-pressed:text-white">{mode==="important"?"Important":"All changes"}</button>)}</div>
        </section>}
        {view === "manage" && !current ? <ManageCompetitors workspaceId={workspace.id} competitors={competitors} monitors={monitors} onChanged={onControlsChanged} /> : current ? (
          <BattlecardView
            key={current.id}
            competitor={current}
            card={cards[current.id]}
            events={byCompetitor[current.id] ?? []}
            fresh={fresh}
            onRate={rate}
            monitors={monitors.filter((m) => m.competitor_id === current.id)}
          />
        ) : view === "matrix" ? (
          <ComparisonMatrix workspaceId={workspace.id} competitors={competitors} cards={cards} events={visibleEvents} monitors={monitors} onSelect={select} loading={dataLoading} onProfileSaved={onProfileSaved} />
        ) : (
          <Overview workspace={workspace} competitors={competitors} cards={cards} events={visibleEvents} fresh={fresh} onSelect={select} byCompetitor={byCompetitor} onRate={rate} />
        )}
      </main>
    </div>
  );
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

function Overview({
  workspace,
  competitors,
  cards,
  events,
  fresh,
  onSelect,
  byCompetitor,
  onRate,
}: {
  workspace: Workspace;
  competitors: Competitor[];
  cards: Record<string, Battlecard>;
  events: EventRow[];
  fresh: Set<string>;
  onSelect: (id: string) => void;
  byCompetitor: Record<string, EventRow[]>;
  onRate: (eventId:string,rating:NonNullable<Feedback[string]>)=>Promise<boolean>;
}) {
  const byId = Object.fromEntries(competitors.map((c) => [c.id, c]));
  const groups = useMemo(() => {
    const g: { day: string; items: EventRow[] }[] = [];
    for (const e of [...events].sort((a, b) => dayLabel(eventTime(b)) === dayLabel(eventTime(a)) ? Number(b.assessment?.priority === "high") - Number(a.assessment?.priority === "high") || eventTime(b).localeCompare(eventTime(a)) : eventTime(b).localeCompare(eventTime(a)))) {
      const day = dayLabel(eventTime(e));
      if (g.at(-1)?.day === day) g.at(-1)!.items.push(e);
      else g.push({ day, items: [e] });
    }
    return g;
  }, [events]);
  const since = competitors.map((c) => c.created_at).sort()[0];

  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_26rem] xl:gap-8">
      <section aria-labelledby="changes-h">
        <h2 id="changes-h" className="text-xl font-semibold tracking-tight">Changes</h2>
        <p className="mt-1 text-[13px] text-graphite">Everything your competitors changed since we started watching {timeAgo(since)}.</p>
        {groups.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-hairline bg-surface px-5 py-8">
            <p className="font-semibold">No changes in this view</p>
            <p className="mt-1 max-w-prose text-graphite">
              Try All changes to include filtered updates, or use Check now to look for new developments.
            </p>
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.day} className="mt-5">
              <h3 className="mb-2 text-[13px] font-semibold text-graphite">{g.day}</h3>
              <ul className="divide-y divide-hairline overflow-hidden rounded-lg border border-hairline bg-surface">
                {g.items.map((e) => (
                  <ChangeItem key={e.id} event={e} competitor={byId[e.competitor_id]} fresh={fresh.has(e.id)} onSelectCompetitor={onSelect} onRate={onRate} />
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      <section aria-labelledby="glance-h">
        <h2 id="glance-h" className="text-xl font-semibold tracking-tight">Pricing at a glance</h2>
        <p className="mt-1 text-[13px] text-graphite">Cheapest paid plan, read from each pricing page (↗ opens it).</p>
        <div className="mt-4 overflow-hidden rounded-lg border border-hairline bg-surface">
          <table className="w-full table-fixed text-left text-[12px] sm:text-[13px]">
            <thead className="border-b border-hairline text-[12px] text-muted">
              <tr>
                <th className="w-[38%] px-3 py-2 font-normal sm:px-4">Competitor</th>
                <th className="w-[30%] px-2 py-2 font-normal">Entry plan</th>
                <th className="w-[32%] px-3 py-2 text-right font-normal sm:px-4">Per month</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {competitors.map((c) => {
                const entry = cards[c.id]?.pricing ? entryPrice(cards[c.id].pricing!.plans) : null;
                const lastPricing = (byCompetitor[c.id] ?? []).find((e) => e.signal === "pricing");
                return (
                  <tr key={c.id} className="cursor-pointer hover:bg-canvas/60" onClick={() => onSelect(c.id)}>
                    <td className="break-words px-3 py-2.5 sm:px-4">
                      <span className="font-semibold">{displayName(c)}</span>
                      {lastPricing && <span className="block text-[12px] text-redline">Pricing changed {timeAgo(eventTime(lastPricing))}</span>}
                    </td>
                    <td className="break-words px-2 py-2.5 text-graphite">
                      {entry ? entry.plan.name : cards[c.id]?.pricing ? "No paid plan listed" : "Reading…"}
                      {cards[c.id]?.pricing && c.pricing_url && (
                        <a
                          href={c.pricing_url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          title={`Source: ${sourceLabel(c.pricing_url, 60)}`}
                          aria-label={`Source: ${displayName(c)} pricing page`}
                          className="ml-1 text-muted hover:text-ink"
                        >
                          ↗
                        </a>
                      )}
                    </td>
                    <td className="tabular whitespace-nowrap px-3 py-2.5 text-right font-semibold sm:px-4">
                      {entry ? formatUsd(entry.value) : "–"}
                      {entry?.basis === "yearly" && <span className="block text-[11px] font-normal text-muted">billed yearly</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[12px] text-muted">
          {workspace.name} is compared against {competitors.filter((c) => !c.is_sandbox).length} competitors.
        </p>
      </section>
    </div>
  );
}
