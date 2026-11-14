import { z } from "zod";
import { comparisonLocale } from "@/lib/comparison";
import { BriefUnavailable, getMarketBrief, refreshMarketBrief } from "@/lib/market-brief-service";

export const maxDuration = 90;
const validId = z.string().uuid();
function failure(error: unknown) {
  if (error instanceof BriefUnavailable) {
    const status = error.code === "not_found" ? 404 : error.code === "busy" ? 409 : error.code === "cooldown" ? 429 : 503;
    return Response.json({code:error.code,error:error.code === "busy" ? "Your brief is already updating." : error.code === "cooldown" ? "Please wait a moment before updating again." : "The brief couldn't update just now. Saved insights are still available."},{status});
  }
  console.error("market brief request",error);
  return Response.json({code:"unavailable",error:"Your brief is temporarily unavailable."},{status:503});
}
export async function GET(req: Request, {params}: {params: Promise<{id:string}>}) {
  const {id} = await params;
  if (!validId.safeParse(id).success) return Response.json({error:"Invalid workspace."},{status:400});
  try {return Response.json(await getMarketBrief(id,comparisonLocale(new URL(req.url).searchParams.get("locale"))),{headers:{"Cache-Control":"no-store"}});} catch(error) {return failure(error);}
}
export async function POST(req: Request, {params}: {params: Promise<{id:string}>}) {
  const {id} = await params;
  const parsed = z.object({locale:z.string().max(80).optional()}).safeParse(await req.json().catch(()=>null));
  if (!validId.safeParse(id).success || !parsed.success) return Response.json({error:"Invalid brief request."},{status:400});
  try {return Response.json({row:await refreshMarketBrief(id,comparisonLocale(parsed.data.locale))});} catch(error) {return failure(error);}
}
