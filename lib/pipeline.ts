// What happens after a verified webhook is stored: update the competitor's battlecard.

import type { Change } from "./context";
import { db, must } from "./db";
import { scrapePricing, timestampToIso, type Plan } from "./pricing";
import { listBatchResults } from "./context";
import { refreshHowToWin } from "./how-to-win";
import type { Battlecard, Competitor, EventRow, FeedItem } from "./types";
import { meaningfulBriefEvent } from "./market-brief";
import { refreshMarketBriefAfterEvent } from "./market-brief-service";

const KEEP = 10; // feed items kept per battlecard section

const prepend = (list: FeedItem[] | null | undefined, items: FeedItem[]) => [...items, ...(list ?? [])].slice(0, KEEP);

function titleFromUrl(url: string): string {
  const slug = new URL(url).pathname.split("/").filter(Boolean).pop() ?? url;
  const words = slug.replace(/[-_]+/g, " ").replace(/\.\w+$/, "");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Store a `change.detected` webhook as an event row. Returns null if we've already seen it (retries/replays). */
export async function storeChangeEvent(opts: {
  contextEventId: string;
  monitorId: string;
  competitorId: string;
  signal: EventRow["signal"];
  change: Change;
  raw: unknown;
}): Promise<string | null> {
  const { change } = opts;
  const res = await db()
    .from("events")
    .insert({
      context_event_id: opts.contextEventId,
      monitor_id: opts.monitorId,
      competitor_id: opts.competitorId,
      signal: opts.signal,
      title: change.title,
      summary: change.summary,
      importance: change.importance ?? null,
      url: change.url,
      diff: change.diff ?? null,
      raw: opts.raw,
      detected_at: change.detected_at,
    })
    .select("id")
    .single();
  if (res.error?.code === "23505") return null; // unique violation on context_event_id → duplicate delivery
  return must(res).id;
}

export async function processEvent(eventId: string) {
  const ev = must(await db().from("events").select("*, raw").eq("id", eventId).single()) as EventRow & {
    raw: { data: { change: Change } };
  };
  const competitor = must(await db().from("competitors").select("*").eq("id", ev.competitor_id).single()) as Competitor;
  const card = must(await db().from("battlecards").select("*").eq("competitor_id", ev.competitor_id).single()) as Battlecard;
  const change = ev.raw.data.change;
  const at = ev.detected_at ?? ev.received_at;
  const patch: Partial<Battlecard> = {};

  switch (ev.signal) {
    case "pricing": {
      // The monitor told us *that* pricing changed; a fresh schema scrape gives the new structured table.
      if (competitor.pricing_url) {
        const plans = await scrapePricing(competitor.pricing_url);
        must(await db().from("pricing_snapshots").insert({ competitor_id: competitor.id, captured_at: at, source: "live", plans }));
        patch.pricing = { plans, captured_at: at };
      }
      break;
    }
    case "launches": {
      const added = change.added_urls ?? [];
      patch.launches = prepend(card.launches, added.map((url) => ({ title: titleFromUrl(url), url, at })));
      break;
    }
    case "news":
      patch.news = prepend(card.news, [{ title: change.title, summary: change.summary, url: change.url, at }]);
      break;
    case "hiring":
      patch.hiring = prepend(card.hiring, [{ title: change.title, summary: change.summary, url: change.url, at }]);
      break;
    case "positioning":
      patch.positioning = { title: change.title, summary: change.summary, url: change.url, at };
      break;
  }

  const now = new Date().toISOString();
  must(await db().from("battlecards").update({ ...patch, updated_at: now, last_event_id: ev.id }).eq("competitor_id", competitor.id));
  must(await db().from("events").update({ processed_at: now, battlecard_updated_at: now }).eq("id", ev.id));

  // After the data is live (so the latency badge measures the data update), rewrite the sales brief.
  await Promise.allSettled([
    refreshHowToWin(competitor.id),
    ...(!competitor.is_sandbox && meaningfulBriefEvent(ev) ? [refreshMarketBriefAfterEvent(competitor.workspace_id)] : []),
  ]);
}

/** Batch finished: write live pricing to battlecards and Wayback results to pricing_snapshots. */
export async function processPricingBatch(batchId: string) {
  const results = await listBatchResults<{ plans: Plan[] }>(batchId);
  for (const r of results) {
    const plans = r.status === "ok" && r.result?.json?.success ? r.result.json.data?.plans : null;
    if (!plans?.length) continue;
    const [competitorId, stamp] = r.itemId.split("|");
    const captured_at = stamp === "live" ? new Date().toISOString() : timestampToIso(stamp);
    must(
      await db()
        .from("pricing_snapshots")
        .insert({ competitor_id: competitorId, captured_at, source: stamp === "live" ? "live" : "wayback", plans }),
    );
    if (stamp === "live") {
      must(await db().from("battlecards").update({ pricing: { plans, captured_at }, updated_at: captured_at }).eq("competitor_id", competitorId));
    }
  }
  must(await db().from("batches").update({ status: "processed" }).eq("id", batchId));

  // First briefs for every competitor in the batch, now that their pricing is known.
  const competitorIds = [...new Set(results.map((r) => r.itemId.split("|")[0]))];
  await Promise.all(competitorIds.map((id) => refreshHowToWin(id)));
}
