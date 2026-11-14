// Prints the app's live state: monitors, battlecard pricing, history batch, latest events.
// Usage: npm run status

import { db } from "../lib/db";

type Named = { name: string };
type PlanRow = { name: string; price_monthly_usd: number | null; price_monthly_usd_billed_yearly: number | null };

const { data: monitors } = await db().from("monitors").select("signal, status, last_run_at, competitors(name)");
console.log("MONITORS");
for (const m of monitors ?? []) {
  console.log(" ", (m.competitors as unknown as Named).name.padEnd(24), m.signal.padEnd(9), m.status, m.last_run_at ?? "");
}

const { data: cards } = await db().from("battlecards").select("pricing, launches, competitors(name)");
console.log("BATTLECARDS (monthly/yearly)");
for (const b of cards ?? []) {
  const plans = (b.pricing?.plans ?? []) as PlanRow[];
  const prices = plans.map((p) => `${p.name}: ${p.price_monthly_usd ?? "–"}/${p.price_monthly_usd_billed_yearly ?? "–"}`).join(" | ");
  console.log(" ", (b.competitors as unknown as Named).name.padEnd(24), prices || "no pricing yet", `· ${b.launches.length} launches`);
}

const { data: batches } = await db().from("batches").select("id, status");
console.log("BATCHES", batches);
const { data: snaps } = await db().from("pricing_snapshots").select("source");
console.log("SNAPSHOTS", {
  wayback: snaps?.filter((s) => s.source === "wayback").length,
  live: snaps?.filter((s) => s.source === "live").length,
});

const { data: events } = await db()
  .from("events")
  .select("signal, title, summary, detected_at, battlecard_updated_at")
  .order("received_at", { ascending: false })
  .limit(5);
console.log("EVENTS");
for (const e of events ?? []) console.log(" ", e.detected_at, e.signal, "·", e.title, "·", e.summary);
