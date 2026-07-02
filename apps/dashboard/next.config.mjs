const isDev = process.env.NODE_ENV !== "production";

/*
 * Content-Security-Policy, tuned to exactly what this app talks to:
 * - script-src 'unsafe-inline': required by Next's bootstrap inline scripts
 *   (there is no nonce infrastructure here). 'unsafe-eval' is DEV ONLY, for
 *   React Refresh / eval source maps.
 * - style-src 'unsafe-inline': required for React style={} attributes, plus
 *   the Google Fonts stylesheet; font files come from fonts.gstatic.com.
 * - connect-src: Supabase REST + Realtime websocket (wildcard covers the
 *   project subdomain) and the Stent proxy on Railway. If the proxy or
 *   Supabase moves to a custom domain, ADD IT HERE or the dashboard's data
 *   fetching will be blocked. localhost entries are dev only.
 * - frame-ancestors 'none' (+ X-Frame-Options DENY): a wallet-connected app
 *   must never render inside someone else's iframe.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.up.railway.app${
    isDev ? " http://localhost:* ws://localhost:* http://127.0.0.1:* ws://127.0.0.1:*" : ""
  }`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
