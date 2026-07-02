/**
 * SERVER-ONLY Supabase client (service role). Used exclusively by route handlers
 * to perform privileged writes AFTER the caller's wallet has been verified via
 * the auth abstraction. Never import this from a client component — the service
 * role bypasses RLS. (`SUPABASE_SERVICE_ROLE_KEY` must never be `NEXT_PUBLIC_*`.)
 *
 * Import only from server route handlers. It reads `SUPABASE_SERVICE_ROLE_KEY`,
 * which is not a `NEXT_PUBLIC_*` var, so it is undefined in the client bundle and
 * this throws if ever imported into client code.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function adminSupabase(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Server is not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (server-only)."
    );
  }
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}
