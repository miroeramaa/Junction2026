# End-to-end and interface verification — 14 November 2026

## Live service test

Used an isolated synthetic workspace and two real Context.dev page monitors against the public sandbox. No fabricated webhook payloads or direct event inserts were used. Context.dev delivered to the existing deployed signed webhook receiver; the local app read the resulting shared database records. This verifies the deployed ingestion pipeline and the local refactored UI, rather than claiming the new UI is deployed.

| Controlled edit (UTC) | Observed result | Card updated (UTC) | Edit-to-card time |
| --- | --- | --- | --- |
| 20:56:24.688 — Pro $59 → $99 | Actual pricing webhook, high importance | 20:56:53.554 | 28.9 s |
| 20:56:24.688 — ML Engineer in Berlin | Actual hiring webhook | 20:56:52.884 | 28.2 s |
| 21:05:22.720 — Pro $99 → $139 | Actual pricing webhook | 21:05:55.153 | 32.4 s |
| 21:05:22.720 — Enterprise Solutions Engineer in Helsinki | Actual hiring webhook | 21:05:50.139 | 27.4 s |

Generated a real brief at 21:00:44.380. After the second round of edits, a new brief was saved automatically at 21:06:03.528 without a manual generation request. The deployed service considered three events because the fourth was still processing. The existing five-minute automatic cooldown can leave closely spaced updates out of the saved brief; the UI flags newer evidence and offers Refresh. This is a known timing limitation, not a claim that every webhook immediately regenerates the brief.

The test uncovered a separate evidence-selection bug: different price moves with the same headline were treated as repeated headlines. Updated deduplication to include summary and diff, with a regression test. A subsequent real local generation at 21:09:21.399 considered all four events. It returned no strong strategic conclusions for the synthetic fixture, exercising the honest empty state. Also clarified the prompt that price moves do not establish costs or margins.

Verified the four actual events, source links, $139 price card and brief empty state in the rendered local UI. Screenshots are in `../../output/playwright/live-e2e-{changes,pricing,brief}.png`. Machine-readable observations, original automatic brief and timestamps are in [live-e2e-evidence.json](live-e2e-evidence.json).

Cleanup succeeded: both temporary provider monitors were deleted, the isolated workspace was removed, and pricing/careers sandbox content was restored (Pro $59 and one original job). No concurrent edits were overwritten. The temporary local verification route was removed after inspection.

## Interface refactor

Implemented the layout in [UI_PLAN.md](../UI_PLAN.md):

- Competitor overview: compact positioning/audience cards, with category-specific detail and evidence.
- All changes: search and Important/All filters above one dated feed. Raw diffs and filtering explanations start collapsed.
- Market brief: a dedicated destination, instead of a repeated full panel above unrelated pages.
- Manage watchlist: Competitors & sources and Email digest subviews. Frequency controls are expandable; workspace deletion has an inline confirmation here.
- Company pages: separate Overview, Pricing and Activity views, with lazy pricing-history loading.
- Phone navigation: all four main destinations wrap visibly; a company selector replaces the horizontal company rail.

## Verification

- 93 automated tests passed, including the new successive-price-change regression.
- TypeScript check passed; `git diff --check` passed.
- Six browser suites passed: comparison research; market brief; digest/frequency/search/feedback; signal filtering and source controls; unread persistence; navigation/deep links/profile tabs/mobile containment.
- Intercepted browser write tests exercised failure retention and explicit retries without altering real preferences, competitors or schedules.
- Visually inspected desktop overview/changes and phone overview/management renders. Viewport containment checked at 390 px and desktop navigation at 1440 px.
- Production build was not run against the active development output directory. No deployment was performed.
- Optional Anthropic sales analysis was not included in the live test because that provider key is absent. Daily email delivery was not sent; digest preference interactions and existing server tests were checked.
