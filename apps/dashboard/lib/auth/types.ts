/**
 * Provider-agnostic auth contract.
 *
 * The whole app and database know exactly one thing about identity: a wallet
 * address. The auth *provider* (Supabase Web3 today, Privy later) only has to
 * prove "this session controls wallet X" — nothing provider-specific is allowed
 * to leak past this boundary. Swapping providers = swap the binding in
 * `index.ts`; no component or schema changes.
 */

/** The only identity shape the app consumes. Never a provider user object. */
export interface Session {
  /** Lowercased EVM address — the single identity primitive. */
  wallet: string;
  /** Session expiry as epoch seconds, when the provider exposes it. */
  expiresAt?: number;
}

/** Browser-side surface — drives sign-in UX and ownership-aware reads. */
export interface AuthClient {
  /** Run the wallet sign-in handshake; resolves to the authenticated session. */
  signIn(): Promise<Session>;
  /** Clear the session locally. */
  signOut(): Promise<void>;
  /** Current session, or null if signed out. */
  getSession(): Promise<Session | null>;
  /** Synchronous convenience accessor for the last-known wallet, or null. */
  getWallet(): string | null;
  /**
   * Opaque bearer token for authorizing calls to our own server routes, or null
   * if signed out. The server validates it via {@link AuthServer.verifyRequest};
   * its format is provider-internal and never inspected by app code.
   */
  getAccessToken(): Promise<string | null>;
}

/** Server-side surface — gates secure writes in route handlers. */
export interface AuthServer {
  /** Verify a request's bearer token; resolves to its session or null. */
  verifyRequest(req: Request): Promise<Session | null>;
}
