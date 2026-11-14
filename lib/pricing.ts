import { scrapeJson } from "./context";

export type Plan = {
  name: string;
  price_monthly_usd: number | null;
  price_monthly_usd_billed_yearly: number | null;
  billing_note: string | null;
  limits: string[];
  features: string[];
};

export const PRICING_SCHEMA = {
  type: "object",
  properties: {
    plans: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          price_monthly_usd: {
            type: ["number", "null"],
            description: "Per-month price in USD when billed monthly; null if not shown or custom/contact sales",
          },
          price_monthly_usd_billed_yearly: {
            type: ["number", "null"],
            description: "Per-month equivalent price in USD when billed yearly/annually; null if not shown",
          },
          billing_note: { type: ["string", "null"], description: "e.g. 'billed yearly', 'per seat', 'pay as you go'" },
          limits: { type: "array", items: { type: "string" }, description: "Usage limits, e.g. '100k credits/month'" },
          features: { type: "array", items: { type: "string" }, description: "Headline features of this plan" },
        },
        required: ["name", "price_monthly_usd", "price_monthly_usd_billed_yearly", "billing_note", "limits", "features"],
      },
    },
  },
  required: ["plans"],
};

export const PRICING_INSTRUCTIONS =
  "Extract every pricing plan shown on the page. Use only facts stated on the page. " +
  "Pages often have a monthly/yearly toggle and show only one by default: put each price in the field matching the billing " +
  "period the page states for it, and leave the other null. Never convert between them. " +
  "Only include subscription plans, not one-off credit packs or add-ons.";

/** Archived (Wayback) pages never change, so pass a long `maxAgeMs` for them to reuse cached extractions. */
export async function scrapePricing(url: string, maxAgeMs = 0): Promise<Plan[]> {
  const data = await scrapeJson<{ plans: Plan[] }>(url, PRICING_SCHEMA, { instructions: PRICING_INSTRUCTIONS, maxAgeMs });
  return data?.plans ?? [];
}

// ---------- Wayback Machine ----------

export type Snapshot = { timestamp: string; url: string };

/** About one archived snapshot per month since `fromYear`, via the free archive.org CDX API. */
export async function waybackMonthlySnapshots(pageUrl: string, fromYear: number): Promise<Snapshot[]> {
  const cdx =
    "https://web.archive.org/cdx/search/cdx?output=json&collapse=timestamp:6&filter=statuscode:200" +
    `&fl=timestamp,original&from=${fromYear}&url=${encodeURIComponent(pageUrl.replace(/^https?:\/\//, ""))}`;
  const res = await fetch(cdx);
  if (!res.ok) throw new Error(`CDX ${res.status}`);
  const rows = (await res.json()) as string[][];
  // `id_` serves the original page without the Wayback toolbar.
  return rows.slice(1).map(([timestamp, original]) => ({
    timestamp,
    url: `https://web.archive.org/web/${timestamp}id_/${original}`,
  }));
}

export function timestampToIso(ts: string): string {
  return `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}T${ts.slice(8, 10)}:${ts.slice(10, 12)}:${ts.slice(12, 14)}Z`;
}
