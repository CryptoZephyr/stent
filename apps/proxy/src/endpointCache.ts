import { supabase, type EndpointConfig } from "./supabaseClient";
import { env } from "./env";

/**
 * In-memory cache of live endpoint configs.
 *
 * Invariants (system_design.md §5 — "No stale configs served"):
 *  - Only `active = true AND verified = true` endpoints are ever cached/served.
 *  - Full refresh every `cacheRefreshMs` (hard TTL ceiling of 60s).
 *  - Realtime subscription invalidates immediately on ANY change to `endpoints`,
 *    so updates propagate well within 1s rather than waiting for the TTL.
 */
class EndpointCache {
  private bySlug = new Map<string, EndpointConfig>();
  private refreshTimer: NodeJS.Timeout | null = null;

  /** Listeners notified when a specific slug's config changes (or is removed). */
  private invalidationListeners = new Set<(slug: string) => void>();

  async start(): Promise<void> {
    await this.refresh();
    this.refreshTimer = setInterval(() => {
      void this.refresh();
    }, env.cacheRefreshMs);

    // Realtime CDC: any insert/update/delete on endpoints triggers a refresh
    // and per-slug invalidation so cached gateway middlewares are rebuilt.
    supabase
      .channel("endpoints-cdc")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "endpoints" },
        (payload) => {
          const changed =
            (payload.new as { slug?: string } | null)?.slug ??
            (payload.old as { slug?: string } | null)?.slug;
          if (changed) this.notifyInvalidation(changed);
          void this.refresh();
        }
      )
      .subscribe();
  }

  stop(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  async refresh(): Promise<void> {
    const { data, error } = await supabase
      .from("endpoints")
      .select(
        "slug, publisher_wallet, price_usdc, target_url, description, rate_limit_rpm, agent_limit_rpm, verified, active"
      )
      .eq("active", true)
      .eq("verified", true);

    if (error) {
      console.error("[endpointCache] refresh failed:", error.message);
      return; // keep serving last-known-good rather than dropping all endpoints
    }

    const next = new Map<string, EndpointConfig>();
    for (const row of (data ?? []) as EndpointConfig[]) next.set(row.slug, row);
    this.bySlug = next;
  }

  get(slug: string): EndpointConfig | undefined {
    return this.bySlug.get(slug);
  }

  onInvalidate(listener: (slug: string) => void): void {
    this.invalidationListeners.add(listener);
  }

  private notifyInvalidation(slug: string): void {
    for (const l of this.invalidationListeners) l(slug);
  }
}

export const endpointCache = new EndpointCache();
