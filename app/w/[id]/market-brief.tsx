"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { comparisonLocale, safeSourceUrl } from "@/lib/comparison";
import type { BriefRow, StrategicInsight } from "@/lib/market-brief";
import { timeAgo } from "@/lib/time";
import { SIGNAL_LABEL } from "@/lib/types";

type State = { row:BriefRow|null; eligible_events:number; stale:boolean; can_generate:boolean };
type Tone = "calm" | "balanced" | "bright";
type VoicePreferences = { voiceKey:string; tone:Tone; speed:number };
type VoiceOption = { key:string; voice:SpeechSynthesisVoice };
const VOICE_SETTINGS_KEY = "kestrel-narration-settings-v1";
const DEFAULT_VOICE_PREFERENCES:VoicePreferences = {voiceKey:"",tone:"balanced",speed:1};

function voiceKey(voice:SpeechSynthesisVoice) { return `${voice.name}::${voice.lang}`; }

function useNarrator(preferredLanguage:string) {
  const [voices,setVoices] = useState<VoiceOption[]>([]);
  const [preferences,setPreferences] = useState<VoicePreferences>(DEFAULT_VOICE_PREFERENCES);
  const [ready,setReady] = useState(false);
  const [supported,setSupported] = useState(false);
  const [voiceListReady,setVoiceListReady] = useState(false);
  const [activeId,setActiveId] = useState<string|null>(null);
  const [paused,setPaused] = useState(false);
  const [message,setMessage] = useState("");
  const utteranceId = useRef(0);

  useEffect(()=>{
    try {
      const saved = localStorage.getItem(VOICE_SETTINGS_KEY);
      if(saved) {
        const parsed:unknown = JSON.parse(saved);
        if(parsed && typeof parsed === "object") {
          const value = parsed as Partial<VoicePreferences>;
          setPreferences({
            voiceKey:typeof value.voiceKey === "string" ? value.voiceKey : "",
            tone:value.tone === "calm" || value.tone === "bright" ? value.tone : "balanced",
            speed:typeof value.speed === "number" && Number.isFinite(value.speed) ? Math.min(1.2,Math.max(0.8,value.speed)) : 1,
          });
        }
      }
    } catch { /* Voice settings are optional when browser storage is unavailable. */ }
    setReady(true);
  },[]);

  useEffect(()=>{
    if(ready) try { localStorage.setItem(VOICE_SETTINGS_KEY,JSON.stringify(preferences)); } catch { /* Keep settings for this visit. */ }
  },[preferences,ready]);

  useEffect(()=>{
    if(!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) return;
    const synth = window.speechSynthesis;
    setSupported(true);
    const updateVoices = ()=>{
      const available = synth.getVoices().map(voice=>({key:voiceKey(voice),voice}));
      setVoices(available);
      setVoiceListReady(true);
      setPreferences(current=>{
        if(available.some(item=>item.key===current.voiceKey)) return current;
        const locale = preferredLanguage.toLowerCase().split("-")[0];
        const best = available.find(item=>item.voice.lang.toLowerCase().startsWith(`${locale}-`)) ?? available.find(item=>item.voice.default) ?? available[0];
        return best ? {...current,voiceKey:best.key} : current;
      });
    };
    updateVoices();
    synth.addEventListener("voiceschanged",updateVoices);
    return ()=>{
      utteranceId.current++;
      synth.cancel();
      synth.removeEventListener("voiceschanged",updateVoices);
    };
  },[preferredLanguage]);

  function stop() {
    utteranceId.current++;
    window.speechSynthesis?.cancel();
    setActiveId(null);setPaused(false);setMessage("");
  }

  function toggle(id:string,text:string) {
    if(!supported) {setMessage("Speech playback is not available in this browser.");return;}
    const synth = window.speechSynthesis;
    if(activeId===id && !paused) {synth.pause();setPaused(true);return;}
    if(activeId===id && paused) {synth.resume();setPaused(false);return;}

    const currentId = ++utteranceId.current;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const selectedVoice = voices.find(item=>item.key===preferences.voiceKey)?.voice;
    if(selectedVoice) {utterance.voice=selectedVoice;utterance.lang=selectedVoice.lang;}
    else utterance.lang=preferredLanguage;
    const tone = preferences.tone === "calm" ? {pitch:0.9,rate:0.92} : preferences.tone === "bright" ? {pitch:1.12,rate:1.04} : {pitch:1,rate:1};
    utterance.pitch=tone.pitch;
    utterance.rate=Math.min(1.5,Math.max(0.5,tone.rate*preferences.speed));
    utterance.volume=1;
    utterance.onstart=()=>{if(utteranceId.current===currentId){setActiveId(id);setPaused(false);setMessage("");}};
    utterance.onend=()=>{if(utteranceId.current===currentId){setActiveId(null);setPaused(false);setMessage("");}};
    utterance.onerror=(event)=>{
      if(utteranceId.current!==currentId || event.error==="canceled" || event.error==="interrupted") return;
      setActiveId(null);setPaused(false);setMessage("Couldn’t play narration. Try another voice or browser.");
    };
    setActiveId(id);setPaused(false);setMessage("Starting narration…");synth.speak(utterance);
  }

  return {voices,preferences,setPreferences,supported,voiceListReady,activeId,paused,message,toggle,stop};
}

