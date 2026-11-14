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
import { useReadChanges } from "./use-read-changes";

type Props = {
  workspace: Workspace;
  competitors: Competitor[];
  cards: Record<string, Battlecard>;
  events: EventRow[];
  fresh: Set<string>;
  monitors: MonitorStatus[];
  dataLoading?: boolean;
  onProfileSaved?: (id: string, profile: ComparisonProfile) => void;
};

const eventTime = (e: EventRow) => e.detected_at ?? e.received_at;

export function Dashboard({ workspace, competitors, cards, events, fresh, monitors, dataLoading, onProfileSaved }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<"matrix" | "changes">("matrix");

  // Remember the selection in the URL so a refresh (or a teammate) lands on the same view.
  useEffect(() => {
    const restore = () => {
      const params = new URLSearchParams(window.location.search);
      setSelected(params.get("c"));
      setView(params.get("view") === "changes" ? "changes" : "matrix");
    };
    restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  const select = (id: string | null, nextView = view) => {
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
    for (const e of events) (m[e.competitor_id] ??= []).push(e);
    return m;
  }, [events]);

  const current = competitors.find((c) => c.id === selected);
  const isUnread = useReadChanges(workspace.id, events, current?.id ?? null, !selected && view === "changes", !!dataLoading);
  const unreadCount = events.filter(isUnread).length;
  const names = Object.fromEntries(competitors.map((c) => [c.id, displayName(c)]));

  return (
    <div className="flex min-w-0 flex-1 flex-col lg:flex-row">
      <nav aria-label="Competitors" className="min-w-0 border-b border-hairline bg-surface lg:w-64 lg:shrink-0 lg:border-r lg:border-b-0">
        <ul className="flex gap-1 overflow-x-auto p-2 [scrollbar-width:thin] lg:flex-col lg:overflow-visible">
          <RailItem active={!selected && view === "matrix"} onClick={() => select(null, "matrix")} label="Competitor overview" count={0} />
          <RailItem active={!selected && view === "changes"} onClick={() => select(null, "changes")} label="All changes" count={unreadCount} />
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
        <WorkspaceTools workspaceId={workspace.id} events={events} names={names} monitors={monitors} />
        {!current && <MarketBriefPanel key={workspace.id} workspaceId={workspace.id} companyName={workspace.name} eventVersion={events.map(event => `${event.id}:${event.processed_at ?? ""}`).join("|")} loading={dataLoading} />}
        {current ? (
          <BattlecardView
            key={current.id}
            competitor={current}
            card={cards[current.id]}
            events={byCompetitor[current.id] ?? []}
            fresh={fresh}
            monitors={monitors.filter((m) => m.competitor_id === current.id)}
          />
        ) : view === "matrix" ? (
          <ComparisonMatrix workspaceId={workspace.id} competitors={competitors} cards={cards} events={events} monitors={monitors} onSelect={select} loading={dataLoading} onProfileSaved={onProfileSaved} />
        ) : (
          <Overview workspace={workspace} competitors={competitors} cards={cards} events={events} fresh={fresh} onSelect={select} byCompetitor={byCompetitor} />
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
}: {
  workspace: Workspace;
  competitors: Competitor[];
  cards: Record<string, Battlecard>;
  events: EventRow[];
  fresh: Set<string>;
  onSelect: (id: string) => void;
  byCompetitor: Record<string, EventRow[]>;
}) {
  const byId = Object.fromEntries(competitors.map((c) => [c.id, c]));
  const groups = useMemo(() => {
    const g: { day: string; items: EventRow[] }[] = [];
    for (const e of [...events].sort((a, b) => eventTime(b).localeCompare(eventTime(a)))) {
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
            <p className="font-semibold">Nothing has changed yet</p>
            <p className="mt-1 max-w-prose text-graphite">
              Pricing pages are checked every 15 minutes and everything else every hour. Use Check now to look right away.
            </p>
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.day} className="mt-5">
              <h3 className="mb-2 text-[13px] font-semibold text-graphite">{g.day}</h3>
              <ul className="divide-y divide-hairline overflow-hidden rounded-lg border border-hairline bg-surface">
                {g.items.map((e) => (
                  <ChangeItem key={e.id} event={e} competitor={byId[e.competitor_id]} fresh={fresh.has(e.id)} onSelectCompetitor={onSelect} />
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
