// The live Stent proxy the dashboard talks to. Override per-env if needed.
export const PROXY_URL =
  process.env.NEXT_PUBLIC_PROXY_URL ?? "https://stentproxy-production.up.railway.app";

export const NETWORK_LABEL = "Arc testnet";
