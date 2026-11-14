import { deleteWorkspace } from "@/lib/workspaces";

export const maxDuration = 60;

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return Response.json(await deleteWorkspace(id));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
