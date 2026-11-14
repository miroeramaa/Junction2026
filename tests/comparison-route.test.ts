import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../app/api/workspaces/[id]/comparison/route";
import type { ComparisonProfile } from "../lib/comparison";

// Real route + real Supabase client, with every HTTP request intercepted locally.
// These checks never load .env, contact a service, change the real database or spend credits.
test("comparison research route scope, storage and failure behavior", async (t) => {
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", () => {}); // Expected failure cases still assert their response and write behavior.
  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const competitorId = "22222222-2222-4222-8222-222222222222";
  const keys = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "CONTEXT_DEV_API_KEY"];
  const originalEnv = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://database.example.com";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-service-key";
  process.env.CONTEXT_DEV_API_KEY = "test-only-context-key";
  const originalFetch = globalThis.fetch;
  let missingSchema = false;
  let wrongWorkspace = false;
  let extractionFails = false;
  let upstreamStatus = 200;
  let transportFails = false;
  let saveFails = false;
  let failNextSave = false;
  let raceOnSave = false;
  let paidCalls = 0;
  let writes = 0;
  let savedProfile: ComparisonProfile | undefined;
  let instructions = "";
  let fixtureMode = "normal";
  let cardBaseline: ComparisonProfile | null = null;
  let analysisCalls = 0;
  let malformedAudience = false;
  let followupFails = false;
  const scrapedUrls: string[] = [];

  globalThis.fetch = async (input, options) => {
    const request = input instanceof Request ? input : new Request(input, options);
    const url = new URL(request.url);
    if (url.hostname === "database.example.com" && url.pathname === "/rest/v1/competitors") {
      assert.equal(url.searchParams.get("workspace_id"), `eq.${workspaceId}`);
      assert.equal(url.searchParams.get("id"), `eq.${competitorId}`);
      return Response.json(wrongWorkspace ? [] : [{ id: competitorId, homepage_url: "https://company.example.com", domain: "company.example.com" }]);
    }
    if (url.hostname === "database.example.com" && url.pathname === "/rest/v1/battlecards") {
      if (request.method === "PATCH") {
        writes++;
        savedProfile = (await request.json()).comparison_profile;
        if (failNextSave) { failNextSave = false; return Response.json({ message: "Temporary database outage" }, { status: 503 }); }
        if (raceOnSave) return Response.json([]);
        return saveFails ? Response.json({ message: "Save failed" }, { status: 500 }) : Response.json([{ competitor_id: competitorId }]);
      }
      return missingSchema ? Response.json({ code: "42703", message: "Column does not exist" }, { status: 400 }) : Response.json([{ comparison_profile: cardBaseline }]);
    }
    if (url.href === "https://api.context.dev/v1/web/answers") {
      analysisCalls++;
      if (malformedAudience) return Response.json({json_content:{segments:[{label:"Invalid",reasoning:"No supplied evidence",evidence_ids:[999]}]}});
      return Response.json({ json_content: { segments: [{ label: "Research teams", reasoning: "The product provides tools for research teams.", evidence_ids: [0] }] }, sources: [] });
    }
    if (url.href === "https://api.context.dev/v1/web/scrape") {
      paidCalls++;
      const body = await request.json();
      scrapedUrls.push(body.url);
      assert.equal(body.maxAgeMs, 0);
      assert.deepEqual(body.formats, { markdown: true, json: true });
      instructions = body.jsonParams.instructions;
      if (transportFails) throw new TypeError("fetch failed");
      if (upstreamStatus !== 200) return Response.json({ error: "Private upstream details" }, { status: upstreamStatus });
      if (fixtureMode === "metadata") return Response.json({ json: { success: true, data: { positioning: { text: "Metadata positioning", quote: "Tools for research teams." } } }, markdown: { success: true, data: "# Products\nBrowse our tools." }, metadata: { description: "Tools for research teams." } });
      if (fixtureMode === "empty") return Response.json({ json: { success: true, data: {} }, markdown: { success: true, data: "Select your region" } });
      if (body.url.endsWith("/trade-program")) return Response.json({ json: { success: true, data: { positioning: { text: "Another positioning", quote: "Made for professional designers." }, target_customers: [{ text: "Designers", quote: "Made for professional designers." }] } }, markdown: { success: !followupFails, error_code: followupFails ? "WEBSITE_BLOCKED" : undefined, data: "Made for professional designers." } });
      return Response.json({
        json: { success: !extractionFails, error_code: extractionFails ? "WEBSITE_BLOCKED" : undefined, data: { positioning: { text: "Research tools", quote: "Tools for research teams." }, target_customers: [], capabilities: [] } },
        markdown: { success: true, data: "# Company\nTools for research teams." + (fixtureMode === "followup" ? "\n[Trade Program](/trade-program)" : "") },
      });
    }
    throw new Error(`Unexpected network request in test: ${url.origin}${url.pathname}`);
  };
  const request = (body: unknown = { competitorId }) => POST(new Request("http://localhost/api/workspaces/test/comparison", {
    method: "POST", headers: { "Content-Type": "application/json",  }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: workspaceId }) });

  try {
    await t.test("malformed input is rejected before lookup", async () => {
      assert.equal((await request({ competitorId: "not-an-id" })).status, 400);
      assert.equal(paidCalls, 0);
    });
    await t.test("a competitor from another workspace cannot be researched", async () => {
      wrongWorkspace = true;
      assert.equal((await request()).status, 404);
      wrongWorkspace = false;
      assert.equal(paidCalls, 0);
    });
    await t.test("missing migration fails before spending any credits", async () => {
      missingSchema = true;
      assert.equal((await request()).status, 503);
      missingSchema = false;
      assert.equal(paidCalls, 0);
      assert.equal(writes, 0);
    });
    await t.test("successful research saves verified facts and source metadata", async () => {
      const response = await request();
      assert.equal(response.status, 200);
      assert.equal(paidCalls, 1);
      assert.equal(writes, 1);
      assert.equal(savedProfile?.positioning?.text, "Research tools");
      assert.equal(savedProfile?.source_url, "https://company.example.com/");
      assert.ok(Number.isFinite(Date.parse(savedProfile!.captured_at)));
    });
    await t.test("extraction failure does not overwrite the saved baseline", async () => {
      extractionFails = true;
      const response = await request();
      assert.equal(response.status, 502);
      const body = await response.json();
      assert.match(body.error, /blocked automated access/);
      assert.equal(body.stopQueue, false);
      extractionFails = false;
      assert.equal(writes, 1);
    });
    await t.test("database save failure is not reported as a saved profile", async () => {
      saveFails = true;
      const response = await request();
      assert.equal(response.status, 503);
      const body = await response.json();
      assert.match(body.error, /couldn't save/);
      assert.equal(body.stopQueue, true);
      saveFails = false;
    });
    await t.test("account and malformed-request failures stop research without exposing upstream details", async () => {
      for (const status of [400, 401, 402, 403]) {
        upstreamStatus = status;
        const response = await request();
        assert.equal(response.status, 503);
        const body = await response.json();
        assert.equal(body.stopQueue, true);
        assert.doesNotMatch(body.error, /Private upstream details/);
      }
      upstreamStatus = 200;
    });
    await t.test("unreachable upstream stops the queue rather than failing every competitor", async () => {
      transportFails = true;
      const response = await request();
      assert.equal(response.status, 503);
      assert.equal((await response.json()).stopQueue, true);
      transportFails = false;
    });
    await t.test("requested browser locale reaches extraction and is saved with the profile", async () => {
      const response = await request({ competitorId, locale: "fi-fi" });
      assert.equal(response.status, 200);
      assert.equal(savedProfile?.locale, "fi-FI");
      assert.match(instructions, /BCP 47 tag fi-FI/);
      assert.match(instructions, /never translate quotes/);
    });
    await t.test("metadata-backed facts are checked against captured metadata", async () => {
      fixtureMode = "metadata";
      assert.equal((await request()).status, 200);
      assert.equal(savedProfile?.positioning?.text, "Metadata positioning");
      fixtureMode = "normal";
    });
    await t.test("one linked company page fills missing audiences with its own source", async () => {
      fixtureMode = "followup";
      const before = paidCalls;
      assert.equal((await request()).status, 200);
      assert.equal(paidCalls - before, 2);
      assert.equal(savedProfile?.target_customers[0].source_url, "https://company.example.com/trade-program");
      assert.equal(savedProfile?.pages?.length, 2);
      assert.equal(savedProfile?.positioning?.text, "Research tools");
      assert.deepEqual(scrapedUrls.slice(-2), ["https://company.example.com/", "https://company.example.com/trade-program"]);
      fixtureMode = "normal";
    });
    await t.test("a blocked follow-up preserves useful homepage facts and records the coverage gap", async () => {
      fixtureMode = "followup";
      followupFails = true;
      assert.equal((await request()).status, 200);
      assert.equal(savedProfile?.positioning?.text, "Research tools");
      assert.equal(savedProfile?.pages?.length, 1);
      assert.equal(savedProfile?.warnings?.length, 1);
      followupFails = false;
      fixtureMode = "normal";
    });
    await t.test("empty successful API outputs never overwrite an existing useful baseline", async () => {
      fixtureMode = "empty";
      const before = writes;
      const response = await request();
      assert.equal(response.status, 502);
      assert.match((await response.json()).error, /no verifiable comparison facts/);
      assert.equal(writes, before);
      fixtureMode = "normal";
    });
    await t.test("audience-only enrichment reuses saved research without any scrape calls", async () => {
      cardBaseline = { version: 1, captured_at: "2026-11-14T12:00:00Z", source_url: "https://company.example.com/", positioning: { text: "Research tools", quote: "Tools for research teams." }, capabilities: [], target_customers: [] };
      const beforeScrapes = paidCalls;
      const beforeAnalysis = analysisCalls;
      assert.equal((await request({ competitorId, action: "audience" })).status, 200);
      assert.equal(paidCalls, beforeScrapes);
      assert.equal(analysisCalls, beforeAnalysis + 1);
      assert.equal(savedProfile?.audience_analysis?.segments[0].label, "Research teams");
      assert.equal(savedProfile?.captured_at, cardBaseline.captured_at);
      cardBaseline = null;
    });
    await t.test("a transient save failure retries the write without repeating paid research", async () => {
      failNextSave = true;
      const beforeScrapes = paidCalls;
      const beforeWrites = writes;
      assert.equal((await request()).status, 200);
      assert.equal(paidCalls - beforeScrapes, 1);
      assert.equal(writes - beforeWrites, 2);
    });
    await t.test("a missing or changed card is not reported as saved", async () => {
      raceOnSave = true;
      assert.equal((await request()).status, 409);
      raceOnSave = false;
    });
    await t.test("optional audience failure saves verified research and reports a quiet warning", async()=>{
      malformedAudience=true;
      const before=writes;
      const response=await request();
      assert.equal(response.status,200);
      const body=await response.json();
      assert.deepEqual(body.warnings,["audience_unavailable"]);
      assert.equal(writes,before+1);
      assert.equal(body.profile.positioning.text,"Research tools");
      malformedAudience=false;
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  }
});
