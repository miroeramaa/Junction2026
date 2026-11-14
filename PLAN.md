# Kestrel — Junction 2026 (Context.dev challenge)

> Formerly "Competitor Radar". Kestrel: a falcon that hovers in place and watches for the smallest movement.

## Pitch

Type your company name. We find your competitors and watch their **pricing, launches, press, hiring and positioning** on the live web. Every change rewrites a sales **battlecard** within seconds, so your team always knows what changed and how to win.

- **Problem:** Competitive-intelligence tools (Klue, Crayon) cost $20k+/yr and are maintained by hand, so they go stale fast.
- **Demo user:** the Context.dev team, watching Firecrawl, Exa, Tavily, Apify, Browserbase, ScrapingBee, Bright Data.
- **Deadline:** submit by **09:30** (hard deadline 10:00). Start 14:30.

## Judging criteria → how we score

| Criterion (20% each) | Our answer |
|---|---|
| Real-world impact | Battlecards are what sales/PMM teams already pay for. Demo user = the judges. |
| Creative use of live web data | 10 Context.dev features combined; Wayback history + live monitors |
| Completeness | Real onboarding for any company, not hardcoded |
| Technical execution | Semantic tripwire → schema scrape; latency counter on every event |
| Real-timeness | Monitors every 15 min / hourly, webhooks, live sandbox trigger on stage |

---

## Architecture

```
ONBOARDING
company autocomplete (Brand search)
  → Brand retrieve (description + industry → grounds discovery)
  → Answers fast (competitor names + domains, JSON)
  → Brand retrieve per competitor (logo + links.pricing/blog/careers), Map only as fallback
  → user confirms competitors
  → create monitors (5 per competitor) + start Wayback backfill

LIVE LOOP
Context.dev monitor ──webhook──► /api/webhooks/context
  → verify signature, dedupe on X-Context-Id, insert event, return 200
  → waitUntil(process):
      always    → event.title/summary/importance come straight from Context.dev's judge
      pricing?  → schema scrape → pricing_snapshot → battlecard.pricing
      always    → Sonnet 5.5 regenerate battlecard.how_to_win
  → Supabase Realtime → feed card + battlecard section update in browser
```

**Stack:** Next.js (App Router, TypeScript) on Vercel · Supabase (Postgres + Realtime) · Claude API (`claude-sonnet-5-5`, only for "How to win") · Context.dev.

### Context.dev feature map

| Use | Feature | Cost |
|---|---|---|
| Company input with logos | Brand search `GET /v1/brand/search` | 1 |
| Description/industry for discovery | Brand retrieve `POST /v1/brand/retrieve` | 10 |
| Find competitors + their URLs | Answers `POST /v1/web/answers` (`fast`) | 10 |
| Verify/fill URLs | Map `GET /v1/web/urls` | 1 |
| 💰 Pricing tripwire, 15 min | `page` monitor + `instructions` (semantic) | 1/run |
| Structured pricing on change | Scrape `POST /v1/web/scrape` with JSON schema | ~1 |
| 🚀 Launches, hourly | `sitemap` monitor on blog/changelog/docs | 1/run |
| 📰 Press, hourly | `search` monitor `"<competitor>"` + News search for context | 2/run |
| 🧑‍💻 Hiring, hourly | `page` monitor + instructions on careers page | 1/run |
| 🎯 Positioning, hourly | `page` monitor + instructions on homepage | 1/run |
| Pricing history (12 months) | Scrape on Wayback snapshot URLs | 1 each |
| Logos on cards | Logo Link CDN | free |
| Live demo trigger | Monitor run-now → signed webhook | 1 |

Budget: about 1.2k credits/day for 7 competitors. We have 50k credits and 50 concurrent requests.

### Verified API facts (from the docs; these simplify the build)

- **Brand retrieve returns `links.pricing`, `links.blog`, `links.careers`.** One Brand call per competitor gives most monitor URLs. Map is only a fallback.
- **Semantic changes arrive pre-summarized:** `title`, `summary`, `importance` (low/medium/high), `confidence`, `diff`. **We don't need our own LLM per event.** An LLM is only needed for "How to win".
- Sitemap changes carry `added_urls` / `removed_urls`; search changes carry `matched_urls` + `evidence`.
- Minimum schedule is **10 minutes**. Run now: `POST /v1/monitors/{id}/run` → `202 {run_id}`.
- **The webhook secret is per monitor** (`webhook.secret` in the create response). Store it in `monitors.webhook_secret` and receive at `/api/webhooks/context/[monitorId]` so we can look the secret up. Signature: `X-Context-Signature: t=…,v1=HMAC_SHA256(secret, "t.rawBody")`. Dedupe on payload `id` (= `X-Context-Id`). Return 2xx within 15 s.
- Events: `change.detected` (`data.change`) and `run.completed` (`data.run`, `data.change|null`). Failed runs send no webhook.
- Monitors auto-pause after 3 failed runs before a baseline exists, so check the baseline status after onboarding.

### Measured in the PoC (2026-11-14)

