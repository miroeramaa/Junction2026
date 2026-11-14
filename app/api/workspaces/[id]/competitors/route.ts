import { addCompetitor, competitorInput, controlResponse } from "@/lib/source-controls";
export const maxDuration = 120;
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const input = competitorInput.safeParse(await req.json().catch(()=>null));
  if (!input.success) return Response.json({error:"Enter a company name and website."},{status:400});
  try { return Response.json(await addCompetitor(id,input.data)); } catch(error) { return controlResponse(error); }
}
