import { after } from "next/server";
import { db, must } from "@/lib/db";
import { addSandboxCompetitor, confirmCompetitors } from "@/lib/onboard";

export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { competitorIds, sandbox } = (await req.json()) as { competitorIds: string[]; sandbox?: boolean };
  after(async () => {
    const ids = [...competitorIds];
    if (sandbox) {
      await addSandboxCompetitor(id);
      const row = must(await db().from("competitors").select("id").eq("workspace_id", id).eq("is_sandbox", true).limit(1).single());
      ids.push(row.id);
    }
    await confirmCompetitors(id, ids);
  });
  return Response.json({ ok: true });
}
