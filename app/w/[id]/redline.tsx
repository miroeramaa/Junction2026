"use client";

// A change, shown as a tracked change: removed text struck in red, added text underlined.

import { displayName, SIGNAL_LABEL, type Competitor, type EventRow } from "@/lib/types";
import { clock, timeAgo } from "@/lib/time";
import { hostOf, SourceLink } from "./source";

export function pageTitle(url: string): string {
  try {
    const slug = new URL(url).pathname.split("/").filter(Boolean).pop() ?? url;
    const words = decodeURIComponent(slug).replace(/[-_]+/g, " ").replace(/\.\w+$/, "");
    return words.charAt(0).toUpperCase() + words.slice(1);
  } catch {
    return url;
  }
}

export function Diff({ diff, max = 8 }: { diff: string; max?: number }) {
  const lines = diff.split("\n").filter((l) => /^[+-]\s?\S/.test(l));
  if (!lines.length) return null;
  return (
    <div className="mt-2 space-y-0.5 border-l-2 border-redline pl-3 text-[13px]">
      {lines.slice(0, max).map((l, i) =>
        l.startsWith("-") ? (
          <p key={i} className="struck">{l.replace(/^-\s?/, "")}</p>
        ) : (
          <p key={i} className="inserted">{l.replace(/^\+\s?/, "")}</p>
        ),
      )}
      {lines.length > max && <p className="text-muted">{lines.length - max} more changed lines</p>}
    </div>
  );
}

function latency(e: EventRow): string | null {
  if (!e.battlecard_updated_at || !e.detected_at) return null;
  return `${((Date.parse(e.battlecard_updated_at) - Date.parse(e.detected_at)) / 1000).toFixed(1)} s`;
}

export function ChangeItem({
  event,
  competitor,
  fresh,
  showCompetitor = true,
  onSelectCompetitor,
}: {
  event: EventRow;
  competitor?: Competitor;
  fresh?: boolean;
  showCompetitor?: boolean;
  onSelectCompetitor?: (id: string) => void;
}) {
  const at = event.detected_at ?? event.received_at;
  const added = event.added_urls ?? [];
  const matched = event.signal === "news" ? (event.matched_urls ?? []) : [];
  const title = event.signal === "launches" && added.length ? `Published ${added.length === 1 ? "a new page" : `${added.length} new pages`}` : event.title;
  const lat = latency(event);

  return (
    <li className={`grid grid-cols-[3.5rem_1fr] gap-3 px-4 py-3 ${fresh ? "just-arrived" : ""}`}>
      <time dateTime={at} title={new Date(at).toLocaleString()} className="tabular pt-0.5 text-[13px] text-muted">
        {clock(at)}
      </time>
      <div className="min-w-0">
        <p className="text-[13px] text-graphite">
          {showCompetitor && competitor && (
            <button className="font-semibold text-ink hover:underline" onClick={() => onSelectCompetitor?.(competitor.id)}>
              {displayName(competitor)}
            </button>
          )}
          {showCompetitor && competitor ? ", " : ""}
          {showCompetitor && competitor ? SIGNAL_LABEL[event.signal].toLowerCase() : SIGNAL_LABEL[event.signal]}
          {event.importance === "high" && <span className="ml-2 font-semibold text-redline">Important</span>}
        </p>
        <p className="mt-0.5 font-semibold">{title}</p>
        {event.summary && event.signal !== "launches" && <p className="mt-0.5 text-graphite">{event.summary}</p>}
        {added.length > 0 && (
          <ul className="mt-2 space-y-0.5 border-l-2 border-redline pl-3 text-[13px]">
            {added.slice(0, 5).map((u) => (
              <li key={u}>
                <a href={u} target="_blank" rel="noreferrer" className="inserted hover:text-ink">
                  {pageTitle(u)}
                </a>
              </li>
            ))}
          </ul>
        )}
        {event.diff && event.signal !== "launches" && <Diff diff={event.diff} />}
        <p className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[12px] text-muted">
          {matched.length > 0 ? (
            <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-2">
              <span>{matched.length === 1 ? "Source" : "Sources"}</span>
              {matched.slice(0, 4).map((u) => (
                <SourceLink key={u} href={u} label={hostOf(u)} />
              ))}
              {matched.length > 4 && <span>+{matched.length - 4} more</span>}
            </span>
          ) : (
            event.url && (
              <span className="inline-flex min-w-0 items-baseline gap-x-1.5">
                Source <SourceLink href={event.url} />
              </span>
            )
          )}
          <span>{lat ? `Battlecard updated ${lat} after detection` : event.processed_at ? `Detected ${timeAgo(at)}` : "Updating battlecard…"}</span>
        </p>
      </div>
    </li>
  );
}
