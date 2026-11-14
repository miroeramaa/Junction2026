import { z } from "zod";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { researchComparisonProfile } from "@/lib/comparison-research";
import { comparisonLocale, safeSourceUrl } from "@/lib/comparison";
import { ComparisonResearchError } from "@/lib/comparison-error";
import { analyzeAudience } from "@/lib/comparison-audience";
import { saveComparisonProfile } from "@/lib/comparison-save";
import type { ComparisonProfile } from "@/lib/comparison";

export const maxDuration = 180;
const input = z.object({ competitorId: z.string().uuid(), locale: z.string().max(80).optional(), action: z.enum(["research", "audience"]).default("research") });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { id } = await params;
  const body = input.safeParse(await req.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !body.success) {
    return Response.json({ error: "A valid workspace and competitor are required." }, { status: 400 });
  }
  const { data: competitor, error } = await db().from("competitors")
    .select("id, name, homepage_url, domain").eq("id", body.data.competitorId).eq("workspace_id", id).maybeSingle();
  if (error) return Response.json({ error: "Could not load this competitor." }, { status: 500 });
  if (!competitor) return Response.json({ error: "Competitor not found in this workspace." }, { status: 404 });

  // Detect an unapplied migration before making a paid request. Do not recreate missing battlecards.
  const card = await db().from("battlecards").select("comparison_profile").eq("competitor_id", competitor.id).maybeSingle();
  if (card.error) return Response.json({ error: "Comparison storage needs to be set up by an administrator. No research credits were used." }, { status: 503 });
  if (!card.data) return Response.json({ error: "This competitor's battlecard is not ready yet." }, { status: 409 });
  const url = safeSourceUrl(competitor.homepage_url ?? `https://${competitor.domain}`);
  if (!url) return Response.json({ error: "This competitor does not have a valid homepage URL." }, { status: 422 });

  try {
    const locale = comparisonLocale(body.data.locale ?? req.headers.get("accept-language")?.split(/[,;]/)[0]?.trim());
    if (body.data.action === "audience") {
      const previous = card.data.comparison_profile as ComparisonProfile | null;
      if (!previous?.captured_at) return Response.json({ error: "Research this company first." }, { status: 409 });
      const analysis = await analyzeAudience(competitor.name ?? competitor.domain, { ...previous, locale });
      const profile = await saveComparisonProfile(competitor.id, { ...previous, audience_analysis: analysis }, previous.captured_at);
      return Response.json({ profile });
    }
    const researched = await researchComparisonProfile(url, locale);
    if (!researched.target_customers.length) {
      try {
        researched.audience_analysis = await analyzeAudience(competitor.name ?? competitor.domain, researched);
      } catch (error) {
        // AI interpretation is optional: a provider outage must not discard verified research.
        console.error("comparison audience unavailable", competitor.id, error);
      }
    }
    const profile = await saveComparisonProfile(competitor.id, researched);
    return Response.json({ profile });
  } catch (error) {
    console.error("comparison research", competitor.id, error);
    if (error instanceof ComparisonResearchError) {
      return Response.json({ error: error.message, stopQueue: error.stopQueue }, { status: error.status });
    }
    return Response.json({
      error: "We couldn't finish this update just now. Your saved research is unchanged.",
      stopQueue: true,
    }, { status: 500 });
  }
}
