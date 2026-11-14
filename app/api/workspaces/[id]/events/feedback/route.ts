import { db, must } from "@/lib/db";
import { loadFeedback } from "@/lib/signal-feedback";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const events = must(await db().from("events").select("id,competitors!inner(workspace_id)").eq("competitors.workspace_id", id).order("received_at", { ascending: false }).limit(300));
    return Response.json({ feedback: await loadFeedback(events.map(event => event.id)) });
  } catch { return Response.json({ error: "Couldn’t load your team’s signal preferences." }, { status: 503 }); }
}
