# Kestrel

The full plan is in [PLAN.md](PLAN.md).

## App setup (once)

1. **Supabase:** create a project, open **SQL Editor**, paste and run `supabase/migrations/0001_init.sql`.
2. **Env:** `cp .env.example .env` and fill in `CONTEXT_DEV_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Project settings → API).
3. **Deploy:** Context.dev must reach our webhooks, so the app has to run on a public URL. Run `vercel link`, add the same env vars in Vercel (Settings → Environment Variables), then `vercel --prod`. `APP_URL` is optional on Vercel production.
4. **Free-plan limits:** 10 monitors total, 10 requests/min, 1 active batch. Until the organizers upgrade the plan, set `MONITOR_SIGNALS=pricing,launches` and onboard with only 3–4 competitors (+ the sandbox).

## App routes

### Competitor overview

The default workspace view uses responsive competitor cards. Category filters compare positioning, audiences, offerings, pricing and signals without a horizontally scrolling table. Evidence and research metadata are progressively disclosed. **All changes** and individual battlecards remain available in the sidebar. Links preserve the selected view (`?view=matrix`, `?view=changes`, or `?c=<competitor-id>`).

Before researching profiles, run `supabase/migrations/0002_competitor_comparison.sql` in Supabase SQL Editor. This adds one nullable JSONB column to `battlecards`; existing data and policies are preserved. Without it, existing prices and activity still render, and research is rejected before spending credits.

**Research / Refresh research** reads each competitor's homepage through Context.dev, sequentially, then at most one relevant company page linked from that homepage if positioning, audiences or capabilities are missing. It never guesses URLs or follows unrelated domains. Research, refresh and audience estimation start directly when clicked, with inline progress and a stop control for multi-company research. When direct audience statements are absent, Context.dev Answers infers likely audiences from the verified facts. These are stored separately as AI estimates with reasoning, references to the actual supporting facts, a source-profile timestamp and an output locale. **Fill audience gaps** runs this analysis against existing research without re-scraping. No additional model-provider key is needed. Facts retain their own source URL and capture time. Comparison actions follow the same password-free access as the rest of the app. Merely opening the matrix makes no Context.dev research calls. Research is explicit for both new and existing workspaces; no automatic backfill or new monitors are created. Stopping or leaving the view prevents the next company from starting; the current profile's server request may still finish.

Evidence verification uses captured Markdown plus page title/description metadata, matching the extractor's requested inputs. It ignores Markdown presentation syntax, escaping and typographic quote differences, but does not accept paraphrased evidence. Malformed individual facts are skipped without discarding other verified facts; empty research never overwrites the existing profile. A failed secondary page preserves usable homepage facts and shows a coverage warning. Direct facts remain separate from AI audience interpretations. AI-returned evidence IDs must refer to supplied facts; source passages are never invented by the analysis layer.

Homepage changes mark a profile as needing refresh. Prices and activity use the existing live battlecard pipeline independently. Missing evidence is shown as unknown; sales briefs and pricing-plan marketing bullets are not treated as sourced capabilities or audience claims. Demo competitors are excluded by default. Monthly-billed and annually-billed prices stay separate, and billing notes/limits remain inspectable.

Profile research sends the browser's preferred language (`navigator.languages[0]`) to extraction. Summaries are translated into that language; evidence quotes remain verbatim in the source language and pass the same evidence checks. The saved profile records its summary locale. Existing profiles need an explicit refresh to adopt a language, and the saved language is shown under Research details. Profiles are shared across the workspace, so a refresh replaces the saved summary language for everyone. Viewing never triggers paid translation or extraction.

Database writes retry once for transient failures without repeating research, sanitize NUL/unpaired Unicode characters that PostgreSQL JSONB cannot store, and protect audience-only updates from overwriting a newer research snapshot. Technical failures are logged server-side; the UI retains saved content and offers a retry.

Run `npm test` for comparison data and rendering checks, then `npm run typecheck` and `npm run build`.

`tests/comparison.browser.js` exercises the rendered matrix with browser-only research fixtures. Open a local **watching** workspace with at least two real competitors in Playwright CLI, then run `playwright-cli run-code --filename tests/comparison.browser.js`. It covers evidence, view navigation, failed refreshes, mobile containment across all categories, one-click research without confirmation popups, audience analysis labeling, quiet error handling, bulk updates and stopping the queue. It does not send research POSTs to the real backend or write to Supabase. Screenshots are saved under `output/playwright/` relative to the CLI working directory.

| Route | What |
|---|---|
| `/` | Company autocomplete → onboarding |
| `/w/[id]` | Discovery progress → pick competitors → live feed + battlecards (Supabase Realtime) |
| `/sandbox`, `/sandbox/pricing`, `/sandbox/blog`, `/sandbox/careers`, `/sandbox/sitemap.xml` | Fake competitor "Scrapr", rendered from the `sandbox_content` table |
| `/sandbox/admin` | On-stage controls: change prices, publish a blog post |
| `POST /api/webhooks/context/[monitorId]` | Monitor webhooks (per-monitor signing secret) → event row → battlecard update |
| `POST /api/webhooks/batch/[workspaceId]` | Pricing-history batch finished → `pricing_snapshots` + live pricing on battlecards |
| `POST /api/workspaces/[id]/sweep` | "Sweep now": run every monitor of the workspace |
| `POST /api/workspaces/[id]/comparison` | Research or update a competitor comparison profile |
| `GET /api/cron/daily-digest` | Daily email of high/medium importance changes; protected by `CRON_SECRET` |

## Daily email digest and feedback

Apply migrations in order: `0001_init.sql`, `0002_competitor_comparison.sql`, `0003_market_briefs.sql`, then `0004_alerts_feedback.sql`. The workspace dashboard can search its loaded change history, save a daily digest email and signal filters, rate whether an alert was useful, and change a monitor's interval. Digest delivery uses Vercel Cron at 08:00 UTC and Resend. Configure `RESEND_API_KEY`, a verified `DIGEST_FROM_EMAIL`, and a strong `CRON_SECRET` in the deployment environment. The cron route sends at most five prioritized, deduplicated events per workspace and sends no email on quiet days.

For local development, the cron is not invoked automatically; request `/api/cron/daily-digest` with `Authorization: Bearer <CRON_SECRET>` to run it manually. Use a test recipient and Resend test mode before enabling production delivery.

Flow: **onboard** (Brand → Answers → Brand per competitor) → **confirm** (create monitors + one batch scraping live pricing and Wayback snapshots) → **webhooks** keep battlecards current.

## Proof-of-concept scripts

These scripts prove each risky step against the real Context.dev API. They only need `CONTEXT_DEV_API_KEY`.

## Run in order

| Step | Command | Proves | Credits |
|---|---|---|---|
| 1 | `npm run poc:discover -- "context.dev"` | Company name → competitors (Answers) → pricing/blog/careers URLs (Brand). Writes `poc/out/competitors.json` | ~90 |
| 2 | `npm run poc:pricing -- https://www.firecrawl.dev/pricing 6` | Structured pricing table from a live page + 6 Wayback snapshots, scraped in parallel | ~15 |
| 3 | `npm run poc:monitor -- create <url>` then `npm run poc:monitor -- run <id>` | Semantic monitor, baseline, run now, change with title/summary/diff, run latency | 1/run |
| 4 | `npm run poc:webhook` + a tunnel | Signed webhook arrives, signature verifies, payload saved as a fixture in `poc/out/webhooks/` | 0 |

