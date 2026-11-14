import { deleteMonitor } from "./context";
import { db, must } from "./db";

/**
 * Deletes a workspace: first its Context.dev monitors (so they stop running and spending credits),
 * then the database rows (competitors, monitors, events, battlecards… cascade).
 */
export async function deleteWorkspace(id: string): Promise<{ removed: number }> {
  const monitors = must(
    await db()
      .from("monitors")
      .select("context_monitor_id, competitors!inner(workspace_id)")
      .eq("competitors.workspace_id", id)
      .not("context_monitor_id", "is", null),
  ) as unknown as { context_monitor_id: string }[];

  const results = await Promise.allSettled(monitors.map((m) => deleteMonitor(m.context_monitor_id)));
  const failed = results.filter(
    (r): r is PromiseRejectedResult => r.status === "rejected" && !String(r.reason).includes("404"), // already gone is fine
  );
  // Keep the rows if any monitor is still alive, so we can retry instead of orphaning it.
  if (failed.length) throw new Error(`Could not delete ${failed.length} monitors: ${failed[0].reason}`);

  must(await db().from("workspaces").delete().eq("id", id));
  return { removed: monitors.length };
}
