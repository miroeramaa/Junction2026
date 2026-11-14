import { after } from "next/server";
import { createWorkspace, discoverCompetitors } from "@/lib/onboard";

export const maxDuration = 300;

export async function POST(req: Request) {
  const { domain, name } = (await req.json()) as { domain?: string; name?: string };
  if (!domain) return Response.json({ error: "domain required" }, { status: 400 });
  const id = await createWorkspace(domain, name ?? domain);
  after(() => discoverCompetitors(id, domain)); // progress streams to the UI via Realtime
  return Response.json({ id });
}
