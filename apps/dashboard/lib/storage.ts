/**
 * Local recovery for in-progress onboarding. The verification token is shown
 * once and the proxy never re-serves it, so we keep a copy on the device until
 * the endpoint is verified — letting a publisher resume after a refresh.
 *
 * Security: the token is a proof-of-control challenge, not a credential — it is
 * useless without also controlling the target origin, and nothing else sensitive
 * is stored. Only UNVERIFIED entries are kept, and they're cleared on success.
 */
const KEY = "stent.pending.v1";

export interface PendingReg {
  slug: string;
  verification_token: string;
  target_url: string;
  price_usdc: string;
  publisher_wallet: string;
}

function read(): PendingReg[] {
  if (typeof window === "undefined") return [];
  try {
    const arr = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(arr) ? arr.filter((p) => p?.slug && p?.verification_token) : [];
  } catch {
    return [];
  }
}

function write(list: PendingReg[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(-10)));
  } catch {
    /* storage disabled/full — recovery is best-effort, never fatal */
  }
}

export function listPending(): PendingReg[] {
  return read();
}

export function savePending(rec: PendingReg) {
  write([...read().filter((p) => p.slug !== rec.slug), rec]);
}

export function removePending(slug: string) {
  write(read().filter((p) => p.slug !== slug));
}
