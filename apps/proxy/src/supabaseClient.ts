import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

/**
 * Service-role Supabase client. Bypasses RLS — used only server-side by the
 * proxy for reading endpoint configs and writing the authoritative payment log.
 */
export const supabase = createClient(env.supabaseUrl, env.supabaseServiceKey, {
  auth: { persistSession: false },
});

export interface EndpointConfig {
  slug: string;
  publisher_wallet: string;
  price_usdc: string;
  target_url: string;
  description: string | null;
  rate_limit_rpm: number;
  agent_limit_rpm: number;
  verified: boolean;
  active: boolean;
}
