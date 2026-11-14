// Shared comparison data and pure presentation helpers. No server imports here.
import type { EventRow } from "./types";
import type { Plan } from "./pricing";

export type ComparisonFact = {
  text: string;
  quote: string;
  source_url?: string;
  captured_at?: string;
};

export type ComparisonProfile = {
  version: 1;
  source_url: string;
  captured_at: string;
  /** Language of the summaries. Evidence quotes remain verbatim in the source language. */
  locale?: string;
  pages?: { url: string; captured_at: string }[];
  warnings?: string[];
  audience_analysis?: {
    generated_at: string;
    basis_captured_at: string;
    locale?: string;
    segments: { label: string; reasoning: string; evidence: ComparisonFact[] }[];
  };
  positioning: ComparisonFact | null;
  target_customers: ComparisonFact[];
  capabilities: ComparisonFact[];
  pricing_model?: ComparisonFact | null;
};

export function comparisonLocale(value?: string | null): string {
  if (!value || value.length > 80 || !/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(value)) return "en";
  try {
    return Intl.getCanonicalLocales(value)[0] ?? "en";
  } catch {
    return "en";
  }
}

export function comparisonLanguageName(locale: string): string {
  const canonical = comparisonLocale(locale);
  try {
    return new Intl.DisplayNames([canonical], { type: "language" }).of(canonical) ?? canonical;
  } catch {
    return canonical;
  }
}

export function safeSourceUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function profileNeedsRefresh(profile: ComparisonProfile | null | undefined, events: EventRow[]): boolean {
  if (!profile) return false;
  const captured = Date.parse(profile.captured_at);
  return events.some((e) => e.signal === "positioning" && Date.parse(e.detected_at ?? e.received_at) > captured);
}

/** Monthly and annual commitments stay separate; entry pricing is not a feature-equivalent comparison. */
export function comparisonPrices(plans: Plan[]) {
  const lowest = (field: "price_monthly_usd" | "price_monthly_usd_billed_yearly") =>
    plans.filter((p) => p[field] != null && Number.isFinite(p[field]) && p[field]! > 0)
      .sort((a, b) => a[field]! - b[field]!)[0] ?? null;
  return {
    monthly: lowest("price_monthly_usd"),
    annual: lowest("price_monthly_usd_billed_yearly"),
    hasFree: plans.some((p) => p.price_monthly_usd === 0 || p.price_monthly_usd_billed_yearly === 0),
    terms: [...new Set(plans.map((p) => p.billing_note?.trim()).filter((s): s is string => !!s))],
  };
}

/** Do not mutate the realtime feed or assume events arrived in chronological order. */
export function recentCompetitorEvents(events: EventRow[], limit = 3): EventRow[] {
  return [...events].sort((a, b) => Date.parse(b.detected_at ?? b.received_at) - Date.parse(a.detected_at ?? a.received_at)).slice(0, limit);
}
