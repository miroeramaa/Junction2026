import { db } from "./db";
import { ComparisonResearchError } from "./comparison-error";
import type { ComparisonProfile } from "./comparison";

// PostgreSQL JSONB rejects NUL and unpaired Unicode surrogates, which scraped pages can contain.
export function databaseSafeProfile(profile: ComparisonProfile): ComparisonProfile {
  return JSON.parse(JSON.stringify(profile, (_key, value) => typeof value === "string" ? value.toWellFormed().replace(/\u0000/g, "") : value));
}

export async function saveComparisonProfile(competitorId: string, input: ComparisonProfile, previousCapture?: string) {
  const profile = databaseSafeProfile(input);
  for (let attempt = 0; attempt < 2; attempt++) {
    let query = db().from("battlecards").update({ comparison_profile: profile }).eq("competitor_id", competitorId);
    if (previousCapture) query = query.eq("comparison_profile->>captured_at", previousCapture);
    const saved = await query.select("competitor_id").maybeSingle();
    if (!saved.error && saved.data) return profile;
    if (!saved.error) throw new ComparisonResearchError("The research changed while this update was running. Refresh the page to see the latest version.", 409);
    console.error("comparison save failed", { competitorId, code: saved.error.code, message: saved.error.message, status: saved.status });
    const transient = !saved.status || saved.status >= 500 || saved.status === 429 || /fetch failed|network|timeout/i.test(saved.error.message);
    if (!transient || attempt === 1) break;
    // Retry only the idempotent save. Never repeat paid research because a database write failed.
  }
  throw new ComparisonResearchError("We couldn't save this update just now. Your previous research is still available.", 503, true);
}