- **Discovery chain** (Brand search → Brand → Answers → 7× Brand): **10.8 s**, sensible competitors, 18/21 links found. Use Answers' competitor names, not Brand titles.
- **Pricing schema scrape:** 3.5 s live; 4 Wayback snapshots in about 4–8 s.
- ⚠️ **Monthly vs yearly toggle trap:** the first schema reported a fake "price hike" (yearly → monthly display). The schema now extracts `price_monthly_usd` and `price_monthly_usd_billed_yearly` separately. **Compare like with like before calling anything a price change.**
- Real event found in history: Firecrawl **added a Scale tier** between Dec 2025 and May 2026.
- **Monitor baseline:** 11.4 s. **Run now (no change):** 18.1 s (about 6 s queued, 12 s running). A run that finds a change adds a re-fetch and the change judge, so **plan for a 25–35 s demo loop**. Show the stages live ("Fetching… judging… updated") so the wait reads as work, not lag.
- ✅ **Production end-to-end (Vercel + Supabase):** onboarding context.dev took 9 s for discovery and 24 s for confirm (8 monitors + batch). The live loop (edit sandbox price → Sweep now → battlecard shows the new price) took **35.5 s**; Context.dev's detection → our battlecard update took **6.1 s**. The Wayback batch produced 18 historical snapshots plus live pricing for all battlecards.
- ⚠️ **Free plan: max 10 monitors, 2 concurrent requests, 1 active batch.** Ask the organizers for a plan upgrade. Until then `MONITOR_SIGNALS=pricing,launches` and ≤ 4 competitors incl. the sandbox.
- ⚠️ **API rate limit: 10 request units/minute on our key** (429 `RATE_LIMITED`, "Retry in N seconds"). `lib/context.ts` retries automatically. This throttles onboarding and backfill: 7 competitors × (Brand + pricing scrape + 6 Wayback) is about 60 calls, roughly 6 minutes. **Ask the organizers to raise it** (we were told 50 concurrent). Until then: queue backfill in the background, and onboard the demo workspace well before judging.

### Monitor instructions (starting prompts)

- **Pricing:** "Only report changes to plan names, prices, billing periods, usage limits or included features. Ignore layout, testimonials, cookie banners."
- **Hiring:** "Report new or removed job postings. Ignore page chrome."
- **Positioning:** "Report changes to the main headline, tagline, target customer or key value propositions."

### Pricing JSON schema (for the schema scrape and the Wayback backfill)

```json
{ "plans": [ { "name": "string", "price_monthly_usd": "number|null",
               "billing_note": "string", "limits": ["string"], "features": ["string"] } ] }
```

### Wayback backfill

1. Use the free archive.org CDX API, roughly one snapshot per month:
   `https://web.archive.org/cdx/search/cdx?url=<pricing_url>&output=json&collapse=timestamp:6&from=<12mo ago>`
2. Schema-scrape `https://web.archive.org/web/<timestamp>/<pricing_url>` in parallel (≤ 50 concurrent).
3. Insert each result as `pricing_snapshots` with `source='wayback'`.

---

## Data model (Supabase)

```sql
workspaces        (id uuid pk, name, domain, description, logo_url, created_at)
competitors       (id uuid pk, workspace_id fk, name, domain, logo_url,
                   pricing_url, blog_sitemap_url, careers_url, homepage_url,
                   is_sandbox bool default false, created_at)
monitors          (id uuid pk, competitor_id fk, signal text,  -- pricing|launches|news|hiring|positioning
                   context_monitor_id text unique, webhook_secret text, url, schedule jsonb, status)
events            (id uuid pk, competitor_id fk, signal, context_event_id text unique,
                   raw jsonb, title, summary, importance int,           -- 1 low … 3 high
                   detected_at, received_at, processed_at, battlecard_updated_at)
battlecards       (competitor_id pk fk, pricing jsonb, launches jsonb, news jsonb,
                   hiring jsonb, positioning jsonb, how_to_win text,
                   updated_at, last_event_id fk)
pricing_snapshots (id uuid pk, competitor_id fk, captured_at, source text, -- wayback|live
                   plans jsonb)
sandbox_content   (page text pk, content jsonb, updated_at)  -- drives the demo competitor site
```

Turn on Realtime for `events` and `battlecards`.

**Latency counter** = `battlecard_updated_at − detected_at`, shown on every event card. If the payload has no detection time, fall back to `received_at`.

---

## Repo layout & ownership

```
lib/                    ✅ PoC done: context.ts (only file calling Context.dev), pricing.ts (schema + Wayback), webhook.ts (signature)
poc/                    ✅ runnable scripts proving each risky step (see README.md)
app/
  onboard/              B  onboarding UI (autocomplete, streamed progress, confirm)
  w/[id]/               B  feed + battlecards
  api/onboard/          A  onboarding chain (streams progress), lifts poc/01 + creates monitors
  api/webhooks/context/[monitorId]/  A  receiver (per-monitor secret lookup)
  api/sweep/            A  "Sweep now" → run-now on all monitors of a workspace
  sandbox/              B  fake competitor "Scrapr" (pricing, blog, careers) rendered from sandbox_content
  sandbox/admin/        B  form that edits sandbox_content instantly
lib/pipeline.ts         A  processEvent(): pricing re-scrape, battlecard update, How to win (Sonnet)
lib/db.ts, types.ts     A  Supabase client + shared types
supabase/migrations/    A
```

