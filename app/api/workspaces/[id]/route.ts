import { requireAdmin } from "@/lib/admin";
import { deleteWorkspace } from "@/lib/workspaces";

export const maxDuration = 60;

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    return Response.json(await deleteWorkspace(id));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
