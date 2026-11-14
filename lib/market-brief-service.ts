import { createHash } from "node:crypto";
import { db, must } from "./db";
import { answer } from "./context";
import { loadFeedback } from "./signal-feedback";
import { comparisonLocale } from "./comparison";
import { BRIEF_PROMPT_VERSION, buildBriefTask, selectBriefEvidence, validateBriefOutput, type BriefRow, type MarketBrief } from "./market-brief";
import type { Competitor, EventRow, Workspace } from "./types";

export class BriefUnavailable extends Error { constructor(public readonly code: "storage" | "busy" | "cooldown" | "not_found" | "generation") { super(code); } }

async function inputs(workspaceId: string, locale: string) {
  const workspace = must(await db().from("workspaces").select("*").eq("id",workspaceId).maybeSingle()) as Workspace;
  if (!workspace) throw new BriefUnavailable("not_found");
  const competitors = must(await db().from("competitors").select("*").eq("workspace_id",workspaceId)) as Competitor[];
  const ids = competitors.filter(c => c.confirmed && !c.is_sandbox).map(c => c.id);
  const events = ids.length ? must(await db().from("events").select("id,competitor_id,signal,title,summary,importance,url,diff,detected_at,received_at,processed_at").in("competitor_id",ids).gte("received_at",new Date(Date.now()-31*86400000).toISOString()).order("received_at",{ascending:false}).limit(300)) as EventRow[] : [];
  const evidence = selectBriefEvidence(workspace,competitors,events,Date.now(),await loadFeedback(events.map(event => event.id)));
  const fingerprint = createHash("sha256").update(JSON.stringify({ version:BRIEF_PROMPT_VERSION,company:{ name:workspace.name,description:workspace.description,domain:workspace.domain },locale,evidence })).digest("hex");
  return {workspace,evidence,fingerprint};
}

export async function getMarketBrief(workspaceId: string, locale: string) {
  const row = await db().from("market_briefs").select("*").eq("workspace_id",workspaceId).maybeSingle();
  if (row.error) throw new BriefUnavailable("storage");
  const current = row.data as BriefRow | null;
  const source = await inputs(workspaceId,locale);
  const allowed = new Set(source.evidence.map(event=>event.id));
  const visibleCurrent = current?.content ? { ...current, content: { ...current.content, insights: current.content.insights.filter(insight=>insight.evidence.every(event=>allowed.has(event.id))) } } : current;
  return { row:visibleCurrent, eligible_events:source.evidence.length, stale:!!current?.content && current.input_fingerprint !== source.fingerprint, can_generate:source.evidence.some(event=>event.importance === "high") || source.evidence.some(event=>source.evidence.some(other=>other.competitor_id===event.competitor_id && other.url!==event.url)), locale };
}

export async function refreshMarketBrief(workspaceId: string, requestedLocale = "en", automatic = false) {
  const locale = comparisonLocale(requestedLocale);
  const source = await inputs(workspaceId,locale);
  // Probe storage before a paid call. Upsert seeds only the new cache row, preserving saved content.
  const seeded = await db().from("market_briefs").upsert({workspace_id:workspaceId},{onConflict:"workspace_id",ignoreDuplicates:true});
  if (seeded.error) throw new BriefUnavailable("storage");
  const existingResult = await db().from("market_briefs").select("*").eq("workspace_id",workspaceId).single();
  if (existingResult.error) throw new BriefUnavailable("storage");
  const previous = existingResult.data as BriefRow;
  if (previous.input_fingerprint === source.fingerprint && previous.content) return previous;
  const now = Date.now();
  if (previous.lease_until && Date.parse(previous.lease_until) > now) throw new BriefUnavailable("busy");
  if (previous.last_attempt_at && now-Date.parse(previous.last_attempt_at)<(automatic?300000:30000)) throw new BriefUnavailable("cooldown");
  const lease = new Date(now+90000).toISOString();
  const claimed = await db().from("market_briefs").update({status:"generating",last_attempt_at:new Date(now).toISOString(),lease_until:lease}).eq("workspace_id",workspaceId).or(`lease_until.is.null,lease_until.lt.${new Date(now).toISOString()}`).select("workspace_id").maybeSingle();
  if (claimed.error) throw new BriefUnavailable("storage");
  if (!claimed.data) throw new BriefUnavailable("busy");
  try {
    const enough = source.evidence.some(event=>event.importance === "high") || source.evidence.some(event=>source.evidence.some(other=>other.competitor_id===event.competitor_id && other.url!==event.url));
    let insights: MarketBrief["insights"] = [];
    if (enough) {
      const prompt = buildBriefTask(source.workspace,source.evidence,locale);
      const response = await answer<unknown>(
        prompt.task,
        {insights:[{headline:"What the evidence suggests",interpretation:"A cautious interpretation",relevance:"Why this may matter to the workspace company",next_step:"Specific investigation",confidence:"tentative",kind:"pattern",evidence_ids:["exact-event-id"]}]},
        30000,{maxRateLimitRetries:0,timeoutMs:40000},
      );
      insights = validateBriefOutput(response.json_content,prompt.evidence);
      if (!insights.length && Array.isArray((response.json_content as {insights?:unknown})?.insights) && (response.json_content as {insights:unknown[]}).insights.length) throw new Error("All generated insight citations failed validation");
    }
    const content: MarketBrief = {version:1,locale,window_start:new Date(now-30*86400000).toISOString(),insights,considered_events:source.evidence.length};
    const saved = await db().from("market_briefs").update({content,generated_at:new Date().toISOString(),input_fingerprint:source.fingerprint,status:"ready",lease_until:null}).eq("workspace_id",workspaceId).eq("lease_until",lease).select("*").single();
    if (saved.error) throw saved.error;
    return saved.data as BriefRow;
  } catch(error) {
    console.error("market brief generation",workspaceId,error);
    await db().from("market_briefs").update({status:"error",lease_until:null}).eq("workspace_id",workspaceId).eq("lease_until",lease);
    throw new BriefUnavailable("generation");
  }
}

/** Webhook processing must succeed even if brief generation is unavailable. */
export async function refreshMarketBriefAfterEvent(workspaceId: string) {
  try {
    const row = await db().from("market_briefs").select("content").eq("workspace_id",workspaceId).maybeSingle();
    if (row.error) return; // migration not applied yet
    // Automatic generation starts only after the workspace has opted in via Generate brief.
    if (!row.data?.content) return;
    await refreshMarketBrief(workspaceId,row.data.content.locale ?? "en",true);
  } catch(error) {
    if (!(error instanceof BriefUnavailable) || !["busy","cooldown"].includes(error.code)) console.error("market brief auto refresh",workspaceId,error);
  }
}
