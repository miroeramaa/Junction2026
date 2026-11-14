import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let admin: SupabaseClient | null = null;

/** Server-only client with the service role key (bypasses RLS). Never import from client components. */
export function db(): SupabaseClient {
  if (!admin) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    admin = createClient(url, key, { auth: { persistSession: false } });
  }
  return admin;
}

/** Throws on Supabase errors so callers can use plain `await`. Data is null for writes without `.select()`. */
export function must<T>(res: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (res.error) throw new Error(`Supabase: ${res.error.message}`);
  return res.data as NonNullable<T>;
}

/** Public base URL used in webhook URLs we hand to Context.dev. */
export function appUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  throw new Error("Set APP_URL to the public https URL of this app (webhooks need it)");
}
