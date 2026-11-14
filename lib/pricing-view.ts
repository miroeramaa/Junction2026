// Pure helpers for showing pricing: plan matching across snapshots, redlines, chart series.
// Rule from the PoC: never compare a monthly-billed price with a yearly-billed one.

import type { Plan } from "./pricing";
import type { PricingSnapshot } from "./types";

export type Basis = "monthly" | "yearly";

export const planKey = (name: string) =>
  name.toLowerCase().replace(/\bplan\b/g, "").replace(/[^a-z0-9+]+/g, " ").trim();

export function priceOn(p: Plan, basis: Basis): number | null {
  return basis === "monthly" ? p.price_monthly_usd : p.price_monthly_usd_billed_yearly;
}

export function formatUsd(v: number | null): string {
  if (v == null) return "–";
  return v === 0 ? "Free" : `$${Number.isInteger(v) ? v : v.toFixed(2)}`;
}

/** Lowest price a customer can actually pay for, preferring monthly billing. */
export function entryPrice(plans: Plan[]): { plan: Plan; value: number; basis: Basis } | null {
  for (const basis of ["monthly", "yearly"] as const) {
    const paid = plans
      .map((plan) => ({ plan, value: priceOn(plan, basis), basis }))
      .filter((x): x is { plan: Plan; value: number; basis: Basis } => x.value != null && x.value > 0)
      .sort((a, b) => a.value - b.value);
    if (paid.length) return paid[0];
  }
  return null;
}

export type CellChange = { before: number | null; after: number | null };
export type PlanChanges = Map<string, { monthly?: CellChange; yearly?: CellChange; added?: boolean }>;

/** What changed between two snapshots, per plan, comparing like billing basis with like. */
export function diffPlans(prev: Plan[] | undefined, curr: Plan[]): PlanChanges {
  const out: PlanChanges = new Map();
  if (!prev?.length) return out;
  const before = new Map(prev.map((p) => [planKey(p.name), p]));
  for (const p of curr) {
    const key = planKey(p.name);
    const old = before.get(key);
    if (!old) {
      out.set(key, { added: true });
      continue;
    }
    const entry: { monthly?: CellChange; yearly?: CellChange } = {};
    for (const basis of ["monthly", "yearly"] as const) {
      const a = priceOn(old, basis);
      const b = priceOn(p, basis);
      // Only a real change when both snapshots state a price on this basis.
      if (a != null && b != null && a !== b) entry[basis] = { before: a, after: b };
    }
    if (entry.monthly || entry.yearly) out.set(key, entry);
  }
  return out;
}

export function removedPlans(prev: Plan[] | undefined, curr: Plan[]): string[] {
  if (!prev?.length) return [];
  const now = new Set(curr.map((p) => planKey(p.name)));
  return prev.filter((p) => !now.has(planKey(p.name))).map((p) => p.name);
}

export type SeriesPoint = { t: number; v: number; source: PricingSnapshot["source"] };
export type Series = { key: string; name: string; basis: Basis; points: SeriesPoint[] };

/**
 * Up to `max` paid plans from the latest snapshot, each on the billing basis it has most often,
 * so a page switching its default monthly/yearly toggle doesn't draw a fake price jump.
 */
export function historySeries(snaps: PricingSnapshot[], max = 4): Series[] {
  const sorted = [...snaps].sort((a, b) => a.captured_at.localeCompare(b.captured_at));
  const latest = sorted.at(-1);
  if (!latest) return [];
  const series: Series[] = [];
  for (const plan of latest.plans) {
    if (series.length >= max) break;
    const key = planKey(plan.name);
    const history = sorted.map((s) => ({ t: Date.parse(s.captured_at), source: s.source, p: s.plans.find((x) => planKey(x.name) === key) }));
    const count = (basis: Basis) => history.filter((h) => h.p && (priceOn(h.p, basis) ?? 0) > 0).length;
    const basis: Basis = count("monthly") >= count("yearly") ? "monthly" : "yearly";
    const points = history
      .map((h) => ({ t: h.t, source: h.source, v: h.p ? priceOn(h.p, basis) : null }))
      .filter((x): x is SeriesPoint => x.v != null && x.v > 0);
    if (points.length) series.push({ key, name: plan.name, basis, points });
  }
  return series;
}
