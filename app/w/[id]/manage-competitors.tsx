"use client";

import { useState } from "react";
import { SIGNAL_LABEL, type Competitor, type MonitorStatus, type Signal } from "@/lib/types";
import { timeAgo } from "@/lib/time";

const control = "min-h-11 rounded-lg border border-hairline bg-surface px-3 text-[13px] disabled:opacity-50";
const button = `${control} font-semibold transition-colors hover:bg-canvas`;
const primary = "min-h-11 rounded-lg bg-ink px-4 text-[13px] font-semibold text-white hover:bg-graphite disabled:opacity-50";
const signals = Object.keys(SIGNAL_LABEL) as Signal[];
type Notice = { text: string; error?: boolean } | null;
function Message({ notice }: { notice: Notice }) { return notice && <p role="status" className={`mt-3 text-[12px] leading-relaxed ${notice.error ? "text-redline" : "text-inserted"}`}>{notice.text}</p>; }
async function request(url: string, method: string, body?: unknown) {
  const response = await fetch(url, { method, ...(body ? {headers:{"Content-Type":"application/json"},body:JSON.stringify(body)} : {}) });
  const data = await response.json().catch(()=>null);
  if (!response.ok) throw new Error(data?.error ?? "This update couldn’t finish. Please try again.");
  return data;
}

