// Sandbox admin: edits the fake competitor's pages.

import { requireAdmin } from "@/lib/admin";
import { db, must } from "@/lib/db";

export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { page, content } = (await req.json()) as { page: string; content: unknown };
  if (!["pricing", "blog", "careers"].includes(page)) return new Response("bad page", { status: 400 });
  must(await db().from("sandbox_content").upsert({ page, content, updated_at: new Date().toISOString() }));
  return Response.json({ ok: true });
}
