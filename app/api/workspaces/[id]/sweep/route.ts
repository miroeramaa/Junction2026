import { requireAdmin } from "@/lib/admin";
import { sweepWorkspace } from "@/lib/monitors";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { id } = await params;
  return Response.json(await sweepWorkspace(id));
}
