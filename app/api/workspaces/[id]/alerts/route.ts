import { db, must } from "@/lib/db";

const SIGNALS = ["pricing", "launches", "news", "hiring", "positioning"];

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data, error } = await db().from("workspace_alert_settings").select("email,digest_enabled,signals,last_digest_at").eq("workspace_id", id).maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data ?? { email: "", digest_enabled: false, signals: SIGNALS, last_digest_at: null });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json()) as { email?: string; digest_enabled?: boolean; signals?: string[] };
  const email = (body.email ?? "").trim().toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: "Enter a valid email address." }, { status: 400 });
  const signals = [...new Set((body.signals ?? []).filter((s) => SIGNALS.includes(s)))];
  if (body.digest_enabled && (!email || !signals.length)) return Response.json({ error: "Add an email and select at least one signal." }, { status: 400 });
  const row = must(await db().from("workspace_alert_settings").upsert({ workspace_id: id, email: email || null, digest_enabled: !!body.digest_enabled, signals, updated_at: new Date().toISOString() }).select("email,digest_enabled,signals,last_digest_at").single());
  return Response.json(row);
}
