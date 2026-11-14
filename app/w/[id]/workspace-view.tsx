"use client";

// Workspace shell: loads everything once, then keeps it live via Supabase Realtime.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { timeAgo } from "@/lib/time";
import type { Battlecard, Competitor, EventRow, MonitorStatus, Workspace } from "@/lib/types";
import type { ComparisonProfile } from "@/lib/comparison";
import { Dashboard } from "./dashboard";
import { Review } from "./review";

const EVENT_COLUMNS =
  "id, competitor_id, monitor_id, signal, context_event_id, title, summary, importance, url, diff, detected_at, received_at, processed_at, battlecard_updated_at, added_urls:raw->data->change->added_urls, matched_urls:raw->data->change->matched_urls";

type Row = { id: string };
function upsert<T extends Row>(list: T[], row: T): T[] {
  const i = list.findIndex((r) => r.id === row.id);
  return i === -1 ? [row, ...list] : list.map((r) => (r.id === row.id ? { ...r, ...row } : r));
}

function useWorkspace(id: string) {
  const [workspace, setWorkspace] = useState<Workspace | null | undefined>(undefined);
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [cards, setCards] = useState<Record<string, Battlecard>>({});
  const [events, setEvents] = useState<EventRow[]>([]);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [detailsLoading, setDetailsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [loadVersion, setLoadVersion] = useState(0);

  useEffect(() => {
    const sb = supabaseBrowser();
    const compIds = new Set<string>();

    async function load() {
      try {
        setLoadError(false);
        const [workspaceResult, competitorResult] = await Promise.all([
          sb.from("workspaces").select("*").eq("id", id).maybeSingle(),
          sb.from("competitors").select("*").eq("workspace_id", id).order("created_at"),
        ]);
        if (workspaceResult.error || competitorResult.error) throw new Error("Workspace read failed");
        const ws = workspaceResult.data;
        const comps = competitorResult.data;
        setWorkspace(ws);
        setCompetitors(comps ?? []);
        (comps ?? []).forEach((c) => compIds.add(c.id));
        if (!compIds.size) return;
        const [cardResult, eventResult] = await Promise.all([
          sb.from("battlecards").select("*").in("competitor_id", [...compIds]),
          sb.from("events").select(EVENT_COLUMNS).in("competitor_id", [...compIds]).order("received_at", { ascending: false }).limit(200),
        ]);
        if (cardResult.error || eventResult.error) throw new Error("Comparison data read failed");
        const bc = cardResult.data;
        const ev = eventResult.data;
        setCards(Object.fromEntries((bc ?? []).map((b) => [b.competitor_id, b])));
        setEvents((ev ?? []) as unknown as EventRow[]);
      } catch {
        setLoadError(true);
      } finally {
        setDetailsLoading(false);
      }
    }
    load();

    async function fetchEvent(eventId: string) {
      const { data } = await sb.from("events").select(EVENT_COLUMNS).eq("id", eventId).single();
      if (data) setEvents((l) => upsert(l, data as unknown as EventRow));
    }

    const channel = sb
      .channel(`ws-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "workspaces", filter: `id=eq.${id}` }, (p) => {
        if (p.eventType === "DELETE") return setWorkspace(null);
        const prev = p.old as Partial<Workspace>;
        setWorkspace(p.new as Workspace);
        if (prev.status !== (p.new as Workspace).status) load();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "competitors", filter: `workspace_id=eq.${id}` }, (p) => {
        if (p.eventType === "DELETE") return setCompetitors((l) => l.filter((c) => c.id !== (p.old as Row).id));
        const c = p.new as Competitor;
        compIds.add(c.id);
        setCompetitors((l) => [...upsert(l, c)].sort((a, b) => a.created_at.localeCompare(b.created_at)));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "battlecards" }, (p) => {
        const b = p.new as Battlecard;
        if (compIds.has(b.competitor_id)) setCards((m) => ({ ...m, [b.competitor_id]: b }));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, (p) => {
        const e = p.new as EventRow;
        if (!compIds.has(e.competitor_id)) return;
        fetchEvent(e.id); // realtime rows include the full raw payload; refetch the slim columns we render
        if (p.eventType === "INSERT") {
          setFresh((s) => new Set(s).add(e.id));
          setTimeout(() => setFresh((s) => {
            const n = new Set(s);
            n.delete(e.id);
            return n;
          }), 8000);
        }
      })
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, [id, loadVersion]);

  const saveProfile = (competitorId: string, profile: ComparisonProfile) => setCards((old) => old[competitorId]
    ? { ...old, [competitorId]: { ...old[competitorId], comparison_profile: profile } }
    : old);
  return { workspace, competitors, cards, events, fresh, detailsLoading, loadError, saveProfile, retry: () => { setDetailsLoading(true); setLoadVersion((v) => v + 1); } };
}

/** Monitor health. Polls slowly, and every 3 s while a manual check is running. */
function useMonitors(id: string, active: boolean) {
  const [monitors, setMonitors] = useState<MonitorStatus[]>([]);
  const [checkStartedAt, setCheckStartedAt] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/workspaces/${id}/monitors`);
    if (res.ok) setMonitors(await res.json());
  }, [id]);

  useEffect(() => {
    if (!active) return;
    refresh();
    const t = setInterval(refresh, checkStartedAt ? 3000 : 30000);
    return () => clearInterval(t);
  }, [active, refresh, checkStartedAt]);

  const checked = checkStartedAt ? monitors.filter((m) => m.last_run_at && Date.parse(m.last_run_at) >= checkStartedAt - 2000).length : 0;
  const checking = checkStartedAt != null && checked < monitors.length && Date.now() - checkStartedAt < 120_000;

  useEffect(() => {
    if (checkStartedAt && !checking) {
      const t = setTimeout(() => setCheckStartedAt(null), 15000);
      return () => clearTimeout(t);
    }
  }, [checkStartedAt, checking]);

  async function checkNow() {
    const started = Date.now();
    const res = await fetch(`/api/workspaces/${id}/sweep`, { method: "POST" });
    if (res.ok) setCheckStartedAt(started);
  }

  return { monitors, checkNow, checkStartedAt, checked, checking };
}

export function WorkspaceView({ id }: { id: string }) {
  const { workspace, competitors, cards, events, fresh, detailsLoading, loadError, retry, saveProfile } = useWorkspace(id);
  const watching = workspace?.status === "watching";
  const health = useMonitors(id, watching);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30000); // keep "x min ago" honest
    return () => clearInterval(t);
  }, []);

  if (loadError) return <main className="mx-auto max-w-xl px-4 py-20"><h1 className="text-xl font-semibold">Couldn’t load this workspace</h1><p className="mt-2 text-graphite">The database could not be read. Your existing data has not been changed.</p><button type="button" onClick={retry} className="mt-4 min-h-11 rounded-md bg-ink px-4 py-2 font-semibold text-white">Try again</button></main>;
  if (workspace === undefined) return <p className="p-8 text-graphite">Loading workspace…</p>;
  if (workspace === null)
    return (
      <main className="mx-auto max-w-xl px-4 py-24">
        <h1 className="text-2xl font-semibold">This workspace doesn’t exist</h1>
        <p className="mt-2 text-graphite">It may have been deleted.</p>
        <Link href="/" className="mt-6 inline-block font-semibold underline">Watch a company</Link>
      </main>
    );

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar workspace={workspace} competitors={competitors} health={watching ? health : null} />
      {workspace.status === "error" && (
        <main className="mx-auto w-full max-w-2xl px-4 py-12">
          <h2 className="text-xl font-semibold">Setup stopped</h2>
          <p className="mt-2 text-graphite">{workspace.status_detail}</p>
          <p className="mt-2 text-graphite">Delete this workspace and start again from the home page.</p>
        </main>
      )}
      {(workspace.status === "discovering" || workspace.status === "review") && <Review workspace={workspace} competitors={competitors} />}
      {watching && <Dashboard workspace={workspace} competitors={competitors} cards={cards} events={events} fresh={fresh} monitors={health.monitors} dataLoading={detailsLoading} onProfileSaved={saveProfile} />}
    </div>
  );
}

