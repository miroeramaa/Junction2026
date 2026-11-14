# Competitor Radar

The full plan is in [PLAN.md](PLAN.md).

## App setup (once)

1. **Supabase:** create a project, open **SQL Editor**, paste and run `supabase/migrations/0001_init.sql`.
2. **Env:** `cp .env.example .env` and fill in `CONTEXT_DEV_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Project settings → API).
3. **Deploy:** Context.dev must reach our webhooks, so the app has to run on a public URL. Run `vercel link`, add the same env vars in Vercel (Settings → Environment Variables), then `vercel --prod`. `APP_URL` is optional on Vercel production.
4. **Free-plan limits:** 10 monitors total, 10 requests/min, 1 active batch. Until the organizers upgrade the plan, set `MONITOR_SIGNALS=pricing,launches` and onboard with only 3–4 competitors (+ the sandbox).

## App routes

| Route | What |
|---|---|
| `/` | Company autocomplete → onboarding |
| `/w/[id]` | Discovery progress → pick competitors → live feed + battlecards (Supabase Realtime) |
| `/sandbox`, `/sandbox/pricing`, `/sandbox/blog`, `/sandbox/careers`, `/sandbox/sitemap.xml` | Fake competitor "Scrapr", rendered from the `sandbox_content` table |
| `/sandbox/admin` | On-stage controls: change prices, publish a blog post |
| `POST /api/webhooks/context/[monitorId]` | Monitor webhooks (per-monitor signing secret) → event row → battlecard update |
| `POST /api/webhooks/batch/[workspaceId]` | Pricing-history batch finished → `pricing_snapshots` + live pricing on battlecards |
| `POST /api/workspaces/[id]/sweep` | "Sweep now": run every monitor of the workspace |

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
