import { changeSource, sourcePatch, controlResponse } from "@/lib/source-controls";
export const maxDuration = 60;
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; monitorId: string }> }) {
  const { id,monitorId } = await params;
  const input = sourcePatch.safeParse(await req.json().catch(()=>null));
  if (!input.success) return Response.json({error:"Choose a valid source action."},{status:400});
  try { return Response.json(await changeSource(id,monitorId,input.data)); } catch(error) { return controlResponse(error); }
}
