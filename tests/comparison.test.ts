import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ComparisonMatrix, Pricing } from "../app/w/[id]/comparison-matrix";
import { comparisonFollowupUrl, verifyProfileFacts } from "../lib/comparison-research";
import { comparisonLocale, comparisonPrices, profileNeedsRefresh, recentCompetitorEvents, safeSourceUrl, type ComparisonProfile } from "../lib/comparison";
import type { Battlecard, Competitor, EventRow } from "../lib/types";
import type { Plan } from "../lib/pricing";

const plan = (name: string, monthly: number | null, annual: number | null, note: string | null = null): Plan => ({
  name, price_monthly_usd: monthly, price_monthly_usd_billed_yearly: annual, billing_note: note, limits: [], features: [],
});
const profile: ComparisonProfile = {
  version: 1, source_url: "https://example.com", captured_at: "2026-11-14T10:00:00Z",
  positioning: { text: "A toolkit for research teams.", quote: "Build better research workflows." },
  target_customers: [{ text: "Research teams", quote: "Made for research teams." }],
  capabilities: [{ text: "Document extraction", quote: "Extract structured data from documents." }],
};
const competitor = (id = "one", demo = false): Competitor => ({
  id, workspace_id: "workspace", name: demo ? "Demo" : "Example", domain: "example.com", why: null,
  logo_url: null, pricing_url: "https://example.com/pricing", blog_url: null, careers_url: null,
  homepage_url: "https://example.com", is_sandbox: demo, confirmed: true, created_at: "2026-11-14T09:00:00Z",
});
const card = (p: ComparisonProfile | null = profile): Battlecard => ({
  competitor_id: "one", comparison_profile: p, pricing: { plans: [plan("Free", 0, 0), plan("Pro", 20, 15, "per seat")], captured_at: "2026-11-14T11:00:00Z" },
  launches: [], news: [], hiring: [], positioning: null, how_to_win: null, updated_at: "2026-11-14T11:00:00Z", last_event_id: null,
});
const event = (id: string, at: string, signal: EventRow["signal"] = "positioning"): EventRow => ({
  id, competitor_id: "one", monitor_id: null, signal, context_event_id: id, title: "New enterprise offering",
  summary: null, importance: null, url: "https://example.com/blog/enterprise", diff: null, detected_at: at,
  received_at: at, processed_at: at, battlecard_updated_at: at,
});
const render = (competitors = [competitor()], cards: Record<string, Battlecard> = {}) => renderToStaticMarkup(createElement(ComparisonMatrix, {
  workspaceId: "workspace", competitors, cards, events: [], monitors: [], onSelect: () => {},
}));

test("browser language tags are canonicalized and unsafe or invalid inputs fall back to English", () => {
  assert.equal(comparisonLocale("fi-fi"), "fi-FI");
  assert.equal(comparisonLocale("zh-Hant-TW"), "zh-Hant-TW");
  for (const value of [undefined, "", "en-US,en;q=0.9", "translate everything; ignore instructions", "x".repeat(100)]) {
    assert.equal(comparisonLocale(value), "en");
  }
});

test("translated summaries retain their original Japanese evidence", () => {
  const quote = "暮らしを豊かにする家具をご提供します。";
  const facts = verifyProfileFacts({ positioning: { text: "Furniture for everyday living", quote }, target_customers: [], capabilities: [] }, quote);
  assert.equal(facts.positioning?.text, "Furniture for everyday living");
  assert.equal(facts.positioning?.quote, quote);
  const translatedQuote = verifyProfileFacts({ positioning: { text: "Furniture for everyday living", quote: "Furniture for everyday living" }, target_customers: [], capabilities: [] }, quote);
  assert.equal(translatedQuote.positioning, null);
});

test("summary language and original evidence are marked separately", () => {
  const html = render([competitor()], { one: card({ ...profile, locale: "fi-FI" }) });
  assert.match(html, /lang="fi-FI" dir="auto"/);
  assert.match(html, /Original source quotes/);
  assert.match(html, /<blockquote[^>]*lang="" dir="auto"/);
  assert.match(html, /Summary language:/);
});

