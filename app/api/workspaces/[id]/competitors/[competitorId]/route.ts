import { removeCompetitor, controlResponse } from "@/lib/source-controls";
export const maxDuration = 120;
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; competitorId: string }> }) {
  const { id,competitorId } = await params;
  try { return Response.json(await removeCompetitor(id,competitorId)); } catch(error) { return controlResponse(error); }
}