function TopBar({
  workspace,
  competitors,
  health,
}: {
  workspace: Workspace;
  competitors: Competitor[];
  health: ReturnType<typeof useMonitors> | null;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const lastCheck = health?.monitors.map((m) => m.last_run_at).filter(Boolean).sort().at(-1);
  const failing = health?.monitors.filter((m) => m.status.startsWith("error") || m.status === "failed").length ?? 0;

  let status: string;
  if (workspace.status === "discovering") status = workspace.status_detail ?? "Finding competitors…";
  else if (workspace.status === "review") status = "Choose which competitors to watch.";
  else if (!health) status = "";
  else if (health.checking) status = `Checking now: ${health.checked} of ${health.monitors.length} sources done.`;
  else if (health.checkStartedAt) status = `Checked all ${health.monitors.length} sources.`;
  else if (workspace.status_detail) status = workspace.status_detail;
  else
    status = `Watching ${competitors.length} competitors across ${health.monitors.length} sources. Last check ${timeAgo(lastCheck)}.`;

  return (
    <header className="sticky top-0 z-20 border-b border-hairline bg-surface">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:px-4 lg:px-6">
        <Link href="/" className="text-[13px] font-semibold text-graphite hover:text-ink">Competitor Radar</Link>
        <span className="h-5 w-px bg-hairline" aria-hidden />
        <div className="flex items-center gap-2">
          {workspace.logo_url && <img src={workspace.logo_url} alt="" className="h-6 w-6 rounded" />}
          <h1 className="text-[15px] font-semibold">{workspace.name}</h1>
        </div>
        <p className="min-w-0 flex-1 basis-full text-[12px] text-graphite sm:basis-auto sm:text-[13px]" aria-live="polite">
          {status}
          {failing > 0 && <span className="ml-2 text-critical">✕ {failing} sources can’t be read</span>}
        </p>
        {health?.checking && (
          <div className="h-1 w-24 overflow-hidden rounded-full bg-hairline" aria-hidden>
            <div className="h-full bg-ink transition-[width]" style={{ width: `${(100 * health.checked) / Math.max(1, health.monitors.length)}%` }} />
          </div>
        )}
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          {health && (
            <button
              onClick={health.checkNow}
              disabled={health.checking}
              className="min-h-10 rounded-md bg-ink px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-60 sm:min-h-0 sm:px-3.5 sm:py-1.5"
            >
              {health.checking ? "Checking…" : "Check now"}
            </button>
          )}
          <button
            className="text-[13px] text-graphite hover:text-critical disabled:opacity-50"
            disabled={deleting}
            onClick={async () => {
              if (!confirm(`Delete ${workspace.name}? Its monitors stop and its history is removed.`)) return;
              setDeleting(true);
              const res = await fetch(`/api/workspaces/${workspace.id}`, { method: "DELETE" });
              if (res.ok) return router.push("/");
              setDeleting(false);
              alert(`Couldn’t delete: ${(await res.json()).error}`);
            }}
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </header>
  );
}
