import { timingSafeEqual } from "node:crypto";

/**
 * Anything that changes data or spends credits requires the admin password (ADMIN_TOKEN) in `x-admin-token`.
 * Without ADMIN_TOKEN set (local dev) everything is allowed. Returns a 403 response to send, or null if allowed.
 */
export function requireAdmin(req: Request): Response | null {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return null;
  const given = Buffer.from(req.headers.get("x-admin-token") ?? "");
  const want = Buffer.from(expected);
  if (given.length === want.length && timingSafeEqual(given, want)) return null;
  return Response.json({ error: "Admin password required" }, { status: 403 });
}
