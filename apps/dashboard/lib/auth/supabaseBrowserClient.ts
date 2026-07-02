/**
 * Lazily-constructed Supabase browser client. Imported ONLY by the Supabase
 * provider — no app code touches this directly, so the provider stays the single
 * place that knows about Supabase. `createClient` is invoked lazily (inside the
 * getter) so this module is safe to import from isomorphic code; nothing touches
 * browser storage until a client method actually runs.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function browserSupabase(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error(
      "Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
    );
  }
  client = createClient(url, anon, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return client;
}
