// Which Context.dev monitors we create for a competitor, and creating them.

import { createMonitor, runMonitorNow, type MonitorTarget, type Schedule } from "./context";
import { appUrl, db, must } from "./db";
import type { Competitor, Signal } from "./types";

const PRICING_INSTRUCTIONS =
  "Only report changes to plan names, prices, billing periods, usage limits or included features. " +
  "Ignore layout, testimonials, logos, cookie banners and marketing copy.";
const HIRING_INSTRUCTIONS =
  "Report new or removed job postings (title, team, location). Ignore page chrome, benefits copy and culture text.";
const POSITIONING_INSTRUCTIONS =
  "Report changes to the main headline, tagline, target customer or key value propositions. Ignore logos, testimonials and footers.";
const NEWS_INSTRUCTIONS =
  "Report concrete developments about this company: launches, pricing changes, funding, acquisitions, partnerships, " +
  "layoffs, leadership changes, outages. Ignore listicles, tutorials, opinion pieces and the company's own SEO pages.";

/**
 * Signals to watch, in priority order. MONITOR_SIGNALS trims this when the plan's monitor allowance is small
 * (the Free plan allows 10 monitors in total).
 */
export function enabledSignals(): Signal[] {
  const all: Signal[] = ["pricing", "launches", "news", "hiring", "positioning"];
  const env = process.env.MONITOR_SIGNALS;
  return env ? all.filter((s) => env.split(",").map((x) => x.trim()).includes(s)) : all;
}

export function targetFor(c: Competitor, signal: Signal): { target: MonitorTarget; schedule: Schedule } | null {
  const every = (frequency: number, unit: Schedule["unit"]): Schedule => ({ type: "interval", frequency, unit });
  switch (signal) {
    case "pricing":
      return c.pricing_url
        ? { target: { type: "page", url: c.pricing_url, instructions: PRICING_INSTRUCTIONS }, schedule: every(15, "minutes") }
        : null;
    case "launches": {
      if (!c.blog_url && !c.is_sandbox) return null;
      if (c.is_sandbox) return { target: { type: "sitemap", url: `${appUrl()}/sandbox/sitemap.xml` }, schedule: every(1, "hours") };
      const blog = new URL(c.blog_url!);
      // Blog on a subdomain (blog.x.com): watch that host's sitemaps. Otherwise filter the domain's sitemap by path.
      const path = blog.pathname.replace(/\/$/, "");
      return {
        target: { type: "sitemap", url: blog.origin, ...(path ? { include: [`${path}/*`] } : {}) },
        schedule: every(1, "hours"),
      };
    }
    case "news":
      if (c.is_sandbox) return null; // nothing real to find in the press about the fake competitor
      return {
        target: { type: "search", query: `"${c.name}" -site:${c.domain}`, instructions: NEWS_INSTRUCTIONS },
        schedule: every(1, "hours"),
      };
    case "hiring":
      return c.careers_url
        ? { target: { type: "page", url: c.careers_url, instructions: HIRING_INSTRUCTIONS }, schedule: every(1, "hours") }
        : null;
    case "positioning":
      return c.homepage_url
        ? { target: { type: "page", url: c.homepage_url, instructions: POSITIONING_INSTRUCTIONS }, schedule: every(1, "hours") }
        : null;
  }
}

/** Creates our monitor row first (its id goes in the webhook URL), then the Context.dev monitor. */
export async function createMonitorsFor(c: Competitor, signals = enabledSignals()) {
  for (const signal of signals) {
    const spec = targetFor(c, signal);
    if (!spec) continue;
    const row = must(
      await db().from("monitors").insert({ competitor_id: c.id, signal, target: spec.target }).select("id").single(),
    );
    try {
      const m = await createMonitor({
        name: `${c.name} · ${signal}`,
        target: spec.target,
        schedule: spec.schedule,
        webhookUrl: `${appUrl()}/api/webhooks/context/${row.id}`,
        tags: [signal, c.workspace_id.slice(0, 8)],
      });
      must(
        await db()
          .from("monitors")
          .update({ context_monitor_id: m.id, webhook_secret: m.webhook?.secret ?? null, status: "baseline" })
          .eq("id", row.id),
      );
    } catch (e) {
      must(await db().from("monitors").update({ status: `error: ${(e as Error).message.slice(0, 200)}` }).eq("id", row.id));
    }
  }
}

/** "Sweep now": queue a run on every monitor of a workspace. Monitors API has its own 1,000/min limit. */
export async function sweepWorkspace(workspaceId: string) {
  const rows = must(
    await db()
      .from("monitors")
      .select("id, context_monitor_id, competitors!inner(workspace_id)")
      .eq("competitors.workspace_id", workspaceId)
      .not("context_monitor_id", "is", null)
      .in("status", ["active", "baseline", "failed"]),
  ) as unknown as { id: string; context_monitor_id: string }[];
  const results = await Promise.allSettled(rows.map((r) => runMonitorNow(r.context_monitor_id)));
  return { queued: results.filter((r) => r.status === "fulfilled").length, total: rows.length };
}