### Testing a real change (step 3 + 4)

1. Create a public **GitHub Gist** with a fake pricing table, e.g. `Pro: $49/month, 10k pages`.
2. `npm run poc:webhook`, and in a second terminal run `cloudflared tunnel --url http://localhost:8787` (or `ngrok http 8787`).
3. `npm run poc:monitor -- create https://gist.github.com/<you>/<id> https://<tunnel>/webhook`. Copy the printed secret into `.env` as `CONTEXT_WEBHOOK_SECRET` and restart the receiver.
4. After the baseline completes, edit the gist price to `$79`, then run `npm run poc:monitor -- run <id>`.
5. Watch the change appear in both terminals, with latency. Delete the monitor afterwards: `npm run poc:monitor -- delete <id>`.

## What to note down

- Are the competitors from step 1 sensible? How long did the full chain take, and how many Brand links were `null`?
- Does the pricing extraction look right on JavaScript-heavy pricing pages and on Wayback snapshots?
- How long does run now take to complete, and to webhook? That is the demo latency budget.

### Market brief (strategic insights)

Run `supabase/migrations/0003_market_briefs.sql` once in Supabase SQL Editor. It creates a workspace-scoped cache table with RLS enabled; the app's server API reads/writes it with the existing service key. No new model-provider key is required.

Open **Market brief** in the workspace navigation. It has its own focused page. **Generate brief** asks Context.dev Answers to interpret captured events for the workspace company. It shows up to three interpretations with company-specific relevance, suggested investigations, qualitative confidence, and expandable observed changes linked to their actual source pages. It can show fewer or none. Interpretations are explicitly separated from the captured observations.

Only confirmed, non-demo competitors in the workspace contribute evidence. Inputs are processed medium/high-importance events from the last 30 days, bounded to the newest 300 queried events and 80 distinct eligible observations. Repeated reports with matching headlines, summaries and diffs are deduplicated; successive price moves remain separate. A compact subset is selected to respect Answers' 2,000-character task limit. A pattern requires multiple events at different pages for one competitor. A single significant event requires high importance and is capped at tentative confidence. Unknown citations, unrelated competitors and duplicate interpretations are rejected. These structural checks do not independently prove every generated sentence; the UI labels the content as AI interpretation and keeps the observed evidence inspectable.

