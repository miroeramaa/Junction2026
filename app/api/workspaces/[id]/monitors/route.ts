// Monitor health for the dashboard. The monitors table holds webhook secrets, so it isn't readable from the browser.

import { db, must } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rows = must(
    await db()
      .from("monitors")
      .select("id, competitor_id, signal, status, last_run_at, competitors!inner(workspace_id)")
      .eq("competitors.workspace_id", id),
  ) as unknown as { id: string; competitor_id: string; signal: string; status: string; last_run_at: string | null }[];
  return Response.json(rows.map(({ id, competitor_id, signal, status, last_run_at }) => ({ id, competitor_id, signal, status, last_run_at })));
}