export function MarketBriefPanel({workspaceId, companyName, eventVersion, loading=false}: {workspaceId:string; companyName:string; eventVersion:string; loading?:boolean}) {
  const [data,setData] = useState<State|null>(null);
  const [locale,setLocale] = useState("en");
  const [fetching,setFetching] = useState(true);
  const [updating,setUpdating] = useState(false);
  const [error,setError] = useState<string|null>(null);
  const [unavailable,setUnavailable] = useState(false);
  const requestVersion = useRef(0);
  const mounted = useRef(true);
  const busy = useRef(false);
  useEffect(()=>{ mounted.current=true;setLocale(comparisonLocale(navigator.languages?.[0]??navigator.language)); return ()=>{mounted.current=false;requestVersion.current++;};},[workspaceId]);
  const load = useCallback(async()=>{
    const version=++requestVersion.current;
    try {
      const response=await fetch(`/api/workspaces/${workspaceId}/brief?locale=${encodeURIComponent(locale)}`,{cache:"no-store"});
      const result=await response.json();
      if (!mounted.current || version!==requestVersion.current) return;
      if (!response.ok) {setUnavailable(result.code==="storage");throw new Error("read");}
      setData(result);setUnavailable(false);setError(null);
    } catch {if(mounted.current&&version===requestVersion.current)setError("Couldn’t load the latest brief. Your saved insights will stay visible.");}
    finally {if(mounted.current&&version===requestVersion.current)setFetching(false);}
  },[workspaceId,locale]);
  useEffect(()=>{if(!loading&&!busy.current)void load();},[load,loading,eventVersion]);
  useEffect(()=>{
    if(loading)return;
    const timer=setInterval(()=>{if(!busy.current&&document.visibilityState==="visible")void load();},data?.row?.status==="generating"?5000:30000);
    return ()=>clearInterval(timer);
  },[data?.row?.status,load,loading]);
  async function generate() {
    if(busy.current)return;
    busy.current=true;setUpdating(true);setError(null);requestVersion.current++;
    try {
      const response=await fetch(`/api/workspaces/${workspaceId}/brief`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({locale})});
      const result=await response.json();
      if(!mounted.current)return;
      if(!response.ok){setError(result.code==="busy"?"Your brief is already updating. Check back in a moment.":result.code==="cooldown"?"Please wait a moment before updating again.":"The update couldn’t finish. Your saved insights are still available.");return;}
      setData(old=>({...old,eligible_events:old?.eligible_events??0,can_generate:old?.can_generate??false,stale:false,row:result.row}));
      await load();
    } catch {if(mounted.current)setError("The update couldn’t finish. Your saved insights are still available.");}
    finally {busy.current=false;if(mounted.current)setUpdating(false);}
  }
  const row=data?.row;
  const narration = useNarrator(row?.content?.locale ?? locale);
  const generating=updating||row?.status==="generating" && !!row.lease_until && Date.parse(row.lease_until)>Date.now();
  const insights=row?.content?.insights??[];
  return <section aria-labelledby="market-brief-heading" className="relative mb-7 min-w-0 rounded-xl border border-hairline bg-surface p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-widest text-muted">What this means for {companyName}</p><h2 id="market-brief-heading" className="mt-1 text-xl font-semibold tracking-tight">Market brief</h2><p className="mt-1 text-[12px] text-graphite">Strategic interpretations of recent competitor changes, with evidence.</p><NarrationSettings narrator={narration} /></div><div className="flex items-center gap-3">{row?.generated_at&&<span className="text-[11px] text-muted">Updated {timeAgo(row.generated_at)}</span>}{narration.activeId&&<button type="button" onClick={narration.stop} className="min-h-10 rounded-lg border border-hairline px-3 text-[12px] font-semibold hover:bg-canvas">Stop reading</button>}<button type="button" disabled={generating||fetching||loading||unavailable||!data?.can_generate&&!row?.content} onClick={()=>void generate()} className="min-h-10 rounded-lg border border-hairline px-3 text-[12px] font-semibold hover:bg-canvas disabled:opacity-50">{generating?"Updating brief…":row?.content?"Refresh brief":"Generate brief"}</button></div></div>
    {data?.stale&&<p className="mt-3 text-[12px] text-graphite">New evidence is available. Refresh to update these interpretations.</p>}
    {error&&!unavailable&&<div role="status" className="mt-3 flex flex-wrap items-center gap-3 text-[12px] text-graphite"><p>{error}</p><button type="button" onClick={()=>void load()} className="min-h-9 font-semibold text-ink">Try loading again</button></div>}
    {narration.message&&<p className="sr-only" role="status" aria-live="polite">{narration.message}</p>}
    {!!insights.length&&<div className={`mt-5 grid min-w-0 gap-4 ${insights.length===2?"lg:grid-cols-2":insights.length>=3?"xl:grid-cols-3":""}`}>{insights.map((insight,index)=><InsightCard key={`${index}-${insight.headline}`} id={`${index}-${insight.headline}`} insight={insight} companyName={companyName} locale={row?.content?.locale} wide={insights.length===1} narrator={narration} />)}</div>}
    {!insights.length&&<p role="status" className="mt-4 text-[13px] leading-relaxed text-graphite">{loading||fetching?"Loading your brief…":unavailable?"Market briefs will be available once workspace setup is complete.":row?.content?"No strong strategic conclusions from the checked changes yet. We’ll show fewer insights rather than turn weak evidence into a story.":data?.can_generate?"Recent changes are ready to analyze. Generate a brief to connect the evidence to your company’s priorities.":"Waiting for enough evidence: a significant change or related signals from multiple company pages. Routine updates alone won’t produce a strategy story."}</p>}
  </section>;
}