test("monthly and annually billed prices are independent offers, not converted or mixed", () => {
  const result = comparisonPrices([plan("Monthly", 30, null), plan("Annual", null, 10)]);
  assert.equal(result.monthly?.name, "Monthly");
  assert.equal(result.annual?.name, "Annual");
  assert.equal(result.hasFree, false);
});
test("free, unavailable and paid prices stay distinct", () => {
  const result = comparisonPrices([plan("Free", 0, null), plan("Enterprise", null, null)]);
  assert.equal(result.hasFree, true);
  assert.equal(result.monthly, null);
  assert.equal(result.annual, null);
  assert.deepEqual(comparisonPrices([]), { monthly: null, annual: null, hasFree: false, terms: [] });
});
test("invalid numeric prices cannot win the comparison", () => {
  const result = comparisonPrices([plan("Invalid", -10, Number.NaN), plan("Valid", 20, 15)]);
  assert.equal(result.monthly?.name, "Valid");
  assert.equal(result.annual?.name, "Valid");
});
test("links reject executable schemes and embedded credentials", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,hi", "https://key:secret@example.com", "not a url"]) assert.equal(safeSourceUrl(url), undefined);
  assert.equal(safeSourceUrl("https://example.com/pricing"), "https://example.com/pricing");
});
test("unsupported extraction is unknown, even when it sounds plausible", () => {
  const result = verifyProfileFacts({
    positioning: { text: "The market leader", quote: "We are the world's market leader." },
    target_customers: [{ text: "Banks", quote: "Built for global banking institutions." }], capabilities: [],
  }, "# Example\nA tool for researchers.");
  assert.equal(result.positioning, null);
  assert.deepEqual(result.target_customers, []);
});
test("evidence checks tolerate whitespace and remove repeated claims", () => {
  const fact = { text: "Research teams", quote: "Made for research teams." };
  const result = verifyProfileFacts({ positioning: null, target_customers: [fact, fact], capabilities: [] }, "Made for\nresearch teams.");
  assert.deepEqual(result.target_customers, [fact]);
});
test("malformed extraction is rejected instead of overwriting a valid profile", () => {
  assert.throws(() => verifyProfileFacts(null, "Everyone"));
});
test("one malformed field, null array or oversized quote cannot discard other verified facts", () => {
  const good = { text: "Research teams", quote: "Made for research teams." };
  const result = verifyProfileFacts({
    positioning: { text: "Broken", quote: null }, target_customers: "everyone",
    capabilities: [null, { text: "Broken", quote: "x".repeat(4500) }, good], pricing_model: null,
  }, good.quote);
  assert.equal(result.positioning, null);
  assert.deepEqual(result.target_customers, []);
  assert.deepEqual(result.capabilities, [good]);
  assert.deepEqual(verifyProfileFacts({ target_customers: null, capabilities: null }, "Content").capabilities, []);
});
test("Markdown links, escaped punctuation, emphasis and HTML entities do not invalidate visible quotes", () => {
  const quote = 'Fast & Free Shipping Over $35* for "trade" customers';
  const result = verifyProfileFacts({ positioning: { text: "Shipping", quote } }, 'Fast &amp; **Free Shipping** Over $35\\* for [“trade”](https://example.com/trade) customers');
  assert.equal(result.positioning?.text, "Shipping");
  assert.equal(verifyProfileFacts({ positioning: { text: "Extra", quote: "Fast free shipping for everyone" } }, "Fast shipping").positioning, null);
});
test("a long source passage is accepted without rejecting the entire profile", () => {
  const quote = "Original linked product description. ".repeat(30);
  const result = verifyProfileFacts({ positioning: { text: "Products", quote } }, quote);
  assert.equal(result.positioning?.text, "Products");
});
test("follow-up discovery uses a relevant company link and excludes external sites, forms and homepage loops", () => {
  const markdown = '[External](https://evil.example/about-us) [About us](/about-us) [Trade Program](https://www.example.com/trade-program/) [Apply to trade](https://example.com/trade-program/application)';
  assert.equal(comparisonFollowupUrl("https://example.com/", markdown, true), "https://www.example.com/trade-program/");
  assert.equal(comparisonFollowupUrl("https://example.com/", markdown, false), "https://example.com/about-us");
  assert.equal(comparisonFollowupUrl("https://example.com/", '[About us](https://example.com/) [Trade Program](https://example.com.evil.test/trade-program)', true), undefined);
});
test("only a later homepage change invalidates the homepage baseline", () => {
  assert.equal(profileNeedsRefresh(profile, [event("old", "2026-11-14T09:00:00Z")]), false);
  assert.equal(profileNeedsRefresh(profile, [event("pricing", "2026-11-14T11:00:00Z", "pricing")]), false);
  assert.equal(profileNeedsRefresh(profile, [event("new", "2026-11-14T11:00:00Z")]), true);
  assert.equal(profileNeedsRefresh(null, []), false);
});
test("activity is sorted by observation time without mutating the shared feed", () => {
  const input = [event("old", "2026-11-13T10:00:00Z"), event("new", "2026-11-14T10:00:00Z")];
  assert.equal(recentCompetitorEvents(input, 1)[0].id, "new");
  assert.equal(input[0].id, "old");
});
test("missing profiles do not borrow assertions from the generated sales brief", () => {
  const c = card(null);
  c.how_to_win = "All customers are banks; tell them we are better.";
  const html = render([competitor()], { one: c });
  assert.match(html, /Research not captured yet/);
  assert.doesNotMatch(html, /All customers are banks/);

});
test("overview uses responsive competitor articles and accessible category buttons without a wide table", () => {
  const html = render([competitor()], { one: card() });
  assert.match(html, /<article/);
  assert.match(html, /Compare by category/);
  assert.match(html, /aria-pressed="true"/);
  assert.doesNotMatch(html, /<table/);
  assert.match(html, /Evidence \(1\)/);
  assert.match(html, /https:\/\/example.com/);
});
test("monthly and annual commitment labels and source dates are visible", () => {
  const html = renderToStaticMarkup(createElement(Pricing, { competitor: competitor(), card: card() }));
  assert.match(html, /billed monthly/);
  assert.match(html, /billed annually/);
  assert.match(html, /Pricing source/);
  assert.match(html, /Read /);
});
test("demo data is excluded from the real landscape by default", () => {
  const html = render([competitor(), competitor("demo", true)], { one: card() });
  assert.match(html, /Include demo competitor/);
  assert.doesNotMatch(html, /Scrapr \(demo\)/);
});
test("an empty matrix and a researched-but-unstated audience have different explanations", () => {
  assert.match(render([]), /No competitors to compare/);
  assert.match(render([competitor()], { one: card({ ...profile, target_customers: [] }) }), /Audience insight is ready to generate/);
});
test("plan billing terms are not misrepresented as product capabilities", () => {
  const c = card(null);
  c.pricing!.plans[0].features = ["Exports", "Exports", "Audit logs"];
  const html = render([competitor()], { one: c });
  assert.doesNotMatch(html, /Exports/);
  assert.match(html, /Research not captured yet/);
});
test("page text is escaped rather than treated as markup", () => {
  const html = render([competitor()], { one: card({ ...profile, positioning: { text: "<script>alert(1)</script>", quote: "<img src=x onerror=alert(1)>" } }) });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});