export function ManageCompetitors({workspaceId, competitors, monitors, onChanged}: {workspaceId:string; competitors:Competitor[]; monitors:MonitorStatus[]; onChanged:()=>void}) {
  const [adding,setAdding]=useState(false);
  const [name,setName]=useState("");
  const [website,setWebsite]=useState("");
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState<Notice>(null);
  async function add(e:React.FormEvent<HTMLFormElement>) {
    e.preventDefault();if(busy)return;setBusy(true);setNotice(null);
    try {
      const result=await request(`/api/workspaces/${workspaceId}/competitors`,"POST",{name,website});
      setName("");setWebsite("");setAdding(false);
      setNotice({text:result.incomplete_sources?.length ? "Competitor added. Some sources need attention; open its source settings to retry." : "Competitor added. Its homepage and press sources are starting."});
      onChanged();
    } catch(error) {setNotice({text:error instanceof Error?error.message:"Couldn’t add this competitor.",error:true});}
    finally {setBusy(false);}
  }
  return <section aria-labelledby="manage-heading" className="min-w-0">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-widest text-muted">Your watchlist</p><h2 id="manage-heading" className="mt-1 text-2xl font-semibold tracking-tight">Competitors & sources</h2><p className="mt-2 max-w-xl text-[13px] leading-relaxed text-graphite">Keep the right companies in view. Correct a source, fill a gap, or pause monitoring that no longer matters.</p></div><button type="button" aria-expanded={adding} aria-controls="add-competitor-form" onClick={()=>{setAdding(v=>!v);setNotice(null);}} className={primary}>{adding?"Close form":"+ Add competitor"}</button></div>
    {adding && <form id="add-competitor-form" onSubmit={add} className="mt-5 rounded-xl border border-hairline bg-surface p-5"><h3 className="font-semibold">Add a company to watch</h3><p className="mt-1 text-[12px] text-graphite">Starts a homepage source and a press search. Monitoring uses Context.dev credits. Add pricing, hiring or a sitemap afterwards.</p><fieldset disabled={busy} className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-[12px] font-semibold">Company name<input required maxLength={100} value={name} onChange={e=>setName(e.target.value)} placeholder="Acme" className={`${control} mt-2 w-full font-normal`} /></label><label className="text-[12px] font-semibold">Company website<input required maxLength={2000} value={website} onChange={e=>setWebsite(e.target.value)} placeholder="acme.com" className={`${control} mt-2 w-full font-normal`} /></label><div className="sm:col-span-2"><button type="submit" disabled={busy||!name.trim()||!website.trim()} className={primary}>{busy?"Adding and starting sources…":"Add and start watching"}</button></div></fieldset></form>}
    <Message notice={notice}/>
    <div className="mt-6 space-y-3">{competitors.map(c=><CompetitorControls key={c.id} competitor={c} monitors={monitors.filter(m=>m.competitor_id===c.id)} workspaceId={workspaceId} onChanged={onChanged}/>)}</div>
    {!competitors.length&&<p className="mt-6 rounded-xl border border-dashed border-hairline bg-surface p-8 text-center text-graphite">Your watchlist is empty. Add a competitor to start monitoring.</p>}
  </section>;
}
function CompetitorControls({competitor:c,monitors,workspaceId,onChanged}: {competitor:Competitor;monitors:MonitorStatus[];workspaceId:string;onChanged:()=>void}) {
  const [confirmRemove,setConfirmRemove]=useState(false);
  const [removing,setRemoving]=useState(false);
  const [notice,setNotice]=useState<Notice>(null);
  const paused=monitors.filter(m=>m.status==="paused").length;
  const problem=monitors.filter(m=>m.status.startsWith("error")||m.status==="failed").length;
  async function remove() {
    if(removing)return;setRemoving(true);setNotice(null);
    try {await request(`/api/workspaces/${workspaceId}/competitors/${c.id}`,"DELETE");onChanged();}
    catch(error){setNotice({text:(error as Error).message,error:true});setRemoving(false);}
  }
  return <details className="group rounded-xl border border-hairline bg-surface">
    <summary className="flex min-h-20 cursor-pointer list-none items-center gap-3 p-4 sm:p-5 [&::-webkit-details-marker]:hidden">{c.logo_url?<img src={c.logo_url} alt="" className="h-9 w-9 shrink-0 rounded-lg object-contain"/>:<span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-canvas font-semibold">{c.name.slice(0,1)}</span>}<span className="min-w-0 flex-1"><span className="block break-words text-[14px] font-semibold">{c.name}</span><span className="mt-1 block text-[12px] text-graphite">{monitors.length} sources{paused?` · ${paused} paused`:""}{problem?` · ${problem} need attention`:""}</span></span><span aria-hidden="true" className="text-xl text-graphite transition-transform group-open:rotate-90">›</span></summary>
    <div className="border-t border-hairline p-4 sm:p-5"><div className="space-y-3">{monitors.map(m=><SourceControl key={m.id} monitor={m} workspaceId={workspaceId} onChanged={onChanged}/>)}</div><AddSource competitor={c} workspaceId={workspaceId} monitors={monitors} onChanged={onChanged}/>
      <div className="mt-6 border-t border-hairline pt-4">{confirmRemove?<div className="rounded-lg border border-redline/20 bg-redline-wash p-4"><p className="text-[13px] font-semibold">Remove {c.name}?</p><p className="mt-1 text-[12px] leading-relaxed text-graphite">Stops all its monitoring and permanently removes its saved history and profile. This cannot be undone.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={removing} onClick={()=>void remove()} className="min-h-11 rounded-lg bg-redline px-4 text-[12px] font-semibold text-white disabled:opacity-50">{removing?"Stopping sources and removing…":"Remove competitor"}</button><button type="button" disabled={removing} onClick={()=>setConfirmRemove(false)} className={button}>Keep competitor</button></div></div>:<button type="button" onClick={()=>setConfirmRemove(true)} className="min-h-11 text-[12px] font-medium text-graphite hover:text-redline">Remove from watchlist</button>}<Message notice={notice}/></div>
    </div>
  </details>;
}
function SourceControl({monitor:m,workspaceId,onChanged}: {monitor:MonitorStatus;workspaceId:string;onChanged:()=>void}) {
  const [editing,setEditing]=useState(false);
  const [value,setValue]=useState("");
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState<Notice>(null);
  const search=m.target_type==="search"||m.signal==="news";
  const pending=m.status==="updating"||m.status==="deleting";
  const failed=m.status.startsWith("error")||m.status==="failed";
  const status=m.status==="paused"?"Paused":failed?"Needs attention":pending?"Updating…":m.status==="baseline"?"Reading baseline":"Watching";
  async function change(action:"pause"|"resume"|"retry"|"update") {
    if(busy)return;setBusy(true);setNotice(null);
    try {await request(`/api/workspaces/${workspaceId}/monitors/${m.id}`,"PATCH",{action,...(action==="update"?search?{query:value}:{url:value}:{})});setEditing(false);setNotice({text:action==="pause"?"Monitoring paused. Saved history stays available.":action==="resume"?"Source resumed.":action==="retry"?"Source state synced.":"Source saved. A fresh baseline will be captured."});onChanged();}
    catch(error){setNotice({text:(error as Error).message,error:true});onChanged();}
    finally{setBusy(false);}
  }
  return <article aria-label={`${SIGNAL_LABEL[m.signal]} source`} className="min-w-0 rounded-lg border border-hairline p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h4 className="text-[13px] font-semibold">{SIGNAL_LABEL[m.signal]}</h4><span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${failed?"bg-redline-wash text-redline":m.status==="paused"?"bg-canvas text-graphite":"bg-emerald-50 text-inserted"}`}>{status}</span></div><p className="mt-2 text-[12px] leading-relaxed text-graphite [overflow-wrap:anywhere]">{search?m.query??"Press search":m.url??"URL not configured"}</p>{m.last_run_at&&<p className="mt-1 text-[11px] text-muted">Last checked {timeAgo(m.last_run_at)}</p>}</div><div className="flex gap-2"><button type="button" disabled={busy||pending} aria-expanded={editing} onClick={()=>{setValue(search?m.query??"":m.url??"");setEditing(v=>!v);setNotice(null);}} className={button}>{editing?"Close":"Edit"}</button><button type="button" disabled={busy||pending} onClick={()=>void change(failed?"retry":m.status==="paused"?"resume":"pause")} className={button}>{busy?"Updating…":m.status==="paused"?"Resume":failed?"Retry":"Pause"}</button></div></div>
    {editing&&<form onSubmit={e=>{e.preventDefault();void change("update");}} className="mt-4 border-t border-hairline pt-4"><label className="text-[12px] font-semibold">{search?"Press search query":m.target_type==="sitemap"?"Sitemap URL":"Watched URL"}<input type={search?"text":"url"} required maxLength={search?500:2000} disabled={busy} value={value} onChange={e=>setValue(e.target.value)} className={`${control} mt-2 w-full font-normal`}/></label><p className="mt-2 text-[12px] leading-relaxed text-graphite">Editing starts a fresh baseline and may use credits. Saved history is kept. A paused source stays paused.</p><button type="submit" disabled={busy||!value.trim()} className={`${primary} mt-3`}>{busy?"Saving…":"Save source"}</button></form>}<Message notice={notice}/>
  </article>;
}
function AddSource({competitor:c,workspaceId,monitors,onChanged}: {competitor:Competitor;workspaceId:string;monitors:MonitorStatus[];onChanged:()=>void}) {
  const missing=signals.filter(signal=>!monitors.some(m=>m.signal===signal));
  const [open,setOpen]=useState(false);
  const [signal,setSignal]=useState<Signal>(missing[0]??"pricing");
  const [value,setValue]=useState("");
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState<Notice>(null);
  async function add(e:React.FormEvent<HTMLFormElement>) {
    e.preventDefault();if(busy)return;setBusy(true);setNotice(null);
    try {await request(`/api/workspaces/${workspaceId}/competitors/${c.id}/sources`,"POST",{signal,...(signal==="news"?{query:value}:{url:value})});setOpen(false);setValue("");setNotice({text:"Source added. Its first check is starting."});onChanged();}
    catch(error){setNotice({text:(error as Error).message,error:true});onChanged();}
    finally{setBusy(false);}
  }
  return <div className="mt-4">{!!missing.length&&<button type="button" aria-expanded={open} onClick={()=>{setOpen(v=>!v);setSignal(missing[0]);setValue("");setNotice(null);}} className={button}>{open?"Close form":"+ Add a source"}</button>}{open&&!!missing.length&&<form onSubmit={add} className="mt-4 rounded-lg bg-canvas p-4"><fieldset disabled={busy} className="space-y-4"><label className="block text-[12px] font-semibold">Source type<select aria-label="Source type" value={signal} onChange={e=>{setSignal(e.target.value as Signal);setValue("");}} className={`${control} mt-2 w-full`}>{missing.map(signal=><option key={signal} value={signal}>{SIGNAL_LABEL[signal]}</option>)}</select></label><label className="block text-[12px] font-semibold">{signal==="news"?"Press search query":signal==="launches"?"Sitemap URL":"Watched URL"}<input required type={signal==="news"?"text":"url"} value={value} onChange={e=>setValue(e.target.value)} placeholder={signal==="launches"?`https://${c.domain}/sitemap.xml`:signal==="news"?`"${c.name}" -site:${c.domain}`:`https://${c.domain}/…`} className={`${control} mt-2 w-full font-normal`}/></label><p className="text-[12px] text-graphite">Starts a baseline check and scheduled monitoring using Context.dev credits.</p><button type="submit" disabled={busy||!value.trim()} className={primary}>{busy?"Starting source…":"Start monitoring"}</button></fieldset></form>}<Message notice={notice}/></div>;
}
