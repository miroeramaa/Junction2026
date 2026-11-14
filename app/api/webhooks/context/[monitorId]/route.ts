// Context.dev monitor webhooks. One URL per monitor so we can look up its signing secret before trusting the body.

import { after } from "next/server";
import type { Change } from "@/lib/context";
import { db } from "@/lib/db";
import { processEvent, storeChangeEvent } from "@/lib/pipeline";
import type { Signal } from "@/lib/types";
import { verifyWebhook } from "@/lib/webhook";

export const maxDuration = 120;

type Envelope = { id: string; event: "change.detected" | "run.completed"; data: { change?: Change | null; run?: { completed_at?: string } } };

export async function POST(req: Request, { params }: { params: Promise<{ monitorId: string }> }) {
  const { monitorId } = await params;
  const raw = Buffer.from(await req.arrayBuffer()); // verify the exact bytes before parsing

  const { data: monitor } = await db()
    .from("monitors")
    .select("id, competitor_id, signal, context_monitor_id, webhook_secret")
    .eq("id", monitorId)
    .maybeSingle();
  if (!monitor?.webhook_secret) return new Response("unknown monitor", { status: 404 });
  if (!verifyWebhook(raw, req.headers.get("x-context-signature") ?? "", monitor.webhook_secret)) {
    return new Response("bad signature", { status: 401 });
  }

  const event = JSON.parse(raw.toString("utf8")) as Envelope;
  if (event.id !== req.headers.get("x-context-id")) return new Response("bad envelope", { status: 400 });

  if (event.event === "run.completed") {
    // Heartbeat: lets the UI show "checked 2 min ago" and that a sweep finished. Changes arrive via change.detected.
    await db().from("monitors").update({ status: "active", last_run_at: event.data.run?.completed_at ?? new Date().toISOString() }).eq("id", monitorId);
    return new Response(null, { status: 204 });
  }

  const change = event.data.change;
  if (!change || change.monitor_id !== monitor.context_monitor_id) return new Response("bad payload", { status: 400 });
  // Sitemaps churn: pages disappearing isn't a launch. Only new pages become events.
  if (monitor.signal === "launches" && !change.added_urls?.length) return new Response(null, { status: 204 });

  const eventId = await storeChangeEvent({
    contextEventId: event.id,
    monitorId,
    competitorId: monitor.competitor_id,
    signal: monitor.signal as Signal,
    change,
    raw: event,
  });
  // Acknowledge fast (Context.dev wants 2xx within 15 s); update the battlecard afterwards.
  if (eventId) after(() => processEvent(eventId).catch((e) => console.error("processEvent", eventId, e)));
  return new Response(null, { status: 204 });
}
