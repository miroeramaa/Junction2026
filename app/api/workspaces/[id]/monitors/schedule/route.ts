import { updateMonitorSchedule, type Schedule } from "@/lib/context";
import { db, must } from "@/lib/db";

const allowed = (s: Schedule) => s.type === "interval" && ((s.unit === "minutes" && [15, 30, 60].includes(s.frequency)) || (s.unit === "hours" && [1, 2, 4, 6, 12, 24].includes(s.frequency)));

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { monitorId, schedule } = (await req.json()) as { monitorId: string; schedule: Schedule };
  if (!monitorId || !schedule || !allowed(schedule)) return Response.json({ error: "Choose a supported check interval." }, { status: 400 });
  const monitor = must(await db().from("monitors").select("id,context_monitor_id,competitors!inner(workspace_id)").eq("id", monitorId).eq("competitors.workspace_id", id).maybeSingle()) as { id: string; context_monitor_id: string | null } | null;
  if (!monitor?.context_monitor_id) return Response.json({ error: "Monitor not found." }, { status: 404 });
  await updateMonitorSchedule(monitor.context_monitor_id, schedule);
  return Response.json({ ok: true });
}
