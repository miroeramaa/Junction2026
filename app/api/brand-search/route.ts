// Company autocomplete. Proxied so the Context.dev key stays on the server.

import { searchBrands } from "@/lib/context";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return Response.json({ results: [] });
  return Response.json({ results: await searchBrands(q) });
}
