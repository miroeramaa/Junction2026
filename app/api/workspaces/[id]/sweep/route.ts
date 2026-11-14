import { sweepWorkspace } from "@/lib/monitors";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return Response.json(await sweepWorkspace(id));
}