function NarrationSettings({narrator}: {narrator:ReturnType<typeof useNarrator>}) {
  if(!narrator.supported) return <p className="mt-3 text-[12px] text-muted">Read aloud isn’t supported by this browser.</p>;
  return <details className="mt-3 text-[12px]">
    <summary className="min-h-9 w-fit cursor-pointer font-semibold text-graphite hover:text-ink">Voice and tone settings</summary>
    <div className="mt-2 grid max-w-xl gap-3 rounded-lg border border-hairline bg-canvas p-3 sm:grid-cols-3">
      <label className="grid gap-1 font-medium">Voice
        <select disabled={narrator.voices.length===0} value={narrator.preferences.voiceKey} onChange={event=>narrator.setPreferences(current=>({...current,voiceKey:event.target.value}))} className="min-h-10 min-w-0 rounded-md border border-hairline bg-surface px-2 font-normal disabled:opacity-60">
          {narrator.voices.length===0&&<option value="">{narrator.voiceListReady?"No voices available":"Loading voices…"}</option>}
          {narrator.voices.map(item=><option key={item.key} value={item.key}>{item.voice.name} ({item.voice.lang}){item.voice.default?" · default":""}</option>)}
        </select>
      </label>
      <label className="grid gap-1 font-medium">Tone
        <select value={narrator.preferences.tone} onChange={event=>narrator.setPreferences(current=>({...current,tone:event.target.value as Tone}))} className="min-h-10 rounded-md border border-hairline bg-surface px-2 font-normal">
          <option value="balanced">Balanced</option><option value="calm">Calm</option><option value="bright">Bright</option>
        </select>
      </label>
      <label className="grid gap-1 font-medium">Speed: {narrator.preferences.speed.toFixed(2)}×
        <input aria-label="Narration speed" type="range" min="0.8" max="1.2" step="0.05" value={narrator.preferences.speed} onChange={event=>narrator.setPreferences(current=>({...current,speed:Number(event.target.value)}))} className="min-h-10 w-full accent-ink" />
      </label>
      <p className="text-[11px] leading-relaxed text-muted sm:col-span-3">Voice choices depend on the browser and device. Tone presets adjust pitch and pace; they don’t add expressive acting styles.</p>
      {narrator.voiceListReady&&narrator.voices.length===0&&<p className="text-[11px] leading-relaxed text-muted sm:col-span-3">This device has no speech voices available. Try another browser or install a system voice.</p>}
    </div>
  </details>;
}

