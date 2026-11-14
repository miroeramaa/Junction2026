// Context.dev batch webhooks (pricing backfill finished).

import { after } from "next/server";
import { db } from "@/lib/db";
import { processPricingBatch } from "@/lib/pipeline";
import { verifyWebhook } from "@/lib/webhook";

export const maxDuration = 120;

export async function POST(req: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const raw = Buffer.from(await req.arrayBuffer());

  // The batch id is only known after submit, so read it from the body to find the secret, then verify.
  let batchId: string | undefined;
  try {
    batchId = JSON.parse(raw.toString("utf8"))?.data?.batch?.id;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  const { data: batch } = await db().from("batches").select("id, webhook_secret").eq("id", batchId ?? "").eq("workspace_id", workspaceId).maybeSingle();
  if (!batch) return new Response("unknown batch", { status: 404 });
  if (!verifyWebhook(raw, req.headers.get("x-context-signature") ?? "", batch.webhook_secret)) {
    return new Response("bad signature", { status: 401 });
  }

  const event = JSON.parse(raw.toString("utf8")) as { event: string; data: { batch: { status: string } } };
  await db().from("batches").update({ status: event.data.batch.status }).eq("id", batch.id);
  if (event.event === "batch.completed") {
    after(() => processPricingBatch(batch.id).catch((e) => console.error("processPricingBatch", batch.id, e)));
  }
  return new Response(null, { status: 204 });
}
