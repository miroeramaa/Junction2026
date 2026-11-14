"use client";

// Workspace: onboarding progress → competitor review → live feed + battlecards. Everything updates via Realtime.

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import type { Battlecard, Competitor, EventRow, Workspace } from "@/lib/types";

type Row = { id: string };
function upsert<T extends Row>(list: T[], row: T): T[] {
  const i = list.findIndex((r) => r.id === row.id);
  return i === -1 ? [row, ...list] : list.map((r) => (r.id === row.id ? row : r));
}

function useWorkspace(id: string) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [cards, setCards] = useState<Record<string, Battlecard>>({});
  const [events, setEvents] = useState<EventRow[]>([]);

  useEffect(() => {
    const sb = supabaseBrowser();
    let compIds = new Set<string>();

    async function load() {
      const [{ data: ws }, { data: comps }] = await Promise.all([
        sb.from("workspaces").select("*").eq("id", id).single(),
        sb.from("competitors").select("*").eq("workspace_id", id).order("created_at"),
      ]);
      setWorkspace(ws);
      setCompetitors(comps ?? []);
      compIds = new Set((comps ?? []).map((c) => c.id));
      if (!compIds.size) return;
      const [{ data: bc }, { data: ev }] = await Promise.all([
        sb.from("battlecards").select("*").in("competitor_id", [...compIds]),
        sb
          .from("events")
          .select("id, competitor_id, monitor_id, signal, context_event_id, title, summary, importance, url, diff, detected_at, received_at, processed_at, battlecard_updated_at")
          .in("competitor_id", [...compIds])
          .order("received_at", { ascending: false })
          .limit(50),
      ]);
      setCards(Object.fromEntries((bc ?? []).map((b) => [b.competitor_id, b])));
      setEvents(ev ?? []);
    }
    load();

    const channel = sb
      .channel(`ws-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "workspaces", filter: `id=eq.${id}` }, (p) => {
        setWorkspace(p.new as Workspace);
        load(); // status change (e.g. review → watching) can come with new competitors/battlecards
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "competitors", filter: `workspace_id=eq.${id}` }, (p) => {
        if (p.eventType === "DELETE") {
          setCompetitors((l) => l.filter((c) => c.id !== (p.old as Row).id));
        } else {
          const c = p.new as Competitor;
          compIds.add(c.id);
          setCompetitors((l) => [...upsert(l, c)].sort((a, b) => a.created_at.localeCompare(b.created_at)));
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "battlecards" }, (p) => {
        const b = p.new as Battlecard;
        if (compIds.has(b.competitor_id)) setCards((m) => ({ ...m, [b.competitor_id]: b }));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, (p) => {
        const e = p.new as EventRow;
        if (compIds.has(e.competitor_id)) setEvents((l) => upsert(l, e));
      })
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, [id]);

  return { workspace, competitors, cards, events };
}

export function WorkspaceView({ id }: { id: string }) {
  const { workspace, competitors, cards, events } = useWorkspace(id);
  if (!workspace) return <p className="p-8">Loading…</p>;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <header className="flex items-center gap-3">
        {workspace.logo_url && <img src={workspace.logo_url} alt="" className="h-8 w-8 rounded" />}
        <h1 className="text-2xl font-bold">{workspace.name}</h1>
        <span className="rounded-full bg-zinc-500/15 px-2 py-0.5 text-xs">{workspace.status}</span>
        {workspace.status_detail && <span className="text-sm text-zinc-500">{workspace.status_detail}</span>}
      </header>

      {workspace.status === "error" && <p className="mt-4 text-red-500">Something went wrong: {workspace.status_detail}</p>}
      {(workspace.status === "discovering" || workspace.status === "review") && (
        <Review workspace={workspace} competitors={competitors} />
      )}
      {workspace.status === "watching" && <Watching workspaceId={id} competitors={competitors} cards={cards} events={events} />}
    </main>
  );
}

function Review({ workspace, competitors }: { workspace: Workspace; competitors: Competitor[] }) {
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [sandbox, setSandbox] = useState(true);
  const chosen = selected ?? new Set(competitors.map((c) => c.id));
  const ready = workspace.status === "review";

  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">{ready ? "Which competitors should we watch?" : "Finding competitors…"}</h2>
      <ul className="mt-4 space-y-2">
        {competitors.map((c) => (
          <li key={c.id} className="flex items-start gap-3 rounded-lg border border-zinc-500/20 p-3">
            <input
              type="checkbox"
              className="mt-1"
              disabled={!ready}
              checked={chosen.has(c.id)}
              onChange={() => {
                const next = new Set(chosen);
                if (next.has(c.id)) next.delete(c.id);
                else next.add(c.id);
                setSelected(next);
              }}
            />
            {c.logo_url && <img src={c.logo_url} alt="" className="h-6 w-6 rounded" />}
            <div>
              <div className="font-medium">
                {c.name} <span className="text-sm text-zinc-500">{c.domain}</span>
              </div>
              <div className="text-sm text-zinc-500">{c.why}</div>
              <div className="mt-1 flex gap-2 text-xs text-zinc-500">
                <span>{c.pricing_url ? "✓" : "✗"} pricing</span>
                <span>{c.blog_url ? "✓" : "✗"} blog</span>
                <span>{c.careers_url ? "✓" : "✗"} careers</span>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {ready && (
        <div className="mt-6 flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={sandbox} onChange={(e) => setSandbox(e.target.checked)} /> Add demo sandbox competitor
          </label>
          <button
            className="rounded-lg bg-zinc-100 px-4 py-2 font-medium text-zinc-900"
            onClick={() =>
              fetch(`/api/workspaces/${workspace.id}/confirm`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ competitorIds: [...chosen], sandbox }),
              })
            }
          >
            Start watching {chosen.size} competitors
          </button>
        </div>
      )}
    </section>
  );
}

function latency(e: EventRow): string | null {
  if (!e.battlecard_updated_at || !e.detected_at) return null;
  return `${((Date.parse(e.battlecard_updated_at) - Date.parse(e.detected_at)) / 1000).toFixed(1)}s`;
}

function Watching({
  workspaceId,
  competitors,
  cards,
  events,
}: {
  workspaceId: string;
  competitors: Competitor[];
  cards: Record<string, Battlecard>;
  events: EventRow[];
}) {
  const [sweep, setSweep] = useState<string | null>(null);
  const byId = useMemo(() => Object.fromEntries(competitors.map((c) => [c.id, c])), [competitors]);

  return (
    <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_2fr]">
      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Live feed</h2>
          <button
            className="rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900"
            onClick={async () => {
              setSweep("Sweeping…");
              const r = await fetch(`/api/workspaces/${workspaceId}/sweep`, { method: "POST" }).then((r) => r.json());
              setSweep(`Queued ${r.queued}/${r.total} checks at ${new Date().toLocaleTimeString()}`);
            }}
          >
            Sweep now
          </button>
        </div>
        {sweep && <p className="mt-2 text-xs text-zinc-500">{sweep}</p>}
        <ul className="mt-4 space-y-3">
          {events.length === 0 && <li className="text-sm text-zinc-500">No changes yet. Monitors are watching.</li>}
          {events.map((e) => (
            <li key={e.id} className="rounded-lg border border-zinc-500/20 p-3">
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <span className="font-medium">{byId[e.competitor_id]?.name}</span>
                <span>· {e.signal}</span>
                {e.importance && <span>· {e.importance}</span>}
                <span className="ml-auto">{new Date(e.detected_at ?? e.received_at).toLocaleString()}</span>
              </div>
              <div className="mt-1 font-medium">{e.title}</div>
              <div className="text-sm text-zinc-500">{e.summary}</div>
              {e.diff && <pre className="mt-2 max-h-32 overflow-auto rounded bg-zinc-500/10 p-2 text-xs">{e.diff}</pre>}
              <div className="mt-1 text-xs text-zinc-500">
                {latency(e) ? `⚡ detected → battlecard updated in ${latency(e)}` : e.processed_at ? "" : "Updating battlecard…"}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        {competitors.map((c) => (
          <BattlecardView key={c.id} competitor={c} card={cards[c.id]} />
        ))}
      </section>
    </div>
  );
}

function BattlecardView({ competitor, card }: { competitor: Competitor; card?: Battlecard }) {
  return (
    <article className="rounded-lg border border-zinc-500/20 p-4">
      <header className="flex items-center gap-2">
        {competitor.logo_url && <img src={competitor.logo_url} alt="" className="h-5 w-5 rounded" />}
        <h3 className="font-semibold">{competitor.name}</h3>
        {card && <span className="ml-auto text-xs text-zinc-500">updated {new Date(card.updated_at).toLocaleTimeString()}</span>}
      </header>
      {!card && <p className="mt-2 text-sm text-zinc-500">Setting up…</p>}
      {card?.pricing && (
        <table className="mt-3 w-full text-sm">
          <thead className="text-left text-xs text-zinc-500">
            <tr>
              <th>Plan</th>
              <th>Monthly</th>
              <th>Yearly</th>
            </tr>
          </thead>
          <tbody>
            {card.pricing.plans.map((p) => (
              <tr key={p.name}>
                <td>{p.name}</td>
                <td>{p.price_monthly_usd != null ? `$${p.price_monthly_usd}` : "–"}</td>
                <td>{p.price_monthly_usd_billed_yearly != null ? `$${p.price_monthly_usd_billed_yearly}` : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {card?.how_to_win && <p className="mt-3 text-sm">{card.how_to_win}</p>}
      {(["launches", "news", "hiring"] as const).map((k) =>
        card?.[k]?.length ? (
          <div key={k} className="mt-3">
            <h4 className="text-xs font-semibold uppercase text-zinc-500">{k}</h4>
            <ul className="text-sm">
              {card[k].slice(0, 3).map((item, i) => (
                <li key={i}>{item.url ? <a href={item.url} className="underline" target="_blank">{item.title}</a> : item.title}</li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
    </article>
  );
}
