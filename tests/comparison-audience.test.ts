import assert from "node:assert/strict";
import test from "node:test";
import { buildAudienceTask, verifyAudienceAnalysis } from "../lib/comparison-audience";
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

test("a segment may cite more than four supplied facts without losing the whole answer", () => {
  const facts = Array.from({length: 7}, (_, id) => ({text: `Offering ${id}`, quote: `Original fact ${id}`}));
  const richer = {...profile, positioning: facts[0], capabilities: facts.slice(1)};
  const analysis = verifyAudienceAnalysis({segments:[{label:"People furnishing homes",reasoning:"The company offers furniture and home goods.",evidence_ids:[0,1,3,4,5]}]}, richer);
  assert.equal(analysis.segments[0].evidence.length, 5);
  assert.equal(analysis.segments[0].evidence[4].quote, "Original fact 5");
});
test("a malformed segment does not discard another independently supported segment", () => {
  const result = verifyAudienceAnalysis({segments:[{label:null}, {label:"Home furnishers",reasoning:"Furniture for homes",evidence_ids:[0]}]},profile);
  assert.equal(result.segments.length,1);
  assert.throws(()=>verifyAudienceAnalysis({segments:[{label:"Invented",reasoning:"Guess",evidence_ids:[900]}]},profile));
  assert.deepEqual(verifyAudienceAnalysis({segments:[]},profile).segments,[]);
});

test("large audience inputs fit the provider task limit and omitted facts cannot be cited",()=>{
 const rich = {...profile, capabilities: Array.from({length:30},(_,id)=>({text:`Capability ${id} `+"x".repeat(600),quote:"Original evidence"}))};
 const prompt=buildAudienceTask("Example",rich);
 assert.ok(prompt.task.length<=2000);
 assert.ok(prompt.evidence.length>0);
 assert.ok(prompt.evidence.length<31);
 assert.throws(()=>verifyAudienceAnalysis({segments:[{label:"Guess",reasoning:"Guess",evidence_ids:[30]}]},rich,prompt.evidence));
});
