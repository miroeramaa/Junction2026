"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { safeSourceUrl } from "@/lib/comparison";
import { timeAgo } from "@/lib/time";
import { SIGNAL_LABEL, type EventRow, type MonitorStatus, type Signal } from "@/lib/types";

const SIGNALS = Object.keys(SIGNAL_LABEL) as Signal[];
const INTERVALS = [["15m", "Every 15 minutes"], ["30m", "Every 30 minutes"], ["1h", "Every hour"], ["2h", "Every 2 hours"], ["6h", "Every 6 hours"], ["12h", "Every 12 hours"], ["24h", "Daily"]];
const control = "min-h-11 rounded-lg border border-hairline bg-surface px-3 text-[13px] transition-colors hover:border-graphite/40 disabled:cursor-not-allowed disabled:opacity-50";
const primary = "min-h-11 rounded-lg bg-ink px-4 text-[13px] font-semibold text-white transition-colors hover:bg-graphite disabled:cursor-not-allowed disabled:opacity-50";
type Settings = { email: string; digest_enabled: boolean; signals: Signal[] };
type Notice = { text: string; error?: boolean } | null;

function Icon({ name, className = "h-4 w-4" }: { name: "search" | "mail" | "clock" | "close" | "arrow" | "check"; className?: string }) {
  const paths = { search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>, mail: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m3 7 9 6 9-6" /></>, clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>, close: <path d="m6 6 12 12M6 18 18 6" />, arrow: <path d="M7 17 17 7M7 7h10v10" />, check: <path d="m5 12 4 4L19 6" /> };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>{paths[name]}</svg>;
}
function Status({ notice, id }: { notice: Notice; id?: string }) {
  return <p id={id} role="status" className={`text-[12px] leading-relaxed ${notice?.error ? "text-redline" : "text-inserted"}`}>{notice?.text}</p>;
}

export function WorkspaceTools({ workspaceId, events, names, monitors }: { workspaceId: string; events: EventRow[]; names: Record<string, string>; monitors: MonitorStatus[] }) {
  const uid = useId();
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(5);
  const [panel, setPanel] = useState<"digest" | "monitoring" | null>(null);
  const [settings, setSettings] = useState<Settings>({ email: "", digest_enabled: false, signals: SIGNALS });
  const [saved, setSaved] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [digestNotice, setDigestNotice] = useState<Notice>(null);
  const [scheduleNotice, setScheduleNotice] = useState<Notice>(null);
  const [feedbackNotice, setFeedbackNotice] = useState<Record<string, Notice>>({});
  const [ratings, setRatings] = useState<Record<string, string>>({});
  const [ratingBusy, setRatingBusy] = useState<Record<string, boolean>>({});
  const [savingDigest, setSavingDigest] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [monitorId, setMonitorId] = useState("");
  const [interval, setIntervalChoice] = useState("");
  const [appliedSchedules, setAppliedSchedules] = useState<Record<string, string>>({});
  const selectedMonitor = monitors.find(m => m.id === monitorId);
  const emailInvalid = settings.email !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.email.trim());
  const invalidDigest = emailInvalid || settings.digest_enabled && (!settings.email.trim() || !settings.signals.length);
  const dirty = saved !== null && JSON.stringify(saved) !== JSON.stringify(settings);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? events.filter(e => [e.title, e.summary, e.diff, names[e.competitor_id], SIGNAL_LABEL[e.signal]].some(s => s?.toLowerCase().includes(q))) : [];
  }, [events, names, query]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setLoadFailed(false); setSaved(null); setDigestNotice(null);
    fetch(`/api/workspaces/${workspaceId}/alerts`, { signal: controller.signal })
      .then(async r => { if (!r.ok) throw new Error("load"); return r.json(); })
      .then(v => {
        if (controller.signal.aborted) return;
        const next = { email: v.email ?? "", digest_enabled: !!v.digest_enabled, signals: v.signals ?? SIGNALS };
        setSettings(next); setSaved(next);
      }).catch(() => { if (!controller.signal.aborted) setLoadFailed(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [workspaceId, retry]);

  async function saveSettings(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (savingDigest || loading || loadFailed || invalidDigest) return;
    setSavingDigest(true); setDigestNotice(null);
    try {
      const r = await fetch(`/api/workspaces/${workspaceId}/alerts`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
      if (!r.ok) throw new Error("save");
      const data = await r.json();
      const next = { email: data.email ?? "", digest_enabled: !!data.digest_enabled, signals: data.signals ?? [] };
      setSettings(next); setSaved(next);
      setDigestNotice({ text: "Preferences saved." });
    } catch { setDigestNotice({ text: "Couldn’t save your preferences. Please try again.", error: true }); }
    finally { setSavingDigest(false); }
  }
  async function rate(eventId: string, rating: "useful" | "not_useful") {
    if (ratingBusy[eventId]) return;
    setRatingBusy(old => ({ ...old, [eventId]: true }));
    setFeedbackNotice(old => ({ ...old, [eventId]: null }));
    try {
      const r = await fetch(`/api/workspaces/${workspaceId}/events/${eventId}/feedback`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rating }) });
      if (!r.ok) throw new Error("feedback");
      setRatings(old => ({ ...old, [eventId]: rating }));
      setFeedbackNotice(old => ({ ...old, [eventId]: { text: "Feedback saved." } }));
    } catch { setFeedbackNotice(old => ({ ...old, [eventId]: { text: "Couldn’t save feedback. Try again.", error: true } })); }
    finally { setRatingBusy(old => ({ ...old, [eventId]: false })); }
  }
  async function saveInterval(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!monitorId || !interval || savingSchedule) return;
    const [, amount, unit] = interval.match(/^(\d+)(m|h)$/)!;
    setSavingSchedule(true); setScheduleNotice(null);
    try {
      const r = await fetch(`/api/workspaces/${workspaceId}/monitors/schedule`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ monitorId, schedule: { type: "interval", frequency: Number(amount), unit: unit === "m" ? "minutes" : "hours" } }) });
      if (!r.ok) throw new Error("schedule");
      setAppliedSchedules(old => ({ ...old, [monitorId]: interval }));
      setScheduleNotice({ text: "Monitoring frequency updated." });
    } catch { setScheduleNotice({ text: "Couldn’t update this source. Please try again.", error: true }); }
    finally { setSavingSchedule(false); }
  }
  function togglePanel(next: "digest" | "monitoring") { setPanel(old => old === next ? null : next); }

  return <section className="mb-6 min-w-0 rounded-xl border border-hairline bg-surface" aria-label="Research and alert tools">
    <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:p-4">
      <div className="relative min-w-0 flex-1">
        <label htmlFor={`${uid}-search`} className="sr-only">Search change history</label>
        <span className="pointer-events-none absolute top-3.5 left-3 text-graphite"><Icon name="search" /></span>
        <input ref={search} id={`${uid}-search`} type="search" value={query} onChange={e => { setQuery(e.target.value); setLimit(5); }} placeholder="Search competitor changes…" aria-describedby={query.trim() ? `${uid}-results-count` : undefined} className="min-h-11 w-full rounded-lg border border-hairline bg-canvas/50 pr-11 pl-10 text-[14px] outline-offset-2 placeholder:text-graphite/80 focus:bg-surface [&::-webkit-search-cancel-button]:appearance-none" />
        {query && <button type="button" aria-label="Clear search" onClick={() => { setQuery(""); search.current?.focus(); }} className="absolute top-0 right-0 flex h-11 w-11 items-center justify-center rounded-lg text-graphite hover:text-ink"><Icon name="close" /></button>}
      </div>
      <div className="flex shrink-0 gap-2">
        <button type="button" aria-expanded={panel === "digest"} aria-controls={`${uid}-digest`} onClick={() => togglePanel("digest")} className={`${control} flex flex-1 items-center justify-center gap-2 font-medium aria-expanded:border-ink aria-expanded:bg-canvas sm:flex-none`}><Icon name="mail" />Email digest{saved?.digest_enabled && <span className="h-1.5 w-1.5 rounded-full bg-inserted" aria-hidden="true" title="Daily delivery enabled" />}</button>
        <button type="button" aria-expanded={panel === "monitoring"} aria-controls={`${uid}-monitoring`} onClick={() => togglePanel("monitoring")} className={`${control} flex flex-1 items-center justify-center gap-2 font-medium aria-expanded:border-ink aria-expanded:bg-canvas sm:flex-none`}><Icon name="clock" />Monitoring</button>
      </div>
    </div>

    <div id={`${uid}-digest`} hidden={panel !== "digest"} className="border-t border-hairline p-5 sm:p-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(220px,0.65fr)] xl:gap-10">
        <div className="min-w-0">
          <h2 className="text-[18px] font-semibold tracking-tight">Your daily catch-up</h2>
          <p className="mt-1 max-w-lg text-[13px] leading-relaxed text-graphite">The important competitor changes, delivered to your inbox. Skip the dashboard on quiet days.</p>
          {loading ? <p role="status" className="mt-5 text-[13px] text-graphite">Loading your preferences…</p> : loadFailed ? <div className="mt-5 flex flex-wrap items-center gap-3"><p role="status" className="text-[13px] text-graphite">Email preferences aren’t available right now.</p><button type="button" onClick={() => setRetry(v => v + 1)} className={`${control} font-semibold`}>Try again</button></div> : <form onSubmit={saveSettings} className="mt-5 space-y-5">
            <div><label htmlFor={`${uid}-email`} className="block text-[12px] font-semibold">Send to</label><input id={`${uid}-email`} type="email" autoComplete="email" required={settings.digest_enabled} value={settings.email} onChange={e => { setSettings(s => ({ ...s, email: e.target.value })); setDigestNotice(null); }} placeholder="you@company.com" aria-invalid={emailInvalid || undefined} aria-describedby={emailInvalid ? `${uid}-email-error` : undefined} className={`${control} mt-2 w-full`} />{emailInvalid && <p id={`${uid}-email-error`} className="mt-2 text-[12px] text-redline">Enter a valid email address.</p>}</div>
            <fieldset><legend className="text-[12px] font-semibold">Topics to include</legend><div className="mt-2 flex flex-wrap gap-2">{SIGNALS.map(signal => <label key={signal} className="relative cursor-pointer"><input type="checkbox" checked={settings.signals.includes(signal)} onChange={() => { setSettings(s => ({ ...s, signals: s.signals.includes(signal) ? s.signals.filter(x => x !== signal) : [...s.signals, signal] })); setDigestNotice(null); }} className="peer sr-only" /><span className="flex min-h-11 items-center gap-2 rounded-lg border border-hairline px-3 text-[12px] text-graphite transition-colors peer-checked:border-ink peer-checked:bg-ink peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink"><Icon name="check" className={`h-3.5 w-3.5 ${settings.signals.includes(signal) ? "" : "opacity-20"}`} />{SIGNAL_LABEL[signal]}</span></label>)}</div>{settings.digest_enabled && !settings.signals.length && <p role="status" className="mt-2 text-[12px] text-redline">Choose at least one topic for your digest.</p>}</fieldset>
            <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-hairline p-3"><span><span className="block text-[13px] font-medium">Daily delivery</span><span className="mt-0.5 block text-[12px] text-graphite">08:00 UTC · only when there’s something to share</span></span><input type="checkbox" role="switch" checked={settings.digest_enabled} onChange={e => { setSettings(s => ({ ...s, digest_enabled: e.target.checked })); setDigestNotice(null); }} className="peer sr-only" /><span aria-hidden="true" className="relative h-6 w-10 shrink-0 rounded-full bg-hairline transition-colors after:absolute after:top-0.5 after:left-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:bg-ink peer-checked:after:translate-x-4 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink" /></label>
            <div className="flex flex-wrap items-center gap-3"><button type="submit" disabled={savingDigest || !dirty || invalidDigest} className={primary}>{savingDigest ? "Saving…" : "Save preferences"}</button><Status notice={digestNotice} />{dirty && !digestNotice && <span className="text-[12px] text-graphite">Unsaved changes</span>}</div>
          </form>}
        </div>
        <aside className="hidden self-start rounded-lg bg-canvas/70 p-5 xl:block" aria-label="Digest details"><div className="flex items-center gap-2 text-graphite"><Icon name="mail" /><p className="text-[10px] font-semibold uppercase tracking-widest">In your inbox</p></div><h3 className="mt-4 text-[16px] font-semibold">A few updates. A clearer picture.</h3><ul className="mt-4 space-y-4 text-[13px] leading-relaxed text-graphite"><li>Up to five recent changes marked medium or high importance.</li><li>Company names, short summaries and links to the original sources.</li><li>Only the topics you choose. No email on quiet days.</li></ul></aside>
      </div>
    </div>

    <div id={`${uid}-monitoring`} hidden={panel !== "monitoring"} className="border-t border-hairline p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-[18px] font-semibold tracking-tight">Keep a closer watch</h2><p className="mt-1 text-[13px] leading-relaxed text-graphite">Choose how often a source is checked. More frequent checks can use more credits.</p></div><span className="rounded-full bg-canvas px-3 py-1 text-[11px] text-graphite tabular-nums">{monitors.length} monitored sources</span></div>
      {monitors.length ? <form onSubmit={saveInterval} className="mt-5">
        <fieldset disabled={savingSchedule} className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,1fr)_180px_auto] md:items-end">
          <div className="min-w-0"><label htmlFor={`${uid}-monitor`} className="block text-[12px] font-semibold">Source</label><select id={`${uid}-monitor`} value={monitorId} onChange={e => { setMonitorId(e.target.value); setIntervalChoice(appliedSchedules[e.target.value] ?? ""); setScheduleNotice(null); }} className={`${control} mt-2 w-full min-w-0`}><option value="">Choose a competitor and source</option>{Object.entries(names).filter(([id]) => monitors.some(m => m.competitor_id === id)).map(([id, name]) => <optgroup key={id} label={name}>{monitors.filter(m => m.competitor_id === id).map((m, index) => <option key={m.id} value={m.id}>{SIGNAL_LABEL[m.signal]}{monitors.filter(other => other.competitor_id === id && other.signal === m.signal).length > 1 ? ` · ${m.url ? m.url.replace(/^https?:\/\/[^/]+/, "").slice(0, 70) || "/" : `Source ${index + 1}`}` : ""}</option>)}</optgroup>)}</select></div>
          <div><label htmlFor={`${uid}-interval`} className="block text-[12px] font-semibold">Check frequency</label><select id={`${uid}-interval`} value={interval} onChange={e => { setIntervalChoice(e.target.value); setScheduleNotice(null); }} className={`${control} mt-2 w-full`}><option value="">Choose frequency</option>{INTERVALS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
          <button type="submit" disabled={!monitorId || !interval || savingSchedule} className={primary}>{savingSchedule ? "Updating…" : "Apply frequency"}</button>
        </fieldset>
        <div className="mt-3 space-y-2">{selectedMonitor && <p className="break-words text-[12px] text-graphite">{names[selectedMonitor.competitor_id]} · {SIGNAL_LABEL[selectedMonitor.signal]}{selectedMonitor.url && <span className="mt-1 block [overflow-wrap:anywhere]">{selectedMonitor.url}</span>}{!appliedSchedules[monitorId] && <span className="mt-1 block">Choose a frequency to apply. The current schedule isn’t shown.</span>}</p>}<Status notice={scheduleNotice} /></div>
      </form> : <p className="mt-5 rounded-lg bg-canvas p-4 text-[13px] text-graphite">No sources are being monitored yet. Confirm your competitors to start watching.</p>}
    </div>

    {query.trim() && <div className="border-t border-hairline">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3"><p id={`${uid}-results-count`} role="status" className="text-[12px] font-semibold tabular-nums">{filtered.length} {filtered.length === 1 ? "result" : "results"}</p><span className="text-[11px] text-graphite">Searching {events.length} loaded changes</span></div>
      {filtered.length ? <><div className="divide-y divide-hairline">{filtered.slice(0, limit).map(e => <article key={e.id} className="px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-graphite"><span className="font-semibold text-ink">{names[e.competitor_id] ?? "Competitor"}</span><span aria-hidden="true">·</span><span>{SIGNAL_LABEL[e.signal]}</span><span aria-hidden="true">·</span><time dateTime={e.detected_at ?? e.received_at}>{timeAgo(e.detected_at ?? e.received_at)}</time>{e.importance === "high" && <span className="rounded-full bg-redline-wash px-2 py-0.5 font-medium text-redline">High importance</span>}</div>
        <h3 className="mt-2 break-words text-[15px] font-semibold leading-snug">{e.title ?? "Change detected"}</h3>{e.summary && <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-graphite [overflow-wrap:anywhere]">{e.summary}</p>}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-5 gap-y-2">{safeSourceUrl(e.url) && <a href={safeSourceUrl(e.url)} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-1 text-[12px] font-semibold hover:underline">View source<Icon name="arrow" className="h-3.5 w-3.5" /><span className="sr-only"> (opens in a new tab)</span></a>}<div className="flex flex-wrap items-center gap-2"><span className="mr-1 text-[11px] text-graphite">Useful?</span>{(["useful", "not_useful"] as const).map(rating => <button key={rating} type="button" aria-label={`${rating === "useful" ? "Useful" : "Not useful"}: ${e.title ?? "Change detected"}`} aria-pressed={ratings[e.id] === rating} disabled={ratingBusy[e.id]} onClick={() => void rate(e.id, rating)} className="min-h-10 min-w-11 rounded-lg border border-hairline px-3 text-[12px] text-graphite hover:bg-canvas aria-pressed:border-ink aria-pressed:bg-canvas aria-pressed:font-semibold aria-pressed:text-ink disabled:opacity-50">{rating === "useful" ? "Yes" : "No"}</button>)}</div></div><Status notice={feedbackNotice[e.id]} />
      </article>)}</div>{filtered.length > limit && <div className="border-t border-hairline px-5 py-3"><button type="button" onClick={() => setLimit(old => old + 5)} className={`${control} w-full font-medium`}>Show more results ({filtered.length - limit} remaining)</button></div>}</> : <div className="px-5 pt-4 pb-7 text-center"><Icon name="search" className="mx-auto h-6 w-6 text-muted" /><p className="mt-3 text-[14px] font-medium">No matching changes</p><p className="mt-1 text-[12px] text-graphite">Try a competitor name, topic or shorter phrase.</p><button type="button" onClick={() => { setQuery(""); search.current?.focus(); }} className="mt-2 min-h-11 px-3 text-[12px] font-semibold hover:underline">Clear search</button></div>}
    </div>}
  </section>;
}
