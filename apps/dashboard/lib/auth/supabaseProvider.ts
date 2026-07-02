/**
 * Supabase Web3 (Sign-In-With-Ethereum) implementation of the auth contract.
 *
 * This file is the ONLY place that knows Supabase exists. Everything it exposes
 * is in terms of `Session { wallet }`. A future Privy provider implements the
 * same `AuthClient & AuthServer` and the rest of the app/DB is untouched.
 *
 * Verified against @supabase/auth-js@2.108.2: `auth.signInWithWeb3({ chain:
 * 'ethereum' })` performs the full SIWE handshake (eth_requestAccounts → build
 * EIP-4361 message → personal_sign → POST /token?grant_type=web3) and returns a
 * standard `{ session, user }`. The wallet address is recovered from the user's
 * identity data — see `extractWallet`.
 */
import { createClient, type User } from "@supabase/supabase-js";
import type { AuthClient, AuthServer, Session } from "./types";
import { browserSupabase } from "./supabaseBrowserClient";

/** One-line statement shown in the wallet sign prompt (no newlines allowed). */
const SIWE_STATEMENT = "Sign in to Stent to manage your endpoints and agents.";

// Matches a 40-hex EVM address anywhere in a string (e.g. the bare address, or
// the identity id "web3:ethereum:0xAbc…"). Verified against a live Supabase Web3
// sign-in: the address is exposed at identity_data.custom_claims.address and the
// identity id/sub is "web3:ethereum:<checksumAddress>".
const ADDR_SUBSTR = /0x[a-fA-F0-9]{40}/;

/** Last-known wallet, kept fresh by the auth-state listener for `getWallet()`. */
let cachedWallet: string | null = null;
let listenerBound = false;

/** First 40-hex address found in a metadata bag (recursing into nested objects
 *  like `custom_claims`). Scoped to the bags we pass in — never the whole user. */
function findAddress(value: unknown, depth = 0): string | null {
  if (typeof value === "string") {
    const m = value.match(ADDR_SUBSTR);
    return m ? m[0].toLowerCase() : null;
  }
  if (value && typeof value === "object" && depth < 4) {
    const obj = value as Record<string, unknown>;
    // Prefer an explicit address claim before scanning everything else.
    const claim = (obj.custom_claims as Record<string, unknown> | undefined)?.address ?? obj.address;
    if (typeof claim === "string") {
      const m = claim.match(ADDR_SUBSTR);
      if (m) return m[0].toLowerCase();
    }
    for (const v of Object.values(obj)) {
      const found = findAddress(v, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Resolve the wallet address from a Supabase Web3 user. The address lives at
 * `identities[].identity_data.custom_claims.address` (confirmed live), with the
 * identity id "web3:ethereum:<address>" and `user_metadata` as fallbacks. Never
 * uses `user.id` — that's a Supabase UUID, and ownership must stay keyed on the
 * wallet, not the provider.
 */
export function extractWallet(user: User | null | undefined): string | null {
  if (!user) return null;
  const fromIdentity = user.identities
    ?.map((i) => findAddress(i.identity_data) ?? findAddress(i.id))
    .find((a): a is string => !!a);
  return fromIdentity ?? findAddress(user.user_metadata) ?? null;
}

export const supabaseAuth: AuthClient & AuthServer = {
  async signIn(): Promise<Session> {
    if (typeof window === "undefined") throw new Error("signIn must run in the browser");
    if (!(window as unknown as { ethereum?: unknown }).ethereum) throw new Error("no_wallet");

    const sb = browserSupabase();
    ensureListener();

    // wallet defaults to window.ethereum; the SDK builds + signs the SIWE message.
    const { data, error } = await sb.auth.signInWithWeb3({
      chain: "ethereum",
      statement: SIWE_STATEMENT,
    });
    if (error) throw new Error(error.message);

    const wallet = extractWallet(data.user);
    if (!wallet) throw new Error("Signed in, but no wallet address was found on the session.");
    cachedWallet = wallet;
    return { wallet, expiresAt: data.session?.expires_at };
  },

  async signOut(): Promise<void> {
    await browserSupabase().auth.signOut();
    cachedWallet = null;
  },

  async getSession(): Promise<Session | null> {
    const sb = browserSupabase();
    ensureListener();
    const { data } = await sb.auth.getSession();
    if (!data.session) {
      cachedWallet = null;
      return null;
    }
    const wallet = extractWallet(data.session.user);
    cachedWallet = wallet;
    return wallet ? { wallet, expiresAt: data.session.expires_at } : null;
  },

  getWallet(): string | null {
    return cachedWallet;
  },

  async getAccessToken(): Promise<string | null> {
    const { data } = await browserSupabase().auth.getSession();
    return data.session?.access_token ?? null;
  },

  async verifyRequest(req: Request): Promise<Session | null> {
    const header = req.headers.get("authorization") ?? "";
    const token = /^bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
    if (!token) return null;

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) throw new Error("Supabase is not configured (URL / anon key).");

    // Stateless client purely to validate the bearer token against the auth server.
    const sb = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await sb.auth.getUser(token);
    if (error || !data.user) return null;
    const wallet = extractWallet(data.user);
    return wallet ? { wallet } : null;
  },
};

/** Keep `cachedWallet` in sync with session changes for the sync `getWallet()`. */
function ensureListener(): void {
  if (listenerBound) return;
  listenerBound = true;
  browserSupabase().auth.onAuthStateChange((_event, session) => {
    cachedWallet = session ? extractWallet(session.user) : null;
  });
}
