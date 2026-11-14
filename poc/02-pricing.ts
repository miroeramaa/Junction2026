// PoC step 2: structured pricing today + pricing history from the Wayback Machine.
// Usage: npm run poc:pricing -- https://www.firecrawl.dev/pricing [maxSnapshots]
//    or: npm run poc:pricing            (uses the first competitor with a pricing URL from step 1)

import { readFile, writeFile } from "node:fs/promises";
import { scrapePricing, timestampToIso, waybackMonthlySnapshots, type Plan } from "../lib/pricing";

let url = process.argv[2];
const maxSnapshots = Number(process.argv[3] ?? 6);
if (!url) {
  const { competitors } = JSON.parse(await readFile(new URL("./out/competitors.json", import.meta.url), "utf8"));
  url = competitors.find((c: { pricing_url: string | null }) => c.pricing_url)?.pricing_url;
  if (!url) throw new Error("No pricing URL in poc/out/competitors.json; pass one as an argument");
}

const summarize = (plans: Plan[]) => plans.map((p) => `${p.name}: ${p.price_monthly_usd ?? "–"}/${p.price_monthly_usd_billed_yearly ?? "–"}`).join(" | ");

// Live
let t = Date.now();
const live = await scrapePricing(url);
console.log(`\nLIVE ${url} (${Date.now() - t} ms)`);
console.table(live.map((p) => ({ name: p.name, monthly: p.price_monthly_usd, yearly: p.price_monthly_usd_billed_yearly, note: p.billing_note, limits: p.limits.slice(0, 2).join("; ") })));

// History: evenly sample N of the monthly snapshots, scrape them in parallel.
const all = await waybackMonthlySnapshots(url, new Date().getFullYear() - 1);
const step = Math.max(1, Math.floor(all.length / maxSnapshots));
const picked = all.filter((_, i) => i % step === 0).slice(-maxSnapshots);
console.log(`\nWayback: ${all.length} monthly snapshots, scraping ${picked.length} in parallel…`);
t = Date.now();
const history = await Promise.all(
  picked.map(async (s) => {
    try {
      return { at: timestampToIso(s.timestamp), plans: await scrapePricing(s.url, 31536000000) };
    } catch (e) {
      return { at: timestampToIso(s.timestamp), plans: [] as Plan[], error: (e as Error).message.slice(0, 100) };
    }
  }),
);
console.log(`History done in ${Date.now() - t} ms`);
console.log("  (prices shown as billed-monthly/billed-yearly)");
for (const h of history) console.log(`  ${h.at.slice(0, 10)}  ${"error" in h ? `⚠ ${h.error}` : summarize(h.plans)}`);
console.log(`  ${new Date().toISOString().slice(0, 10)}  ${summarize(live)}  ← live`);

await writeFile(new URL("./out/pricing.json", import.meta.url), JSON.stringify({ url, live, history }, null, 2));
console.log("\nWrote poc/out/pricing.json");
