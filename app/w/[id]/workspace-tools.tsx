"use client";

import { useEffect, useMemo, useState } from "react";
import { SIGNAL_LABEL, type EventRow, type MonitorStatus, type Signal } from "@/lib/types";

const SIGNALS = Object.keys(SIGNAL_LABEL) as Signal[];
type Settings = { email: string; digest_enabled: boolean; signals: Signal[] };

export function WorkspaceTools({ workspaceId, events, names, monitors }: { workspaceId: string; events: EventRow[]; names: Record<string, string>; monitors: MonitorStatus[] }) {
  const [query, setQuery] = useState("");
  const [settings, setSettings] = useState<Settings>({ email: "", digest_enabled: false, signals: SIGNALS });
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [ratings, setRatings] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [monitorId, setMonitorId] = useState("");
  const [interval, setIntervalChoice] = useState("1h");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? events.filter((e) => [e.title, e.summary, e.diff, names[e.competitor_id], SIGNAL_LABEL[e.signal]].some((s) => s?.toLowerCase().includes(q))) : [];
  }, [events, names, query]);

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceId}/alerts`).then((r) => r.ok ? r.json() : null).then((v) => v && setSettings({ email: v.email ?? "", digest_enabled: !!v.digest_enabled, signals: v.signals ?? SIGNALS })).catch(() => {});
  }, [workspaceId]);

  async function saveSettings() {
    setBusy(true); setStatus("");
    try {
      const r = await fetch(`/api/workspaces/${workspaceId}/alerts`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Could not save preferences.");
      setSettings({ email: data.email ?? "", digest_enabled: data.digest_enabled, signals: data.signals });
      setStatus("Digest preferences saved.");
    } catch (e) { setStatus((e as Error).message); } finally { setBusy(false); }
  }

  async function rate(eventId: string, rating: "useful" | "not_useful") {
    const r = await fetch(`/api/workspaces/${workspaceId}/events/${eventId}/feedback`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rating }) });
    if (r.ok) setRatings((old) => ({ ...old, [eventId]: rating }));
  }

  async function saveInterval() {
    const [amount, unit] = interval.match(/^(\d+)(m|h)$/)!.slice(1);
    const schedule = { type: "interval", frequency: Number(amount), unit: unit === "m" ? "minutes" : "hours" };
    setStatus("");
    const r = await fetch(`/api/workspaces/${workspaceId}/monitors/schedule`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ monitorId, schedule }) });
    const data = await r.json();
    setStatus(r.ok ? "Check interval updated." : data.error ?? "Could not update interval.");
  }

  return (
    <section className="mb-5 rounded-lg border border-hairline bg-surface p-3 sm:p-4" aria-label="Research and alert tools">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <label className="min-w-0 text-[12px] font-semibold">Search change history
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Try a company, price, launch, or phrase" className="mt-1 min-h-10 w-full rounded-md border border-hairline px-3 text-[14px] font-normal" />
        </label>
        <button type="button" onClick={() => setOpen((v) => !v)} className="min-h-10 rounded-md border border-hairline px-3 text-[13px] font-semibold">{open ? "Close digest settings" : "Daily email digest"}</button>
      </div>
      {query && <div className="mt-3 max-h-72 overflow-y-auto rounded-md border border-hairline">
        {filtered.length ? filtered.slice(0, 20).map((e) => <article key={e.id} className="border-b border-hairline p-3 last:border-0">
          <p className="text-[11px] text-muted">{names[e.competitor_id]} · {SIGNAL_LABEL[e.signal]} · {e.importance ?? "unranked"}</p>
          <h3 className="mt-0.5 text-[13px] font-semibold">{e.title ?? "Change detected"}</h3>
          {e.summary && <p className="mt-1 text-[13px] text-graphite">{e.summary}</p>}
          <p className="mt-1 text-[12px] text-graphite">{e.signal === "pricing" ? "Sales impact: review pricing objections and plan comparisons against this source." : e.signal === "launches" ? "Product impact: check whether this new page signals a launch or expanded capability." : e.signal === "hiring" ? "Business impact: hiring can indicate where this competitor is investing." : e.signal === "positioning" ? "Market impact: compare this messaging with how you describe your own product." : "Market impact: verify the coverage and its context before drawing conclusions."}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px]">
            {e.url && <a className="underline" href={e.url} target="_blank" rel="noreferrer">Check source evidence</a>}
            <span className="text-muted">Was this useful?</span>
            {(["useful", "not_useful"] as const).map((rating) => <button key={rating} type="button" aria-pressed={ratings[e.id] === rating} onClick={() => rate(e.id, rating)} className="underline aria-pressed:font-bold">{rating === "useful" ? "Yes" : "No"}</button>)}
          </div>
        </article>) : <p className="p-3 text-[13px] text-muted">No matching changes in the loaded history ({events.length} events).</p>}
      </div>}
      {open && <div className="mt-4 border-t border-hairline pt-4">
        <p className="text-[13px] text-graphite">Get up to five high or medium importance changes from the previous day. Quiet days won’t send email.</p>
        <label className="mt-3 block text-[12px] font-semibold">Recipient email
          <input type="email" autoComplete="email" value={settings.email} onChange={(e) => setSettings((s) => ({ ...s, email: e.target.value }))} className="mt-1 min-h-10 w-full rounded-md border border-hairline px-3 text-[14px] font-normal sm:max-w-md" placeholder="you@example.com" />
        </label>
        <fieldset className="mt-3">
          <legend className="text-[12px] font-semibold">Include changes about</legend>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">{SIGNALS.map((signal) => <label key={signal} className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={settings.signals.includes(signal)} onChange={() => setSettings((s) => ({ ...s, signals: s.signals.includes(signal) ? s.signals.filter((x) => x !== signal) : [...s.signals, signal] }))} />{SIGNAL_LABEL[signal]}</label>)}</div>
        </fieldset>
        <label className="mt-3 flex items-center gap-2 text-[13px]"><input type="checkbox" checked={settings.digest_enabled} onChange={(e) => setSettings((s) => ({ ...s, digest_enabled: e.target.checked }))} />Send a daily digest at 08:00 UTC</label>
        <div className="mt-3 flex flex-wrap items-center gap-3"><button type="button" disabled={busy} onClick={saveSettings} className="min-h-10 rounded-md bg-ink px-4 text-[13px] font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Save preferences"}</button>{status && <span role="status" className="text-[12px] text-graphite">{status}</span>}</div>
      </div>}
      {monitors.length > 0 && <details className="mt-3 border-t border-hairline pt-3">
        <summary className="cursor-pointer text-[13px] font-semibold">Monitoring frequency</summary>
        <p className="mt-2 text-[12px] text-graphite">Changing a schedule updates the selected Context.dev monitor and may affect API usage.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <select aria-label="Monitor source" value={monitorId} onChange={(e) => setMonitorId(e.target.value)} className="min-h-10 min-w-0 max-w-full rounded-md border border-hairline px-2 text-[13px]">
            <option value="">Choose a source</option>{monitors.map((m) => <option key={m.id} value={m.id}>{names[m.competitor_id]} · {SIGNAL_LABEL[m.signal]}</option>)}
          </select>
          <select aria-label="Check frequency" value={interval} onChange={(e) => setIntervalChoice(e.target.value)} className="min-h-10 rounded-md border border-hairline px-2 text-[13px]">
            <option value="15m">Every 15 minutes</option><option value="30m">Every 30 minutes</option><option value="1h">Every hour</option><option value="2h">Every 2 hours</option><option value="6h">Every 6 hours</option><option value="12h">Every 12 hours</option><option value="24h">Daily</option>
          </select>
          <button type="button" disabled={!monitorId} onClick={saveInterval} className="min-h-10 rounded-md border border-hairline px-3 text-[13px] font-semibold disabled:opacity-50">Update schedule</button>
        </div>
      </details>}
    </section>
  );
}
