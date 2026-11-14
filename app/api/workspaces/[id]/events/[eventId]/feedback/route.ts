import { db, must } from "@/lib/db";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string; eventId: string }> }) {
  const { id, eventId } = await params;
  const { rating } = (await req.json()) as { rating?: string };
  if (rating !== "useful" && rating !== "not_useful") return Response.json({ error: "Invalid rating." }, { status: 400 });
  const event = must(await db().from("events").select("id,competitors!inner(workspace_id)").eq("id", eventId).eq("competitors.workspace_id", id).maybeSingle());
  if (!event) return Response.json({ error: "Event not found." }, { status: 404 });
  must(await db().from("event_feedback").upsert({ event_id: eventId, rating, created_at: new Date().toISOString() }));
  return Response.json({ ok: true, rating });
}
