// Deletes workspaces and their Context.dev monitors.
//
// Usage:
//   npm run delete-workspace -- <workspaceId> [<workspaceId> …]
//   npm run delete-workspace -- --all

import { db, must } from "../lib/db";
import { deleteWorkspace } from "../lib/workspaces";

const args = process.argv.slice(2);
if (!args.length) throw new Error("Pass workspace ids, or --all");

const ids =
  args[0] === "--all"
    ? (must(await db().from("workspaces").select("id")) as { id: string }[]).map((w) => w.id)
    : args;

for (const id of ids) {
  const { removed } = await deleteWorkspace(id);
  console.log(`Deleted workspace ${id}: ${removed} Context.dev monitors removed`);
}