The sandbox reads from the database (rendered dynamically), so an edit is live instantly with no redeploy. That keeps the on-stage demo loop as short as possible (~30 s, mostly Context.dev run time).

---

## Team: 2 coders + 2 on video and pitch

| Who | Owns | First deliverable |
|---|---|---|
| **A: Backend** | Supabase schema, onboarding route, monitor creation, webhook receiver, pipeline, Wayback backfill, How to win prompt | 17:30: a real webhook lands as an event row in production |
| **B: Frontend** | Next.js UI: onboarding, feed, battlecards, diff highlight, pricing chart, latency badge, sandbox site + admin | 17:30: feed + battlecard render from seed data, with Realtime |
| **C: Video** | Promo video: script, storyboard, screen recordings, voice-over, edit | 18:00: script + storyboard. Final screen recordings at 05:00 (feature freeze) |
| **D: Pitch & QA** | Pitch deck/slide, demo script, submission text, sandbox content, testing the live app every checkpoint, real-world validation (ask the Context.dev team at the booth what they'd want on a battlecard) | 16:30: verified URL sheet for the 7 competitors; tests the onboarding flow from 21:00 |

**Who to involve when:**
- C and D are the product's first users. Their feedback at each checkpoint is the QA.
- C needs **stable UI by 05:00** for recordings. Before that, record with placeholder data so the edit can be built early. Swap in final footage after the freeze.
- D gets quotes or validation from Context.dev people at the booth during the evening. That's "real-world impact" evidence for both the pitch and the video.

## How we work as a team

1. **Contracts first (14:30–15:00, A + B).** Agree on the SQL schema, `types.ts` and the shapes of the Realtime rows. After that, B builds against seed data and A against the real API, so neither blocks the other.
2. **Fakes over waiting.** B inserts fake `events` rows by hand to test Realtime and animations. A replays saved webhooks from `poc/out/webhooks/*.json` with `curl`.
3. **Folder ownership** (table above) means almost no merge conflicts. Shared files (`types.ts`, migrations) change with a heads-up in chat.
4. **Git: trunk-based.** Push small commits to `main` (two people don't need PR ceremony). `main` auto-deploys to Vercel, and the deploy URL is what C and D test against.
5. **One of everything.** One repo, one Vercel project, one Supabase project. Env vars in Vercel; `vercel env pull .env.local`. Never commit keys.
6. **Syncs:** 10 minutes at each checkpoint (17:30, 21:00, 23:00, 02:00, 05:00, 07:00) with all four. Each says what's done, what's next, and what's blocked. C and D demo-test the live URL at every sync.
7. **Scope discipline.** Nothing gets built that isn't in this file. New ideas go to "Later".
8. **AI assistants:** point them at `PLAN.md` and `README.md`. Both coders reuse `lib/`, don't rewrite it.
9. **Sleep in shifts.** A and B shouldn't sleep at the same time while overnight monitors run (e.g. B 01:30–05:00, A 03:00–06:30). C and D sleep earlier so they're fresh for final recording and pitch prep in the morning.

## Timeline & checkpoints

| Time | Milestone |
|---|---|
| 14:30–15:00 | Repo, Vercel, Supabase, keys, contracts agreed |
| **17:30** | ✅ A real webhook from one monitor becomes an event row in production |
| **21:00** | ✅ Onboarding works end to end; feed updates live; sandbox site live |
| **23:00 ⛔** | ✅ **context.dev workspace onboarded with real monitors running.** Non-negotiable. |
| **02:00** | ✅ Battlecards: pricing table, Wayback history chart, How to win |
| **05:00** | ✅ Sandbox + Sweep-now demo loop ≤ 35 s with live stage display. **Feature freeze.** |
| 07:00–09:00 | Polish, rehearse ×2, record backup video, write submission |
| **09:30** | 🚀 Submit |

**Cut order if behind:** Positioning → Hiring → Wayback backfill → News.
**Minimum viable demo:** Pricing + Launches + battlecard + sandbox trigger.

## Demo script (3 min)

1. **(20 s) Problem.** CI tools cost $20k+/yr and go stale; pricing pages change overnight.
2. **(40 s) Real overnight events.** Open the context.dev workspace: "At 03:12 last night, Firecrawl shipped…" Show a battlecard with its 12-month pricing history.
3. **(50 s) Live onboarding.** A judge names a company → autocomplete → competitors appear → confirm → monitors and backfill start, with progress streaming.
4. **(50 s) Live trigger.** In sandbox admin, change Scrapr Pro from $49 to $79 and publish an "Enterprise SSO" post → Sweep now → feed card pops in → battlecard rewrites with the diff highlighted → latency badge (~30 s).
5. **(20 s) Close.** Architecture slide (10 Context.dev features) and impact.

## Later (do not build unless everything above is done)

- The app themes itself to the user's brand (Brand / Styleguide)
- Slack / email daily digest
- People search: who joined or left the competitor
