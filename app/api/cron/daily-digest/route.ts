import { db, must } from "@/lib/db";
import { SIGNAL_LABEL, type Signal } from "@/lib/types";

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  const settings = must(await db().from("workspace_alert_settings").select("workspace_id,email,signals,last_digest_at").eq("digest_enabled", true)) as { workspace_id: string; email: string; signals: Signal[]; last_digest_at: string | null }[];
  if (!process.env.RESEND_API_KEY || !process.env.DIGEST_FROM_EMAIL) return Response.json({ error: "Configure RESEND_API_KEY and DIGEST_FROM_EMAIL." }, { status: 503 });
  let sent = 0;
  for (const item of settings) {
    if (!item.email || !item.signals.length) continue;
    const since = item.last_digest_at ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const events = must(await db().from("events").select("id,signal,title,summary,importance,url,detected_at,received_at,competitors!inner(name,workspace_id)").eq("competitors.workspace_id", item.workspace_id).in("signal", item.signals).in("importance", ["high", "medium"]).gt("received_at", since).order("received_at", { ascending: false }).limit(5)) as { id: string; signal: Signal; title: string | null; summary: string | null; importance: string; url: string | null; detected_at: string | null; received_at: string; competitors: { name: string }[] }[];
    if (!events.length) continue;
    const html = `<h1>Your competitor changes today</h1><p>Top important updates from the last day:</p><ol>${events.map((e) => `<li><strong>${escapeHtml(e.competitors[0]?.name ?? "Competitor")} · ${escapeHtml(SIGNAL_LABEL[e.signal])}</strong><p>${escapeHtml(e.title ?? "Change detected")}</p><p>${escapeHtml(e.summary ?? "")}</p>${e.url?.startsWith("https://") ? `<p><a href="${escapeHtml(e.url)}">View source</a></p>` : ""}</li>`).join("")}</ol>`;
    const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: process.env.DIGEST_FROM_EMAIL, to: [item.email], subject: `Competitor Radar: ${events.length} important updates`, html }) });
    if (!response.ok) throw new Error(`Digest email failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
    must(await db().from("workspace_alert_settings").update({ last_digest_at: new Date().toISOString() }).eq("workspace_id", item.workspace_id));
    sent++;
  }
  return Response.json({ sent });
}
