/** Display formatting for the Live Machine Economy. */

/** Format a USDC amount with up to 6 decimals, trimming trailing zeros. */
export function formatUsdc(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "$0.00";
  let s = n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  if (!s.includes(".")) s += ".00"; // whole dollars keep cents
  return "$" + s;
}

/** Compact integer (e.g. 1234 → "1,234"). */
export function formatCount(n: number): string {
  return Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "0";
}

/** Relative "time ago" from an ISO timestamp. */
export function timeAgo(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
