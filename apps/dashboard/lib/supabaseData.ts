/**
 * Shared, auth-disabled Supabase client for PUBLIC data reads and Realtime
 * (the Live Machine Economy: payments, agents, agent runs). It is deliberately
 * separate from the auth provider's client:
 *   - it never manages a session (persistSession / autoRefreshToken off), so it
 *     won't conflict with the auth client's GoTrueClient, and
 *   - keeping it out of `lib/auth/*` preserves the rule that only the auth
 *     provider touches the auth-scoped client (auth stays swappable).
 *
 * All access here is anon + public-read RLS — no privileged data passes through.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function dataSupabase(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error(
      "Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
    );
  }
  client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
