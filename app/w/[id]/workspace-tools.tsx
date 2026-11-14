"use client";

import { useEffect, useId, useRef, useState } from "react";
import { SIGNAL_LABEL, type MonitorStatus, type Signal } from "@/lib/types";

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

export function ChangeSearch({query,onChange}: {query:string;onChange:(value:string)=>void}) {
  const uid=useId();
  const input=useRef<HTMLInputElement>(null);
  return <div className="relative min-w-0 flex-1 sm:max-w-md">
    <label htmlFor={uid} className="sr-only">Search change history</label>
    <span className="pointer-events-none absolute top-3.5 left-3 text-graphite"><Icon name="search"/></span>
    <input id={uid} ref={input} type="search" value={query} onChange={event=>onChange(event.target.value)} placeholder="Search company or change…" className="min-h-11 w-full rounded-lg border border-hairline bg-surface pr-11 pl-10 text-[13px] placeholder:text-graphite [&::-webkit-search-cancel-button]:appearance-none"/>
    {query&&<button type="button" aria-label="Clear search" onClick={()=>{onChange("");input.current?.focus();}} className="absolute top-0 right-0 flex h-11 w-11 items-center justify-center rounded-lg text-graphite hover:text-ink"><Icon name="close"/></button>}
  </div>;
}

export function DigestSettings({workspaceId}: {workspaceId:string}) {
  const uid = useId();
  const [settings, setSettings] = useState<Settings>({ email: "", digest_enabled: false, signals: SIGNALS });
  const [saved, setSaved] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [digestNotice, setDigestNotice] = useState<Notice>(null);
  const [savingDigest, setSavingDigest] = useState(false);
  const emailInvalid = settings.email !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.email.trim());
  const invalidDigest = emailInvalid || settings.digest_enabled && (!settings.email.trim() || !settings.signals.length);
  const dirty = saved !== null && JSON.stringify(saved) !== JSON.stringify(settings);
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
  return <section aria-labelledby="digest-heading" className="mx-auto w-full max-w-2xl rounded-xl border border-hairline bg-surface p-5 sm:p-6">
    <h2 id="digest-heading" className="text-xl font-semibold tracking-tight">Email digest</h2>
    <p className="mt-2 text-[13px] leading-relaxed text-graphite">Up to five prioritized competitor updates at 08:00 UTC, with links to the evidence. No email on quiet days.</p>
    {loading ? <p role="status" className="mt-5 text-[13px] text-graphite">Loading your preferences…</p> : loadFailed ? <div className="mt-5 flex flex-wrap items-center gap-3"><p role="status" className="text-[13px] text-graphite">Email preferences aren’t available right now.</p><button type="button" onClick={() => setRetry(v => v + 1)} className={`${control} font-semibold`}>Try again</button></div> : <form onSubmit={saveSettings} className="mt-5 space-y-5">
            <div><label htmlFor={`${uid}-email`} className="block text-[12px] font-semibold">Send to</label><input id={`${uid}-email`} type="email" autoComplete="email" required={settings.digest_enabled} value={settings.email} onChange={e => { setSettings(s => ({ ...s, email: e.target.value })); setDigestNotice(null); }} placeholder="you@company.com" aria-invalid={emailInvalid || undefined} aria-describedby={emailInvalid ? `${uid}-email-error` : undefined} className={`${control} mt-2 w-full`} />{emailInvalid && <p id={`${uid}-email-error`} className="mt-2 text-[12px] text-redline">Enter a valid email address.</p>}</div>
            <fieldset><legend className="text-[12px] font-semibold">Topics to include</legend><div className="mt-2 flex flex-wrap gap-2">{SIGNALS.map(signal => <label key={signal} className="relative cursor-pointer"><input type="checkbox" checked={settings.signals.includes(signal)} onChange={() => { setSettings(s => ({ ...s, signals: s.signals.includes(signal) ? s.signals.filter(x => x !== signal) : [...s.signals, signal] })); setDigestNotice(null); }} className="peer sr-only" /><span className="flex min-h-11 items-center gap-2 rounded-lg border border-hairline px-3 text-[12px] text-graphite transition-colors peer-checked:border-ink peer-checked:bg-ink peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink"><Icon name="check" className={`h-3.5 w-3.5 ${settings.signals.includes(signal) ? "" : "opacity-20"}`} />{SIGNAL_LABEL[signal]}</span></label>)}</div>{settings.digest_enabled && !settings.signals.length && <p role="status" className="mt-2 text-[12px] text-redline">Choose at least one topic for your digest.</p>}</fieldset>
            <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-hairline p-3"><span><span className="block text-[13px] font-medium">Daily delivery</span><span className="mt-0.5 block text-[12px] text-graphite">08:00 UTC · only when there’s something to share</span></span><input type="checkbox" role="switch" checked={settings.digest_enabled} onChange={e => { setSettings(s => ({ ...s, digest_enabled: e.target.checked })); setDigestNotice(null); }} className="peer sr-only" /><span aria-hidden="true" className="relative h-6 w-10 shrink-0 rounded-full bg-hairline transition-colors after:absolute after:top-0.5 after:left-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:bg-ink peer-checked:after:translate-x-4 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink" /></label>
            <div className="flex flex-wrap items-center gap-3"><button type="submit" disabled={savingDigest || !dirty || invalidDigest} className={primary}>{savingDigest ? "Saving…" : "Save preferences"}</button><Status notice={digestNotice} />{dirty && !digestNotice && <span className="text-[12px] text-graphite">Unsaved changes</span>}</div>
          </form>}
  </section>;
}

