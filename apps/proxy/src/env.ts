import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";

// Load the monorepo-root .env regardless of where the process is started.
loadDotenv({ path: resolve(__dirname, "../../../.env") });

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const env = {
  port: Number(process.env.PORT ?? 8080),

  supabaseUrl: required("SUPABASE_URL"),
  supabaseServiceKey: required("SUPABASE_SERVICE_ROLE_KEY"),

  // Testnet facilitator. The SDK default is MAINNET, so we MUST set this.
  facilitatorUrl:
    process.env.GATEWAY_FACILITATOR_URL ?? "https://gateway-api-testnet.circle.com",

  // CAIP-2 network the proxy accepts payment on (Arc testnet).
  network: process.env.ARC_CAIP2 ?? "eip155:5042002",

  // Upstream reachability probe timeout (ms).
  upstreamHealthTimeoutMs: Number(process.env.UPSTREAM_HEALTH_TIMEOUT_MS ?? 4000),

  // How often to fully refresh the endpoint cache from Supabase (ms).
  cacheRefreshMs: Number(process.env.CACHE_REFRESH_MS ?? 60_000),
} as const;
