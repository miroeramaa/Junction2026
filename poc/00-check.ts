// Setup check: env vars, Supabase schema, Context.dev plan limits.
// Usage: npm run check

import { db } from "../lib/db";

for (const k of ["CONTEXT_DEV_API_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
  console.log(k.padEnd(30), process.env[k] ? "✓ set" : "✗ missing");
}

for (const t of ["workspaces", "competitors", "monitors", "events", "battlecards", "pricing_snapshots", "batches", "sandbox_content"]) {
  const { count, error } = await db().from(t).select("*", { count: "exact", head: true });
  console.log(`table ${t}`.padEnd(30), error ? `✗ ${error.message}` : `✓ ${count} rows`);
}

const res = await fetch("https://api.context.dev/v1/monitors/limits", {
  headers: { Authorization: `Bearer ${process.env.CONTEXT_DEV_API_KEY}` },
});
const limits = await res.json();
console.log(
  "context.dev plan".padEnd(30),
  `${limits.plan}: ${limits.monitors_used}/${limits.monitors_limit} monitors, ${limits.key_metadata?.credits_remaining} credits`,
);
