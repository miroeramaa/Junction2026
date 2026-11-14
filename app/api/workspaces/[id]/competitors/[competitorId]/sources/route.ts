import { addSource, sourceInput, controlResponse } from "@/lib/source-controls";
export const maxDuration = 60;
export async function POST(req: Request, { params }: { params: Promise<{ id: string; competitorId: string }> }) {
  const { id,competitorId } = await params;
  const input = sourceInput.safeParse(await req.json().catch(()=>null));
  if (!input.success) return Response.json({error:"Choose a source type and enter a URL or press query."},{status:400});
  try { return Response.json(await addSource(id,competitorId,input.data)); } catch(error) { return controlResponse(error); }
}
