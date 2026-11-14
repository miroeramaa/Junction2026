# Kestrel interface structure

The dashboard grew by mounting each new feature above the previous one. This makes every task compete for the same screen. Refactor around four destinations, retain existing URLs, and give each destination one main purpose.

| Destination | Primary task | Content and controls |
| --- | --- | --- |
| Competitor overview | Compare companies | Compact cards; category comparison; one research action. No full brief, global search/settings or feed-filter card. |
| All changes | Review evidence | Page heading, search and Important/All filtering, then a single-column dated feed. No pricing table or repeated full brief. |
| Market brief | Interpret developments | Brief and evidence, one generate/refresh action. No comparison cards or unrelated controls. |
| Manage watchlist | Configure coverage | Sources and Email digest subviews. Source frequency is disclosed within source management. Destructive actions stay here. |

Competitor profiles have Overview, Pricing and Activity views. Company facts, pricing/history and the event feed should not all compete on one long page. Existing sales analysis remains available through progressive disclosure.

Keep the workspace bar quiet: company identity, short monitoring health and Check now. Move workspace deletion into management. Sidebar navigation separates workspace destinations from company shortcuts; use a wrapped navigation on phones rather than requiring horizontal scrolling to reach the main destinations.

Interaction rules:
- Research and refresh start directly, show inline progress, and preserve duplicate-request guards.
- Source evidence, raw page diffs, research metadata and filtering explanations are disclosed on demand.
- Search belongs to the change feed; it never becomes a persistent stack above other views.
- Preserve query-string selection and existing view aliases, unread tracking, source links and browser-language handling.
- Avoid fabricated summary metrics and empty placeholder cards.

Verification: real controlled website change through Context.dev and signed delivery where reachable; inspect captured events, card updates and brief timestamps. Check navigation, single-purpose pages, deep links, research, settings, unread counts, keyboard controls and phone containment in the rendered app. Keep synthetic test data outside real workspaces and restore controlled page content afterwards.
