import { z } from "zod";
import { createHash } from "node:crypto";
import { createMonitor, deleteMonitor, getMonitor, updateMonitor, type MonitorTarget } from "./context";
import { appUrl, db, must } from "./db";
import { targetFor } from "./monitors";
import type { Competitor, Signal } from "./types";

function stableId(scope: string) {
  const hex = createHash("sha256").update(scope).digest("hex").slice(0,32);
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20)}`;
}
export class ControlError extends Error { constructor(message: string, public status = 400) { super(message); } }
export function publicUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new ControlError("Enter a complete public URL, starting with https://."); }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port || !host.includes(".") || /[\[\]:]/.test(host) || /^\d+(\.\d+){3}$/.test(host) || /(?:^|\.)(localhost|local|internal|lan|test|invalid)$/.test(host)) {
    throw new ControlError("Use a public website URL without credentials or a custom port.");
  }
  url.hash = "";
  return url.href;
}
export const signalInput = z.enum(["pricing", "launches", "news", "hiring", "positioning"]);
export const sourceInput = z.object({ signal: signalInput, url: z.string().trim().max(2000).optional(), query: z.string().trim().min(3).max(500).optional() }).strict();
export const sourcePatch = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pause") }).strict(), z.object({ action: z.literal("resume") }).strict(), z.object({ action: z.literal("retry") }).strict(),
  z.object({ action: z.literal("update"), url: z.string().trim().max(2000).optional(), query: z.string().trim().min(3).max(500).optional() }).strict(),
]);
export const competitorInput = z.object({ name: z.string().trim().min(1).max(100), website: z.string().trim().min(3).max(2000) }).strict();

type StoredMonitor = { id: string; competitor_id: string; signal: Signal; context_monitor_id: string | null; status: string; target: MonitorTarget; webhook_secret: string | null };
export async function competitorInWorkspace(workspaceId: string, competitorId: string): Promise<Competitor> {
  const competitor = must(await db().from("competitors").select("*").eq("id", competitorId).eq("workspace_id", workspaceId).maybeSingle()) as Competitor | null;
  if (!competitor) throw new ControlError("Competitor not found in this workspace.", 404);
  if (!competitor.confirmed) throw new ControlError("This competitor is being removed or is not confirmed yet. Please reload.", 409);
  return competitor;
}
function editedTarget(original: MonitorTarget, input: { url?: string; query?: string }): MonitorTarget {
  if (original.type === "search") {
    if (!input.query || input.url) throw new ControlError("Enter a press search query for this source.");
    return { ...original, query: input.query };
  }
  if (!input.url || input.query) throw new ControlError("Enter the URL to watch for this source.");
  // A PATCH replaces the whole target. Preserve instructions, selectors and sitemap scope.
  return { ...original, url: publicUrl(input.url) };
}
function freshTarget(c: Competitor, input: z.infer<typeof sourceInput>): MonitorTarget {
  if (input.signal === "news") return editedTarget(targetFor(c, "news")?.target ?? { type: "search", query: "" }, input);
  const template = targetFor({ ...c, pricing_url: input.url ?? null, careers_url: input.url ?? null, homepage_url: input.url ?? null, blog_url: input.url ?? null }, input.signal)?.target;
  if (!template) throw new ControlError("Enter a URL for this source.");
  // A manually supplied sitemap URL is watched exactly, without an inferred blog-path restriction.
  return input.signal === "launches" ? { type: "sitemap", url: publicUrl(input.url!) } : editedTarget(template, input);
}
async function createRemote(c: Competitor, row: StoredMonitor) {
  const monitor = await createMonitor({ name: `${c.name} · ${row.signal}`, target: row.target, schedule: { type: "interval", frequency: row.signal === "pricing" ? 15 : 60, unit: "minutes" }, webhookUrl: `${appUrl()}/api/webhooks/context/${row.id}`, tags: [row.signal, c.workspace_id.slice(0,8)] });
  // Store the remote id before any other writes so a retry/removal can always find it.
  const link = { context_monitor_id: monitor.id, webhook_secret: monitor.webhook?.secret ?? null, status: "baseline" };
  let saved = await db().from("monitors").update(link).eq("id", row.id);
  if (saved.error) saved = await db().from("monitors").update(link).eq("id", row.id); // retry the write, never the paid creation
  if (saved.error) {
    try { await deleteMonitor(monitor.id); } catch (error) { console.error("source cleanup required", row.id, monitor.id, error); }
    throw new ControlError("The source could not be saved. Please try again.", 503);
  }
}
async function savePageField(c: Competitor, signal: Signal, target: MonitorTarget) {
  const field = signal === "pricing" ? "pricing_url" : signal === "hiring" ? "careers_url" : signal === "positioning" ? "homepage_url" : null;
  if (field && target.type === "page") {
    must(await db().from("competitors").update({ [field]: target.url }).eq("id", c.id));
    if (field === "pricing_url" && c.pricing_url !== target.url) {
      // Old prices must not be presented as if they came from the corrected source. History remains intact.
      must(await db().from("battlecards").update({ pricing: null }).eq("competitor_id", c.id));
    }
  }
}
export async function addSource(workspaceId: string, competitorId: string, input: z.infer<typeof sourceInput>) {
  const competitor = await competitorInWorkspace(workspaceId, competitorId);
  const target = freshTarget(competitor, input);
  const existing = must(await db().from("monitors").select("id").eq("competitor_id", competitorId).eq("signal", input.signal));
  if (existing.length) throw new ControlError("This source already exists. Edit or retry it below.", 409);
  const row = must(await db().from("monitors").insert({ id: stableId(`source:${competitorId}:${input.signal}`), competitor_id: competitorId, signal: input.signal, target, status: "updating" }).select("*").single()) as StoredMonitor;
  try {
    await competitorInWorkspace(workspaceId, competitorId);
    await createRemote(competitor, row);
    await savePageField(competitor, input.signal, target);
  } catch (error) {
    await db().from("monitors").update({ status: "error: source setup incomplete" }).eq("id", row.id);
    console.error("source setup", row.id, error);
    throw new ControlError("This source isn’t ready yet. Your competitor was kept; retry the source below.", 502);
  }
  return { id: row.id };
}
export async function changeSource(workspaceId: string, monitorId: string, input: z.infer<typeof sourcePatch>) {
  const row = must(await db().from("monitors").select("*,competitors!inner(workspace_id)").eq("id", monitorId).eq("competitors.workspace_id", workspaceId).maybeSingle()) as StoredMonitor | null;
  if (!row) throw new ControlError("Source not found in this workspace.", 404);
  if (row.status === "updating" || row.status === "deleting") throw new ControlError("This source is already being updated. Please wait.", 409);
  // Validate before taking a lock or making an external call.
  if (input.action === "update") editedTarget(row.target, input);
  const competitor = await competitorInWorkspace(workspaceId, row.competitor_id);
  const lock = await db().from("monitors").update({ status: "updating" }).eq("id", monitorId).eq("status", row.status).select("id").maybeSingle();
  if (lock.error || !lock.data) throw new ControlError("This source changed while you were editing it. Reload and try again.", 409);
  try {
    let target = input.action === "update" ? editedTarget(row.target, input) : row.target;
    let status = input.action === "pause" ? "paused" : input.action === "resume" ? "active" : row.status;
    if (row.context_monitor_id) {
      // Read remote truth first: this also recovers a prior upstream-success/local-save-failure.
      const remote = await getMonitor(row.context_monitor_id);
      target = input.action === "update" ? editedTarget(remote.target ?? row.target, input) : remote.target ?? row.target;
      const targetChanged = JSON.stringify(target) !== JSON.stringify(remote.target ?? row.target);
      const desiredStatus = input.action === "pause" ? "paused" : input.action === "resume" ? "active" : remote.status === "paused" ? "paused" : "active";
      const result = await updateMonitor(row.context_monitor_id, { ...(targetChanged ? { target, change_detection: { type: target.type === "sitemap" ? "exact" : target.type === "search" || target.instructions ? "semantic" : "exact" } } : {}), status: desiredStatus });
      status = desiredStatus === "paused" ? "paused" : targetChanged ? "baseline" : result.status;
    } else if (input.action !== "pause") {
      await createRemote(competitor, { ...row, target });
      status = "baseline";
    }
    must(await db().from("monitors").update({ target, status }).eq("id", monitorId));
    if (input.action === "update") await savePageField(competitor, row.signal, target);
    return { ok: true };
  } catch (error) {
    // Do not claim that a failed/ambiguous upstream operation succeeded. Keep a recoverable source row.
    await db().from("monitors").update({ status: "error: source update incomplete" }).eq("id", monitorId);
    console.error("source update", monitorId, error);
    throw new ControlError("We couldn’t finish updating this source. Retry to sync its latest state.", 502);
  }
}
export async function addCompetitor(workspaceId: string, input: z.infer<typeof competitorInput>) {
  const website = publicUrl(/^https?:\/\//i.test(input.website) ? input.website : `https://${input.website}`);
  const domain = new URL(website).hostname.replace(/^www\./, "");
  const workspace = must(await db().from("workspaces").select("id,domain").eq("id", workspaceId).maybeSingle());
  if (!workspace) throw new ControlError("Workspace not found.", 404);
  if (domain === workspace.domain.replace(/^www\./,"")) throw new ControlError("This is your own company. Choose a competitor.");
  const existing = must(await db().from("competitors").select("id").eq("workspace_id", workspaceId).eq("domain", domain));
  if (existing.length) throw new ControlError("This competitor is already in your workspace.", 409);
  const competitor = must(await db().from("competitors").insert({ id: stableId(`competitor:${workspaceId}:${domain}`), workspace_id: workspaceId, name: input.name, domain, homepage_url: website, confirmed: true, is_sandbox: false, why: "Added by your team" }).select("*").single()) as Competitor;
  try { must(await db().from("battlecards").insert({ competitor_id: competitor.id })); }
  catch (error) { await db().from("competitors").delete().eq("id",competitor.id); throw error; }
  const issues: string[] = [];
  for (const signal of ["positioning", "news"] as const) {
    try { await addSource(workspaceId, competitor.id, { signal, ...(signal === "news" ? { query: `"${input.name}" -site:${domain}` } : { url: website }) }); }
    catch { issues.push(signal); }
  }
  return { competitor, incomplete_sources: issues };
}
export async function removeCompetitor(workspaceId: string, competitorId: string) {
  await competitorInWorkspace(workspaceId, competitorId);
  // Reuse the existing confirmation flag as a removal lock. Other source actions require confirmation.
  const claimed = await db().from("competitors").update({confirmed:false}).eq("id",competitorId).eq("workspace_id",workspaceId).eq("confirmed",true).select("id").maybeSingle();
  if (claimed.error || !claimed.data) throw new ControlError("This competitor is already being changed. Please wait.",409);
  try {
    const monitors = must(await db().from("monitors").select("id,context_monitor_id,status").eq("competitor_id",competitorId));
    if (monitors.some(m => m.status === "updating" || m.status === "deleting")) throw new ControlError("A source is being updated. Wait for it to finish before removing this competitor.",409);
    // Stop paid remote work before cascading local history. Failed deletion leaves retryable rows.
    for (const monitor of monitors) {
      if (!monitor.context_monitor_id) continue;
      const locked = await db().from("monitors").update({status:"deleting"}).eq("id",monitor.id).eq("status",monitor.status).select("id").maybeSingle();
      if (locked.error || !locked.data) throw new ControlError("A source changed during removal. Please retry.",409);
      try { await deleteMonitor(monitor.context_monitor_id); }
      catch (error) {
        if (!(error instanceof Error) || !/→ 404:/.test(error.message)) {
          await db().from("monitors").update({status:"error: removal incomplete"}).eq("id",monitor.id);
          throw new ControlError("Some sources could not be stopped. The competitor was kept; try removing it again.",502);
        }
      }
      must(await db().from("monitors").update({ status: "paused", context_monitor_id: null, webhook_secret: null }).eq("id",monitor.id));
    }
    must(await db().from("competitors").delete().eq("id",competitorId).eq("workspace_id",workspaceId));
    return { ok: true };
  } catch (error) {
    await db().from("competitors").update({confirmed:true}).eq("id",competitorId).eq("workspace_id",workspaceId);
    // Recover the local lock even if deleting remotely succeeded but saving its status failed.
    await db().from("monitors").update({status:"error: removal incomplete"}).eq("competitor_id",competitorId).eq("status","deleting");
    throw error;
  }
}

export function controlResponse(error: unknown): Response {
  if (error instanceof ControlError) return Response.json({ error: error.message }, { status: error.status });
  console.error("competitor/source control",error);
  return Response.json({ error: "The update couldn’t finish. Please reload and try again." },{status:503});
}
