import { db } from "./db";
import type { Feedback } from "./signals";

export async function loadFeedback(eventIds: string[]): Promise<Feedback> {
  if (!eventIds.length) return {};
  const result = await db().from("event_feedback").select("event_id,rating").in("event_id", eventIds);
  if (result.error) throw new Error("Feedback unavailable");
  return Object.fromEntries((result.data ?? []).map(row => [row.event_id, row.rating]));
}
