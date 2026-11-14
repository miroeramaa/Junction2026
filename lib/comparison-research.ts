import { z } from "zod";
import { captureComparisonPage } from "./context";
import { ComparisonResearchError } from "./comparison-error";
import { comparisonLocale, safeSourceUrl, type ComparisonFact, type ComparisonProfile } from "./comparison";

const fact = z.object({ text: z.string().trim().min(1).max(1000), quote: z.string().trim().min(3).max(4000) });
const extractedProfile = z.object({
  positioning: z.unknown().optional(),
  target_customers: z.unknown().optional(),
  capabilities: z.unknown().optional(),
  pricing_model: z.unknown().optional(),
});

const factSchema = {
  type: "object",
  properties: {
    text: { type: "string", minLength: 1, maxLength: 300, description: "Short factual description, at most one sentence." },
    quote: { type: "string", minLength: 3, maxLength: 700, description: "Short contiguous verbatim passage from the page or its title/description that directly supports the description. Preserve original language." },
  },
  required: ["text", "quote"],
};
const schema = {
  type: "object",
  properties: {
    positioning: { anyOf: [factSchema, { type: "null" }], description: "How the company describes its product and primary value proposition. Not a comparative judgment." },
    target_customers: { type: "array", items: factSchema, maxItems: 4, description: "Only customer types, roles or industries explicitly named on this page. Empty if not stated." },
    capabilities: { type: "array", items: factSchema, maxItems: 5, description: "Specific product capabilities explicitly described on this page. Empty if not stated." },
    pricing_model: { anyOf: [factSchema, { type: "null" }], description: "Explicitly stated pricing model: for example per-seat subscription, usage-based billing, free/open source or contact sales. Null if not stated." },
  },
  required: ["positioning", "target_customers", "capabilities", "pricing_model"],
};

const normalize = (text: string) => text.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();

/** Compare visible text, ignoring presentation syntax, never paraphrases or missing words. */
export function comparisonEvidenceText(text: string): string {
  return normalize(text
    .replace(/!?\[([^\]]*)\]\((?:\\.|[^\\)])*\)/g, "$1")
    .replace(/\\([\\`*{}_\[\]()#+.!>~-])/g, "$1")
    .replace(/&(?:amp|quot|apos|nbsp|lt|gt);/g, (entity) => ({ "&amp;": "&", "&quot;": '"', "&apos;": "'", "&nbsp;": " ", "&lt;": "<", "&gt;": ">" })[entity]!)
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (entity, code: string) => {
      const value = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code);
      return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : entity;
    })
    .replace(/[*`]/g, "")
    .replace(/(^|\s)_{1,2}(.+?)_{1,2}(?=\s|$|[.,;:!?])/g, "$1$2")
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/^\s{0,3}#{1,6}\s+/gm, ""));
}

/** A fact without a supporting passage in the captured Markdown stays unknown. */
export function verifyProfileFacts(raw: unknown, markdown: string) {
  const parsed = extractedProfile.parse(raw);
  const source = comparisonEvidenceText(markdown);
  const supported = (raw: unknown): ComparisonFact | null => {
    const result = fact.safeParse(raw);
    if (!result.success || !/[\p{L}\p{N}]/u.test(result.data.quote)) return null;
    return source.includes(comparisonEvidenceText(result.data.quote)) ? result.data : null;
  };
  const unique = (items: unknown, limit: number) => {
    const seen = new Set<string>();
    return (Array.isArray(items) ? items : []).slice(0, 50).flatMap((raw) => {
      const item = supported(raw);
      if (!item || seen.has(normalize(item.text))) return [];
      seen.add(normalize(item.text));
      return [item];
    }).slice(0, limit);
  };
  return {
    positioning: supported(parsed.positioning),
    target_customers: unique(parsed.target_customers, 4),
    capabilities: unique(parsed.capabilities, 5),
    pricing_model: supported(parsed.pricing_model),
  };
}