function NarrateButton({id,text,narrator}: {id:string;text:string;narrator:ReturnType<typeof useNarrator>}) {
  const active=narrator.activeId===id;
  return <div className="mt-3 flex flex-wrap items-center gap-2">
    <button type="button" disabled={!narrator.supported||narrator.voices.length===0} onClick={()=>narrator.toggle(id,text)} aria-label={active?(narrator.paused?"Resume narration":"Pause narration"):"Read this insight aloud"} className="min-h-10 rounded-lg border border-hairline px-3 text-[12px] font-semibold hover:bg-canvas disabled:opacity-50">
      {active?(narrator.paused?"Resume":"Pause"):"▶ Read aloud"}
    </button>
    {active&&<button type="button" onClick={narrator.stop} className="min-h-10 px-2 text-[12px] font-semibold text-graphite hover:text-ink">Stop</button>}
    {active&&!narrator.paused&&<span className="text-[11px] text-muted" aria-live="polite">Reading this insight</span>}
  </div>;
}

function InsightCard({id,insight,companyName,locale,wide,narrator}: {id:string;insight:StrategicInsight;companyName:string;locale?:string;wide:boolean;narrator:ReturnType<typeof useNarrator>}) {
  const narrationText=[insight.headline,insight.interpretation,`Why it matters to ${companyName}: ${insight.relevance}`,`Suggested investigation: ${insight.next_step}`].join(". ");
  return <article aria-label={insight.headline} className={`min-w-0 rounded-lg border border-hairline p-4 [overflow-wrap:anywhere] ${wide?"grid gap-x-7 md:grid-cols-2":""}`} lang={locale}>
    <div>
      <div className="flex flex-wrap gap-2 text-[10px] font-semibold uppercase tracking-wide text-graphite"><span className="rounded-full bg-indigo-50 px-2 py-1 text-indigo-700">AI interpretation</span><span className="py-1">{insight.kind==="pattern"?"Pattern":"Significant change"} · {insight.confidence==="moderate"?"Moderate":"Tentative"} confidence</span></div>
      <h3 className="mt-3 text-[15px] font-semibold leading-snug">{insight.headline}</h3><p className="mt-2 text-[13px] leading-relaxed text-graphite">{insight.interpretation}</p><NarrateButton id={id} text={narrationText} narrator={narrator} />
    </div>
    <div>
      <h4 className={`${wide?"mt-4 md:mt-0":"mt-4"} text-[10px] font-semibold uppercase tracking-wide text-muted`}>Why it matters to {companyName}</h4><p className="mt-1 text-[13px] leading-relaxed">{insight.relevance}</p><h4 className="mt-4 text-[10px] font-semibold uppercase tracking-wide text-muted">Suggested investigation</h4><p className="mt-1 text-[13px] leading-relaxed">{insight.next_step}</p>
    </div>
    <details className={`mt-4 text-[12px] ${wide?"md:col-span-2":""}`}><summary className="min-h-9 cursor-pointer font-semibold">Observed changes ({insight.evidence.length})</summary><ul className={`mt-2 ${wide?"grid gap-4 md:grid-cols-2":"space-y-4"}`}>{insight.evidence.map(source=><li key={source.id}><p className="text-[10px] text-muted">{source.competitor_name} · {SIGNAL_LABEL[source.signal]} · {new Date(source.at).toLocaleDateString()}</p><a href={safeSourceUrl(source.url)} target="_blank" rel="noreferrer" className="mt-1 block font-medium underline decoration-hairline underline-offset-4">{source.title}<span className="sr-only"> (opens in a new tab)</span></a>{source.summary&&<p className="mt-1 leading-relaxed text-graphite">{source.summary}</p>}</li>)}</ul></details>
  </article>;
}
