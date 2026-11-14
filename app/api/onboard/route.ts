import { after } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { discoverCompetitors, findOrCreateWorkspace, normalizeDomain } from "@/lib/onboard";

export const maxDuration = 300;

export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { domain: rawDomain, name } = (await req.json()) as { domain?: string; name?: string };
  if (!rawDomain) return Response.json({ error: "domain required" }, { status: 400 });
  const domain = normalizeDomain(rawDomain);
  const { id, existing } = await findOrCreateWorkspace(domain, name ?? domain);
  // Existing workspace: just open it. Rerunning discovery means deleting the workspace first.
  if (!existing) after(() => discoverCompetitors(id, domain)); // progress streams to the UI via Realtime
  return Response.json({ id, existing });
}
