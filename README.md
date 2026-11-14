# Competitor Radar

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

**Research / Refresh research** reads each competitor's homepage through Context.dev, sequentially, then at most one relevant company page linked from that homepage if positioning, audiences or capabilities are missing. It never guesses URLs or follows unrelated domains. The in-page confirmation states this two-page bound and optional AI analysis. When direct audience statements are absent, Context.dev Answers infers likely audiences from the verified facts. These are stored separately as AI estimates with reasoning, references to the actual supporting facts, a source-profile timestamp and an output locale. **Fill audience gaps** runs this analysis against existing research without re-scraping. No additional model-provider key is needed. Facts retain their own source URL and capture time. Comparison actions follow the same password-free access as the rest of the app. Merely opening the matrix makes no Context.dev research calls. Research is explicit for both new and existing workspaces; no automatic backfill or new monitors are created. Stopping or leaving the view prevents the next company from starting; the current profile's server request may still finish.

Evidence verification uses captured Markdown plus page title/description metadata, matching the extractor's requested inputs. It ignores Markdown presentation syntax, escaping and typographic quote differences, but does not accept paraphrased evidence. Malformed individual facts are skipped without discarding other verified facts; empty research never overwrites the existing profile. A failed secondary page preserves usable homepage facts and shows a coverage warning. Direct facts remain separate from AI audience interpretations. AI-returned evidence IDs must refer to supplied facts; source passages are never invented by the analysis layer.

Homepage changes mark a profile as needing refresh. Prices and activity use the existing live battlecard pipeline independently. Missing evidence is shown as unknown; sales briefs and pricing-plan marketing bullets are not treated as sourced capabilities or audience claims. Demo competitors are excluded by default. Monthly-billed and annually-billed prices stay separate, and billing notes/limits remain inspectable.

Profile research sends the browser's preferred language (`navigator.languages[0]`) to extraction. Summaries are translated into that language; evidence quotes remain verbatim in the source language and pass the same evidence checks. The saved profile records its summary locale. Existing profiles need an explicit refresh to adopt a language, and the saved language is shown under Research details. Profiles are shared across the workspace, so a refresh replaces the saved summary language for everyone. Viewing never triggers paid translation or extraction.

Database writes retry once for transient failures without repeating research, sanitize NUL/unpaired Unicode characters that PostgreSQL JSONB cannot store, and protect audience-only updates from overwriting a newer research snapshot. Technical failures are logged server-side; the UI retains saved content and offers a retry.

Run `npm test` for comparison data and rendering checks, then `npm run typecheck` and `npm run build`.

`tests/comparison.browser.js` exercises the rendered matrix with browser-only research fixtures. Open a local **watching** workspace with at least two real competitors in Playwright CLI, then run `playwright-cli run-code --filename tests/comparison.browser.js`. It covers evidence, view navigation, failed refreshes, mobile containment across all categories, keyboard cancellation, audience analysis labeling, quiet error handling, bulk updates and stopping the queue. It does not send research POSTs to the real backend or write to Supabase. Screenshots are saved under `output/playwright/` relative to the CLI working directory.

| Route | What |
|---|---|
| `/` | Company autocomplete → onboarding |
| `/w/[id]` | Discovery progress → pick competitors → live feed + battlecards (Supabase Realtime) |
| `/sandbox`, `/sandbox/pricing`, `/sandbox/blog`, `/sandbox/careers`, `/sandbox/sitemap.xml` | Fake competitor "Scrapr", rendered from the `sandbox_content` table |
| `/sandbox/admin` | On-stage controls: change prices, publish a blog post |
| `POST /api/webhooks/context/[monitorId]` | Monitor webhooks (per-monitor signing secret) → event row → battlecard update |
| `POST /api/webhooks/batch/[workspaceId]` | Pricing-history batch finished → `pricing_snapshots` + live pricing on battlecards |
| `POST /api/workspaces/[id]/sweep` | "Sweep now": run every monitor of the workspace |
| `GET /api/cron/daily-digest` | Daily email of high/medium importance changes; protected by `CRON_SECRET` |

## Daily email digest and feedback

Apply migrations in order: `0001_init.sql`, `0002_competitor_comparison.sql`, then `0003_alerts_feedback.sql`. The workspace dashboard can search its loaded change history, save a daily digest email and signal filters, rate whether an alert was useful, and change a monitor's interval. Digest delivery uses Vercel Cron at 08:00 UTC and Resend. Configure `RESEND_API_KEY`, a verified `DIGEST_FROM_EMAIL`, and a strong `CRON_SECRET` in the deployment environment. The cron route sends at most five high/medium events per workspace and sends no email on quiet days.

For local development, the cron is not invoked automatically; request `/api/cron/daily-digest` with `Authorization: Bearer <CRON_SECRET>` to run it manually. Use a test recipient and Resend test mode before enabling production delivery.
| `POST /api/workspaces/[id]/comparison` | Profile update; body `{ "competitorId": "<uuid>", "locale": "en-US", "action": "research" }`; action may be `audience` to analyze saved facts; locale optional, falls back to Accept-Language then English |

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