Generating once enables automatic refresh after meaningful processed webhooks. Concurrent generation is protected by a database lease; automatic refreshes are limited to once per five minutes, and manual retries to once per 30 seconds. Changes arriving inside the cooldown may remain marked as new evidence until another eligible webhook or a manual refresh. Opening the dashboard never generates a brief or spends research credits. The UI polls saved state every 30 seconds (5 seconds during generation) so background updates appear without a reload. Unchanged fingerprints reuse the cached result. Failed generation preserves the last good brief; missing storage is detected before any paid request.

`GET /api/workspaces/[id]/brief?locale=en-US` returns saved content, evidence eligibility and freshness. `POST` with `{ "locale": "en-US" }` requests a refresh. These follow the app's current password-free access model.

`tests/market-brief.browser.js` verifies one-click generation without a confirmation, source links, failure retention and mobile containment with intercepted API fixtures. It never generates a real paid brief. The route tests also cover cache reuse, workspace isolation, cooldowns, concurrent claims and rejection of invented citations.

### Meaningful signals and watchlist controls

**Important / All changes** switches between the curated feed and retained raw history. The shared rules hide clear website presentation/access-page noise, low-importance routine updates, sitemap taxonomy/pagination churn, and repeated reports of the same change within 48 hours. Concrete business changes and ambiguous unrated updates stay available for review; high-importance and team-marked-useful updates are prioritized. Every event carries an explanation. **Hide this update** and **Keep this update** save workspace-wide overrides using the existing `event_feedback` table; hiding one report also suppresses its equivalent copies. Search is available in **All changes** and searches the selected Important/All changes view. Choose All changes to include filtered history.

Filtering also applies to brief evidence and the daily digest. Cached brief insights whose evidence is now hidden are omitted at read time, without a paid generation. The webhook pipeline retains obvious noise/duplicates but skips paid card regeneration for them. Feed/read badges cover the currently selected filter. These rules are conservative heuristics plus Context.dev's existing importance judgments, not a new claim of perfect semantic classification. The browser loads the latest 200 events; briefs/digests inspect at most 300 and pipeline duplicate detection checks at most 100 events from the prior 48 hours.

Open **Manage watchlist** in the sidebar to add a competitor, remove one, edit source URLs/press queries, add a missing source type, pause/resume monitoring, or retry a failed source. Adding a company starts homepage and press monitoring; pricing, careers and sitemap URLs can be supplied explicitly afterwards. New monitoring and source edits may consume Context.dev credits. No new schema migration or model-provider key is required beyond migrations 0001–0004.

Edits preserve existing instructions, selectors and sitemap scope. Correcting a current pricing page clears the current price card rather than attributing old prices to the new source; historical snapshots remain. Source editing follows [Context.dev's target-update semantics](https://docs.context.dev/monitors/targets): it starts a new baseline, while status changes keep the baseline. A paused source stays paused when edited. Paused/updating sources are excluded from manual sweeps, and late webhooks cannot mark a paused source active. Monitor secrets never leave the server.

Removal requires an inline confirmation because the competitor's profile/history are permanently deleted. Remote monitors are stopped before the local cascade; if a remote operation fails, the competitor remains available for retry. A source operation reports success only after its local state has been saved; failures stay visible and can be reconciled by retrying. These routes follow the app's existing password-free workspace access.

New API routes: `POST /api/workspaces/[id]/competitors`, `DELETE /api/workspaces/[id]/competitors/[competitorId]`, `POST /api/workspaces/[id]/competitors/[competitorId]/sources`, `PATCH /api/workspaces/[id]/monitors/[monitorId]`, and `GET /api/workspaces/[id]/events/feedback`.

`tests/controls-signals.browser.js` exercises filtering, overrides, competitor/source creation, URL editing, pause/resume, failed updates, cancellation/removal, and phone containment with intercepted writes. No real competitors, monitor schedules or credits are changed. `tests/signals.test.ts`, `tests/source-controls.test.ts` and `tests/digest-signals.test.ts` cover the server-side rules and failure cases using mocked services.

### Interface navigation

The workspace has four destinations: **Competitor overview**, **All changes**, **Market brief**, and **Manage watchlist**. Overview cards summarize positioning and audience; category buttons reveal detailed evidence, offerings, pricing and signals. A company profile separates Overview, Pricing and Activity. Manage watchlist contains Competitors & sources and Email digest; Monitoring frequency is expandable within source settings. Workspace deletion is disclosed under Workspace options, with inline confirmation. Main navigation wraps on phones, with a company selector instead of a long horizontal competitor rail. See [UI_PLAN.md](UI_PLAN.md) for the layout plan.
