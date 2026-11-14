// Onboarding: company → competitors (review) → monitors + pricing history (watching).
// Progress is written to the workspace/competitor rows; the UI follows along via Realtime.

import { answer, retrieveBrand, submitJsonBatch, type BatchUrl } from "./context";
import { appUrl, db, must } from "./db";
import { createMonitorsFor } from "./monitors";
import { PRICING_INSTRUCTIONS, PRICING_SCHEMA, waybackMonthlySnapshots } from "./pricing";
import type { Competitor } from "./types";

const COMPETITOR_COUNT = Number(process.env.COMPETITOR_COUNT ?? 7);
const HISTORY_SNAPSHOTS = Number(process.env.HISTORY_SNAPSHOTS ?? 6);

async function setStatus(workspaceId: string, status: string, detail: string | null) {
  must(await db().from("workspaces").update({ status, status_detail: detail }).eq("id", workspaceId));
}

export async function createWorkspace(domain: string, name: string): Promise<string> {
  const row = must(await db().from("workspaces").insert({ domain, name }).select("id").single());
  return row.id;
}

/** Brand → Answers → Brand per competitor. Ends in status 'review' with unconfirmed competitors. */
export async function discoverCompetitors(workspaceId: string, domain: string) {
  try {
    await setStatus(workspaceId, "discovering", "Reading your company profile…");
    const me = await retrieveBrand(domain);
    const industries = me.industries?.eic?.map((i) => `${i.industry} / ${i.subindustry}`).join(", ");
    must(
      await db()
        .from("workspaces")
        .update({ name: me.title ?? domain, description: me.description ?? null, logo_url: me.logos?.[0]?.url ?? null })
        .eq("id", workspaceId),
    );

    await setStatus(workspaceId, "discovering", "Researching your competitors on the live web…");
    const { json_content } = await answer<{ competitors: { name: string; domain: string; why: string }[] }>(
      `List the ${COMPETITOR_COUNT} most direct competitors of ${me.title ?? domain} (${domain}). ` +
        `What it does: ${me.description ?? "unknown"}. Industry: ${industries ?? "unknown"}. ` +
        `Only companies selling a substitute product to the same customers. Give each company's primary website domain (no protocol).`,
      { competitors: [{ name: "", domain: "", why: "" }] },
    );
    const found = (json_content.competitors ?? []).filter((c) => c.domain && c.domain !== domain);

    await setStatus(workspaceId, "discovering", `Found ${found.length} competitors. Looking up their pages…`);
    // Sequential on purpose: the Free plan allows 2 concurrent requests; each row appears in the UI as it lands.
    for (const c of found) {
      let b: Awaited<ReturnType<typeof retrieveBrand>> | null = null;
      try {
        b = await retrieveBrand(c.domain);
      } catch {
        // Keep the competitor without links; the user can still confirm it.
      }
      must(
        await db()
          .from("competitors")
          .insert({
            workspace_id: workspaceId,
            name: c.name,
            domain: c.domain,
            why: c.why,
            logo_url: b?.logos?.[0]?.url ?? null,
            pricing_url: b?.links?.pricing ?? null,
            blog_url: b?.links?.blog ?? null,
            careers_url: b?.links?.careers ?? null,
            homepage_url: `https://${c.domain}`,
          }),
      );
    }
    await setStatus(workspaceId, "review", null);
  } catch (e) {
    await setStatus(workspaceId, "error", (e as Error).message.slice(0, 500));
  }
}

/** Adds the fake demo competitor served at /sandbox. */
export async function addSandboxCompetitor(workspaceId: string) {
  const base = appUrl();
  must(
    await db()
      .from("competitors")
      .insert({
        workspace_id: workspaceId,
        name: "Scrapr (demo sandbox)",
        domain: new URL(base).host,
        why: "Demo sandbox we control, for showing live reactions on stage.",
        pricing_url: `${base}/sandbox/pricing`,
        blog_url: `${base}/sandbox/blog`,
        careers_url: `${base}/sandbox/careers`,
        homepage_url: `${base}/sandbox`,
        is_sandbox: true,
      }),
  );
}

/** Keeps the chosen competitors, creates their monitors and battlecards, and starts the pricing backfill. */
export async function confirmCompetitors(workspaceId: string, competitorIds: string[]) {
  try {
    await setStatus(workspaceId, "watching", "Creating monitors…");
    must(await db().from("competitors").delete().eq("workspace_id", workspaceId).not("id", "in", `(${competitorIds.join(",")})`));
    must(await db().from("competitors").update({ confirmed: true }).in("id", competitorIds));
    const competitors = must(await db().from("competitors").select("*").in("id", competitorIds)) as Competitor[];

    must(await db().from("battlecards").upsert(competitors.map((c) => ({ competitor_id: c.id }))));
    for (const c of competitors) await createMonitorsFor(c);

    await setStatus(workspaceId, "watching", "Building pricing history from the Wayback Machine…");
    await startPricingBackfill(workspaceId, competitors);
    await setStatus(workspaceId, "watching", null);
  } catch (e) {
    await setStatus(workspaceId, "error", (e as Error).message.slice(0, 500));
  }
}

/**
 * One Context.dev batch scrapes every competitor's current pricing page plus ~monthly Wayback snapshots.
 * Batches have their own rate limit, so this avoids the 10 requests/minute Free-plan cap.
 * Results arrive at /api/webhooks/batch/[batchId]. itemId = `${competitorId}|${timestamp or "live"}`.
 */
export async function startPricingBackfill(workspaceId: string, competitors: Competitor[]) {
  const urls: BatchUrl[] = [];
  for (const c of competitors) {
    if (!c.pricing_url) continue;
    urls.push({ url: c.pricing_url, itemId: `${c.id}|live` });
    if (c.is_sandbox) continue;
    try {
      const snaps = await waybackMonthlySnapshots(c.pricing_url, new Date().getFullYear() - 1);
      const step = Math.max(1, Math.floor(snaps.length / HISTORY_SNAPSHOTS));
      for (const s of snaps.filter((_, i) => i % step === 0).slice(-HISTORY_SNAPSHOTS)) {
        urls.push({ url: s.url, itemId: `${c.id}|${s.timestamp}` });
      }
    } catch {
      // No archive for this page; it just gets no history.
    }
  }
  if (!urls.length) return;

  // We need the batch id in the webhook URL, but only get it after submitting; so route by workspace and
  // look the batch up by the id inside the (verified) payload.
  const batch = await submitJsonBatch({
    urls,
    schema: PRICING_SCHEMA,
    instructions: PRICING_INSTRUCTIONS,
    webhookUrl: `${appUrl()}/api/webhooks/batch/${workspaceId}`,
  });
  must(
    await db().from("batches").insert({ id: batch.id, workspace_id: workspaceId, webhook_secret: batch.webhook_secret, status: batch.status }),
  );
}