/** One useful link actually present on the homepage, restricted to the company's own host family. */
export function comparisonFollowupUrl(homepage: string, markdown: string, needsAudience: boolean): string | undefined {
  const home = new URL(homepage);
  const host = home.hostname.replace(/^www\./, "");
  const candidates: { url: string; score: number }[] = [];
  for (const match of markdown.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)[^)]*\)/g)) {
    try {
      const url = new URL(match[2], homepage);
      const text = `${match[1]} ${url.pathname}`.toLowerCase();
      if (!safeSourceUrl(url.href) || !(url.hostname === host || url.hostname.endsWith(`.${host}`)) || url.pathname === "/") continue;
      if (/login|signin|sign-in|signup|sign-up|checkout|cart|privacy|terms|careers|jobs|apply|application/.test(text)) continue;
      const audience = /trade.program|for.professionals|business.program|who.we.serve|our.customers|industries|solutions.for|business.customers/.test(text);
      const about = /about.us|about.the|about\/|\/about$|our.company|who.we.are|our.story|unternehmen|uber.uns|über.uns/.test(text);
      const services = /our.services|design.services|interior.design/.test(text);
      const score = audience && needsAudience ? 3 : about ? 2 : services ? 1 : 0;
      if (score) { url.hash = ""; candidates.push({ url: url.href, score }); }
    } catch { /* Ignore malformed links rather than guessing a URL. */ }
  }
  return candidates.sort((a, b) => b.score - a.score)[0]?.url;
}

export async function researchComparisonProfile(url: string, requestedLocale = "en"): Promise<ComparisonProfile> {
  const locale = comparisonLocale(requestedLocale);
  const captured = await captureComparisonPage(url, schema, locale);
  let facts: ReturnType<typeof verifyProfileFacts>;
  try {
    facts = verifyProfileFacts(captured.data, captured.evidence);
  } catch {
    throw new ComparisonResearchError("The extracted profile did not match the expected format. Existing facts were kept; try this competitor later.");
  }
  const stamp = (facts: ReturnType<typeof verifyProfileFacts>, source: string, at: string) => {
    const addSource = (item: ComparisonFact): ComparisonFact => ({ ...item, source_url: source, captured_at: at });
    return { positioning: facts.positioning && addSource(facts.positioning), target_customers: facts.target_customers.map(addSource), capabilities: facts.capabilities.map(addSource), pricing_model: facts.pricing_model && addSource(facts.pricing_model) };
  };
  facts = stamp(facts, url, captured.captured_at);
  const pages = [{ url, captured_at: captured.captured_at }];
  const warnings: string[] = [];
  const followup = (!facts.positioning || !facts.target_customers.length || !facts.capabilities.length)
    ? comparisonFollowupUrl(url, captured.markdown, !facts.target_customers.length) : undefined;
  if (followup) {
    try {
      const extra = await captureComparisonPage(followup, schema, locale);
      const extraFacts = stamp(verifyProfileFacts(extra.data, extra.evidence), followup, extra.captured_at);
      // Fill missing sections only: re-extracting an existing section tends to add paraphrased duplicates.
      facts = { positioning: facts.positioning ?? extraFacts.positioning, target_customers: facts.target_customers.length ? facts.target_customers : extraFacts.target_customers, capabilities: facts.capabilities.length ? facts.capabilities : extraFacts.capabilities, pricing_model: facts.pricing_model ?? extraFacts.pricing_model };
      pages.push({ url: followup, captured_at: extra.captured_at });
    } catch (error) {
      // A broken secondary page must not discard usable homepage facts; account errors still stop the queue.
      if (error instanceof ComparisonResearchError && error.stopQueue) throw error;
      warnings.push("The additional company page could not be verified. This profile uses the homepage evidence only.");
    }
  }
  if (!facts.positioning && !facts.target_customers.length && !facts.capabilities.length && !facts.pricing_model) {
    throw new ComparisonResearchError("The page returned no verifiable comparison facts. It may be a regional selector, access wall or sparse homepage. Existing facts were kept.");
  }
  return {
    version: 1,
    source_url: url,
    captured_at: captured.captured_at,
    locale,
    pages,
    warnings,
    ...facts,
  };
}
