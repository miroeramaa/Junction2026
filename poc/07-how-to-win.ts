// Regenerates the "How to win" brief for every competitor in a workspace (or all workspaces).
// Usage: npm run how-to-win -- [<workspaceId>]

import { db, must } from "../lib/db";
import { refreshHowToWin } from "../lib/how-to-win";

if (!process.env.ANTHROPIC_API_KEY) throw new Error("Set ANTHROPIC_API_KEY in .env");
const ws = process.argv[2];
const q = db().from("competitors").select("id, name").eq("confirmed", true);
const competitors = must(await (ws ? q.eq("workspace_id", ws) : q)) as { id: string; name: string }[];

await Promise.all(
  competitors.map(async (c) => {
    const t = Date.now();
    const ok = await refreshHowToWin(c.id);
    console.log(`${ok ? "✓" : "✗"} ${c.name} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  }),
);
