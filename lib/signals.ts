// Conservative, explainable triage shared by the feed, briefs and digests. Raw events are never deleted.
import type { EventRow } from "./types";

export type Feedback = Partial<Record<string, "useful" | "not_useful">>;
export type SignalAssessment = { priority: "high" | "normal" | "quiet"; reason: string; duplicate_of?: string };
export type AssessedEvent = EventRow & { assessment: SignalAssessment };
const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const material = /\b(pric(?:e|es|ing)|billing|plan (?:limit|tier)|usage limit|subscription|launch(?:ed|es)?|introduc(?:e|ed|ing)|new (?:products?|features?|roles?|jobs?|offices?|stores?|plans?|tiers?)|hir(?:ing|e|es)|job (?:opening|posting)|layoff|fund(?:ing|raise)|acquir(?:e|ed|ing)|acquisition|merger|partner(?:ship)?|breach|expos(?:ure|ed)|unauthorized|security incident|outage|shut(?:down|ting)|sso|api|expan(?:d|sion)|delivery (?:fee|charge)|target (?:customer|audience)|headline|value proposition)\b/i;
const chrome = /\b(cookie (?:banner|consent)|consent (?:banner|dialog)|footer|navigation (?:menu|link)|copyright (?:year|date)|tracking (?:pixel|parameter)|analytics (?:tag|script)|layout|typograph(?:y|ic)|whitespace|formatting|carousel|testimonial|rotating (?:banner|image)|timestamp)\b/i;
const cosmetic = /\b(only|solely|minor|cosmetic|updated?|changed?|added|removed|refresh(?:ed)?|adjust(?:ed)?)\b/i;

export function assessSignal(event: EventRow, rating?: Feedback[string]): SignalAssessment {
  if (rating === "not_useful") return { priority: "quiet", reason: "Marked not useful by your team" };
  if (rating === "useful") return { priority: "high", reason: "Marked useful by your team" };
  const text = `${event.title ?? ""} ${event.summary ?? ""}`;
  const priceDiff = event.signal === "pricing" && /^[+-].*(?:[$€£¥]\s*\d|\d.*(?:USD|EUR|GBP|month|year|credits|users|seats|requests|tokens|GB))/m.test(event.diff ?? "");
  const substantive = priceDiff || material.test(text.replace(/\b(?:pricing|careers|product|home|jobs?) (?:page|website)\b/gi, "page"));
  if (!substantive && /^(?:access denied|just a moment|checking your browser|captcha|page not found)\b/i.test(event.title?.trim() ?? "")) return { priority: "quiet", reason: "Access or loading page, not a company development" };
  if (!substantive && event.signal === "launches" && event.added_urls?.length && event.added_urls.every(value => {
    try { return /(?:^\/(?:tags?|categories|category|authors?|search|cart|checkout|login|account)(?:\/|$)|\/page\/\d+(?:\/|$))/.test(new URL(value).pathname); } catch { return false; }
  })) return { priority: "quiet", reason: "Sitemap housekeeping: taxonomy, account or pagination pages" };
  if (!substantive && chrome.test(text) && cosmetic.test(text)) return { priority: "quiet", reason: "Website presentation or housekeeping" };
  if (event.signal === "launches" && event.added_urls?.length === 0 && /\b(removed|disappeared|deleted)\b/i.test(text)) return { priority: "quiet", reason: "Removed pages, not a new launch" };
  if (event.importance === "high") return { priority: "high", reason: "Reported as high importance by the source monitor" };
  if (event.importance === "low" && !substantive) return { priority: "quiet", reason: "Low-importance update without a concrete business change" };
  if (substantive) return { priority: "normal", reason: "Concrete pricing, product, hiring or business development" };
  // Unknown importance is not proof of irrelevance. Keep ambiguous signals for review.
  return { priority: "normal", reason: event.importance === "medium" ? "Reported as medium importance by the source monitor" : "Unrated change; kept for review" };
}

export function triageSignals(events: EventRow[], feedback: Feedback = {}): AssessedEvent[] {
  const seen = new Map<string, EventRow>();
  const fingerprint = (event: EventRow) => {
    const title = normalize(event.title ?? "");
    const body = normalize(`${event.summary ?? ""} ${event.diff ?? ""}`);
    return `${event.competitor_id}|${event.signal}|${title}|${event.signal === "news" && title.length >= 35 ? (body.match(/\b\d+(?: \d+)*\b/g) ?? []).join("|") : body}`;
  };
  const muted = events.filter(event=>feedback[event.id]==="not_useful");
  const weight = (event: EventRow) => ({ high: 2, normal: 1, quiet: 0 })[assessSignal(event, feedback[event.id]).priority];
  const assessed = [...events].sort((a,b) => weight(b) - weight(a) || Date.parse(a.received_at) - Date.parse(b.received_at)).map(event => {
    let assessment = assessSignal(event, feedback[event.id]);
    const headline = normalize(event.title ?? "");
    const details = normalize(`${event.summary ?? ""} ${event.diff ?? ""}`);
    // Preserve generic repeated "Pricing changed" events with different before/after values.
    const key = fingerprint(event);
    const mutedCopy = !feedback[event.id] && muted.find(other=>fingerprint(other)===key && Math.abs(Date.parse(other.received_at)-Date.parse(event.received_at))<=48*3600000);
    const other = seen.get(key);
    const age = other ? Math.abs(Date.parse(other.received_at) - Date.parse(event.received_at)) : Infinity;
    if (headline.length >= 15 && (details || headline.length >= 45) && mutedCopy) {
      assessment = { priority: "quiet", reason: "Same change as an update marked not useful by your team", duplicate_of: mutedCopy.id };
    } else if (headline.length >= 15 && (details || headline.length >= 45) && other && age <= 48 * 3600000 && !feedback[event.id]) {
      assessment = { priority: "quiet", reason: "Repeated report of the same change within 48 hours", duplicate_of: other.id };
    } else if (assessment.priority !== "quiet") seen.set(key, event);
    return { ...event, assessment };
  });
  return assessed.sort((a,b)=>Date.parse(b.received_at)-Date.parse(a.received_at));
}

export function importantSignals(events: EventRow[], feedback: Feedback = {}): AssessedEvent[] {
  return triageSignals(events, feedback).filter(event => event.assessment.priority !== "quiet")
    .sort((a,b) => Number(b.assessment.priority === "high") - Number(a.assessment.priority === "high") || Date.parse(b.received_at) - Date.parse(a.received_at));
}
