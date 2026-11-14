import { db } from "@/lib/db";

/** Reads one sandbox page's content. Pages using this must be dynamic so edits show up instantly. */
export async function sandbox<T>(page: "pricing" | "blog" | "careers"): Promise<T> {
  const { data } = await db().from("sandbox_content").select("content").eq("page", page).single();
  return data?.content as T;
}
