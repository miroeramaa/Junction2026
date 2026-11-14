@AGENTS.md

# Kestrel (Junction 2026 hackathon)

- Read `PLAN.md` (product, scope, cut order, team ownership) and `README.md` (setup, routes) first.
- `lib/context.ts` is the only module that calls Context.dev; extend it rather than calling `fetch` elsewhere.
- Schema lives in `supabase/migrations/`; keep `lib/types.ts` in sync with it.
- Server code uses `db()` from `lib/db.ts` (service role). Client components use `supabaseBrowser()` (anon, read-only + Realtime).
- Context.dev scrape caches for 3 days by default: live reads must pass `maxAgeMs: 0` (the `scrapeJson` default).
- Pricing: never compare a monthly-billed price with a yearly-billed one (see PLAN.md, "Measured in the PoC").
- Don't build anything that isn't in PLAN.md; add ideas to its "Later" list.