export function MonitoringFrequency({workspaceId,names,monitors}: {workspaceId:string;names:Record<string,string>;monitors:MonitorStatus[]}) {
  const uid = useId();
  const [scheduleNotice, setScheduleNotice] = useState<Notice>(null);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [monitorId, setMonitorId] = useState("");
  const [interval, setIntervalChoice] = useState("");
  const [appliedSchedules, setAppliedSchedules] = useState<Record<string, string>>({});
  const selectedMonitor = monitors.find(m => m.id === monitorId);
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
  return <details className="mb-5 rounded-xl border border-hairline bg-surface">
    <summary className="min-h-12 cursor-pointer px-5 py-4 text-[13px] font-semibold">Monitoring frequency</summary>
    <div className="border-t border-hairline p-5"><p className="text-[12px] text-graphite">Set a check interval for one source. More frequent checks can use more credits.</p>
    {monitors.length ? <form onSubmit={saveInterval} className="mt-5">
        <fieldset disabled={savingSchedule} className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,1fr)_180px_auto] md:items-end">
          <div className="min-w-0"><label htmlFor={`${uid}-monitor`} className="block text-[12px] font-semibold">Source</label><select id={`${uid}-monitor`} value={monitorId} onChange={e => { setMonitorId(e.target.value); setIntervalChoice(appliedSchedules[e.target.value] ?? ""); setScheduleNotice(null); }} className={`${control} mt-2 w-full min-w-0`}><option value="">Choose a competitor and source</option>{Object.entries(names).filter(([id]) => monitors.some(m => m.competitor_id === id)).map(([id, name]) => <optgroup key={id} label={name}>{monitors.filter(m => m.competitor_id === id).map((m, index) => <option key={m.id} value={m.id}>{SIGNAL_LABEL[m.signal]}{monitors.filter(other => other.competitor_id === id && other.signal === m.signal).length > 1 ? ` · ${m.url ? m.url.replace(/^https?:\/\/[^/]+/, "").slice(0, 70) || "/" : `Source ${index + 1}`}` : ""}</option>)}</optgroup>)}</select></div>
          <div><label htmlFor={`${uid}-interval`} className="block text-[12px] font-semibold">Check frequency</label><select id={`${uid}-interval`} value={interval} onChange={e => { setIntervalChoice(e.target.value); setScheduleNotice(null); }} className={`${control} mt-2 w-full`}><option value="">Choose frequency</option>{INTERVALS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
          <button type="submit" disabled={!monitorId || !interval || savingSchedule} className={primary}>{savingSchedule ? "Updating…" : "Apply frequency"}</button>
        </fieldset>
        <div className="mt-3 space-y-2">{selectedMonitor && <p className="break-words text-[12px] text-graphite">{names[selectedMonitor.competitor_id]} · {SIGNAL_LABEL[selectedMonitor.signal]}{selectedMonitor.url && <span className="mt-1 block [overflow-wrap:anywhere]">{selectedMonitor.url}</span>}{!appliedSchedules[monitorId] && <span className="mt-1 block">Choose a frequency to apply. The current schedule isn’t shown.</span>}</p>}<Status notice={scheduleNotice} /></div>
      </form> : <p className="mt-5 rounded-lg bg-canvas p-4 text-[13px] text-graphite">No sources are being monitored yet. Confirm your competitors to start watching.</p>}
    </div>
  </details>;
}
