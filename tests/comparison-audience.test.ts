import assert from "node:assert/strict";
import test from "node:test";
import { verifyAudienceAnalysis } from "../lib/comparison-audience";
import { databaseSafeProfile } from "../lib/comparison-save";
import type { ComparisonProfile } from "../lib/comparison";

const profile: ComparisonProfile = { version: 1, source_url: "https://example.com", captured_at: "2026-11-14T12:00:00Z", positioning: { text: "Sells furniture", quote: "Furniture for your home" }, capabilities: [], target_customers: [] };
test("audience estimates retain their reasoning and only refer to supplied evidence", () => {
  const analysis = verifyAudienceAnalysis({ segments: [{ label: "People furnishing homes", reasoning: "The company sells home furniture.", evidence_ids: [0, 0] }, { label: "Unsupported", reasoning: "A model guess", evidence_ids: [99] }] }, profile);
  assert.equal(analysis.segments.length, 1);
  assert.equal(analysis.segments[0].evidence.length, 1);
  assert.equal(analysis.segments[0].evidence[0].quote, profile.positioning?.quote);
  assert.equal(analysis.basis_captured_at, profile.captured_at);
});
test("unstructured audience answers are rejected", () => {
  assert.throws(() => verifyAudienceAnalysis({ segments: "everyone" }, profile));
});
test("scraped strings are safe for PostgreSQL JSONB without destroying Japanese text", () => {
  const safe = databaseSafeProfile({ ...profile, positioning: { text: "家具\u0000 services", quote: "Original \ud800 text" } });
  assert.equal(safe.positioning?.text, "家具 services");
  assert.equal(safe.positioning?.quote, "Original � text");
  assert.equal(profile.positioning?.text, "Sells furniture");
});
