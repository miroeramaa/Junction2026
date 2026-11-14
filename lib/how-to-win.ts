// "How to win": Claude turns a competitor's battlecard into a short sales brief.
// Regenerated whenever the competitor changes something (lib/pipeline.ts) and after onboarding.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { db, must } from "./db";
import type { Battlecard, Competitor, EventRow, Workspace } from "./types";

export const HowToWinSchema = z.object({
  headline: z.string().describe("One sentence under 25 words: where this competitor stands and what changed most recently."),
  say_this: z
    .array(z.string())
    .describe("2–3 talk tracks for a sales rep, each under 30 words and tied to one specific fact, e.g. 'They raised Pro to $79: ...'."),
  watch_out: z.array(z.string()).describe("1–2 places where this competitor is strong or a deal is at risk, each under 30 words."),
});
export type HowToWin = z.infer<typeof HowToWinSchema> & { generated_at: string };

const SYSTEM = `You write competitive battlecards for a B2B sales team.
You get live data about one competitor: its current pricing, recent changes detected on its website, new pages, press coverage, hiring and homepage messaging.
Write a brief a sales rep can use on a call today.
- Ground every point in the data you were given and name the specific fact (a price, a plan, a launch, a job post). Don't invent facts.
- You don't know our own prices, so never state them; compare on what the data shows about the competitor.
- Prefer recent changes over old ones. If little has changed, say what their pricing and positioning imply.
- Plain, direct sentences a rep can say out loud. Short beats complete. No marketing language, no headings, no markdown.`;

let client: Anthropic | null = null;

export async function generateHowToWin(competitorId: string): Promise<HowToWin | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null; // feature off until a key is configured
  client ??= new Anthropic();

  const competitor = must(await db().from("competitors").select("*").eq("id", competitorId).single()) as Competitor;
  const workspace = must(await db().from("workspaces").select("*").eq("id", competitor.workspace_id).single()) as Workspace;
  const card = must(await db().from("battlecards").select("*").eq("competitor_id", competitorId).single()) as Battlecard;
  const events = must(
    await db()
      .from("events")
      .select("signal, title, summary, detected_at")
      .eq("competitor_id", competitorId)
      .order("received_at", { ascending: false })
      .limit(15),
  ) as Pick<EventRow, "signal" | "title" | "summary" | "detected_at">[];

  const data = {
    our_company: { name: workspace.name, what_we_do: workspace.description },
    competitor: { name: competitor.name, domain: competitor.domain, why_they_compete: competitor.why },
    pricing_now: card.pricing?.plans ?? "not found",
    recent_changes: events,
    new_pages: card.launches,
    press: card.news,
    hiring: card.hiring,
    homepage_messaging_change: card.positioning,
    today: new Date().toISOString().slice(0, 10),
  };

  const response = await client.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    output_config: { effort: "medium", format: betaZodOutputFormat(HowToWinSchema) },
    // If the model declines, Anthropic re-runs the request on a fallback model within the same call.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    messages: [{ role: "user", content: `Battlecard data as JSON:\n${JSON.stringify(data, null, 2)}` }],
  });

  if (response.stop_reason === "refusal" || !response.parsed_output) return null;
  return { ...response.parsed_output, generated_at: new Date().toISOString() };
}

/** Generates and stores the brief. Never throws: a missing brief must not break the change pipeline. */
export async function refreshHowToWin(competitorId: string): Promise<boolean> {
  try {
    const brief = await generateHowToWin(competitorId);
    if (!brief) return false;
    must(await db().from("battlecards").update({ how_to_win: JSON.stringify(brief) }).eq("competitor_id", competitorId));
    return true;
  } catch (e) {
    console.error("refreshHowToWin", competitorId, e);
    return false;
  }
}
