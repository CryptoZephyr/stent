/**
 * Live Machine Economy data layer — pure logic + thin Supabase reads, no UI.
 *
 * Everything here is derived from REAL rows in `payments` (enriched with claimed
 * `agents` names). Stats and leaderboards are aggregated client-side over a
 * bounded fetch — fine at hackathon volume; if the ledger ever grows past a few
 * thousand rows, swap `getEconomySnapshot` for a Postgres view/RPC without
 * touching callers. No metric is fabricated: if there are no payments, the
 * numbers are zero.
 */
import { dataSupabase } from "./supabaseData";
import { shortAddr } from "./wallet";

/** Max payment rows pulled for client-side aggregation. */
export const PAYMENTS_CAP = 1000;
/** Default lengths for the activity feed and leaderboards. */
export const ACTIVITY_LIMIT = 20;
export const LEADERBOARD_LIMIT = 5;

export interface PaymentRow {
  id: string;
  created_at: string;
  endpoint_slug: string;
  publisher_wallet: string;
  agent_address: string;
  amount_usdc: number;
}

export interface EconomyStats {
  payments: number;
  usdcSettled: number;
  activeAgents: number;
  publishers: number;
  endpointsCalled: number;
}

export interface LeaderboardEntry {
  /** Stable key (wallet address or slug). */
  key: string;
  /** Display label (agent name if claimed, else short address, or slug). */
  label: string;
  count: number;
  usdc: number;
}

export interface Leaderboards {
  topPublishers: LeaderboardEntry[];
  topAgents: LeaderboardEntry[];
  topEndpoints: LeaderboardEntry[];
}

export interface ActivityItem {
  id: string;
  at: string;
  agentAddress: string;
  agentLabel: string;
  endpointSlug: string;
  amountUsdc: number;
}

export interface EconomySnapshot {
  all: EconomyStats;
  today: EconomyStats;
  leaderboards: Leaderboards;
  activity: ActivityItem[];
}

// ── normalization ────────────────────────────────────────────────────────────

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Coerce a raw payments row (PostgREST may stringify numerics) into PaymentRow. */
export function normalizePayment(raw: Record<string, unknown>): PaymentRow {
  return {
    id: String(raw.id ?? ""),
    created_at: String(raw.created_at ?? ""),
    endpoint_slug: String(raw.endpoint_slug ?? ""),
    publisher_wallet: String(raw.publisher_wallet ?? "").toLowerCase(),
    agent_address: String(raw.agent_address ?? "").toLowerCase(),
    amount_usdc: num(raw.amount_usdc),
  };
}

function startOfTodayUtcMs(): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function isToday(iso: string): boolean {
  const t = Date.parse(iso);
  return Number.isFinite(t) && t >= startOfTodayUtcMs();
}

/** How recently a payment must have settled for the feed to count as "live". */
export const LIVE_WINDOW_MS = 5 * 60_000;

/** True when `iso` is within `withinMs` of now — used to gate "live"/"streaming" badges. */
export function isRecent(iso: string | null | undefined, withinMs = LIVE_WINDOW_MS): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && Date.now() - t <= withinMs;
}

// ── pure aggregation ─────────────────────────────────────────────────────────

export function computeStats(rows: PaymentRow[]): EconomyStats {
  const agents = new Set<string>();
  const publishers = new Set<string>();
  const endpoints = new Set<string>();
  let usdc = 0;
  for (const r of rows) {
    agents.add(r.agent_address);
    publishers.add(r.publisher_wallet);
    endpoints.add(r.endpoint_slug);
    usdc += r.amount_usdc;
  }
  return {
    payments: rows.length,
    // Round to USDC's 6 decimals to avoid float drift in the displayed total.
    usdcSettled: Math.round(usdc * 1e6) / 1e6,
    activeAgents: agents.size,
    publishers: publishers.size,
    endpointsCalled: endpoints.size,
  };
}

interface Group {
  count: number;
  usdc: number;
}

function groupBy(rows: PaymentRow[], keyOf: (r: PaymentRow) => string): Map<string, Group> {
  const m = new Map<string, Group>();
  for (const r of rows) {
    const k = keyOf(r);
    const g = m.get(k) ?? { count: 0, usdc: 0 };
    g.count += 1;
    g.usdc += r.amount_usdc;
    m.set(k, g);
  }
  return m;
}

function topN(
  groups: Map<string, Group>,
  label: (key: string) => string,
  sortBy: "usdc" | "count",
  limit = LEADERBOARD_LIMIT
): LeaderboardEntry[] {
  return [...groups.entries()]
    .map(([key, g]) => ({ key, label: label(key), count: g.count, usdc: Math.round(g.usdc * 1e6) / 1e6 }))
    .sort((a, b) => (sortBy === "usdc" ? b.usdc - a.usdc || b.count - a.count : b.count - a.count || b.usdc - a.usdc))
    .slice(0, limit);
}

export function computeLeaderboards(rows: PaymentRow[], agentNames: Map<string, string>): Leaderboards {
  const agentLabel = (wallet: string) => agentNames.get(wallet) ?? shortAddr(wallet);
  return {
    topPublishers: topN(groupBy(rows, (r) => r.publisher_wallet), (w) => shortAddr(w), "usdc"),
    topAgents: topN(groupBy(rows, (r) => r.agent_address), agentLabel, "count"),
    topEndpoints: topN(groupBy(rows, (r) => r.endpoint_slug), (s) => s, "count"),
  };
}

export interface EndpointStats {
  calls: number;
  lastActiveAt: string | null;
}

/**
 * Per-endpoint call count + most recent activity, computed from an already
 * -fetched, newest-first payments array (no extra query — same rows `/live`
 * and the landing page already pull).
 */
export function endpointStatsBySlug(rows: PaymentRow[]): Map<string, EndpointStats> {
  const m = new Map<string, EndpointStats>();
  for (const r of rows) {
    const s = m.get(r.endpoint_slug);
    if (s) s.calls += 1;
    else m.set(r.endpoint_slug, { calls: 1, lastActiveAt: r.created_at });
  }
  return m;
}

export interface PublisherEndpointEarnings {
  slug: string;
  usdc: number;
  calls: number;
  lastActiveAt: string | null;
}

/**
 * Per-endpoint earnings for one publisher wallet, computed from an
 * already-fetched, newest-first payments array — the same public rows the
 * leaderboards already aggregate, just scoped to one publisher and one
 * endpoint at a time instead of ranked across everyone.
 */
export function publisherEarningsBySlug(
  rows: PaymentRow[],
  publisherWallet: string
): Map<string, PublisherEndpointEarnings> {
  const wallet = publisherWallet.toLowerCase();
  const m = new Map<string, PublisherEndpointEarnings>();
  for (const r of rows) {
    if (r.publisher_wallet !== wallet) continue;
    const e = m.get(r.endpoint_slug);
    if (e) {
      e.calls += 1;
      e.usdc = Math.round((e.usdc + r.amount_usdc) * 1e6) / 1e6;
    } else {
      m.set(r.endpoint_slug, { slug: r.endpoint_slug, usdc: r.amount_usdc, calls: 1, lastActiveAt: r.created_at });
    }
  }
  return m;
}

export function toActivity(
  rows: PaymentRow[],
  agentNames: Map<string, string>,
  limit = ACTIVITY_LIMIT
): ActivityItem[] {
  return rows.slice(0, limit).map((r) => ({
    id: r.id,
    at: r.created_at,
    agentAddress: r.agent_address,
    agentLabel: agentNames.get(r.agent_address) ?? shortAddr(r.agent_address),
    endpointSlug: r.endpoint_slug,
    amountUsdc: r.amount_usdc,
  }));
}

// ── reads ────────────────────────────────────────────────────────────────────

/** Most recent payments (newest first), bounded by `limit`. */
export async function fetchPayments(limit = PAYMENTS_CAP): Promise<PaymentRow[]> {
  const { data, error } = await dataSupabase()
    .from("payments")
    .select("id, created_at, endpoint_slug, publisher_wallet, agent_address, amount_usdc")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`fetchPayments: ${error.message}`);
  return (data ?? []).map((r) => normalizePayment(r as Record<string, unknown>));
}

/** Map of agent_wallet → display name, for the agent wallets present in `wallets`. */
export async function fetchAgentNames(wallets: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(wallets.map((w) => w.toLowerCase()))];
  const names = new Map<string, string>();
  if (unique.length === 0) return names;
  const { data, error } = await dataSupabase()
    .from("agents")
    .select("agent_wallet, name")
    .in("agent_wallet", unique);
  if (error) throw new Error(`fetchAgentNames: ${error.message}`);
  for (const row of data ?? []) {
    const w = String((row as { agent_wallet: string }).agent_wallet).toLowerCase();
    const n = (row as { name?: string }).name;
    if (n) names.set(w, n);
  }
  return names;
}

/** One round-trip snapshot: stats (all-time + today), leaderboards, activity. */
export async function getEconomySnapshot(): Promise<EconomySnapshot> {
  const rows = await fetchPayments();
  const names = await fetchAgentNames(rows.map((r) => r.agent_address));
  const todayRows = rows.filter((r) => isToday(r.created_at));
  return {
    all: computeStats(rows),
    today: computeStats(todayRows),
    leaderboards: computeLeaderboards(rows, names),
    activity: toActivity(rows, names),
  };
}

// ── realtime ─────────────────────────────────────────────────────────────────

/**
 * Subscribe to new payments as they settle. Calls `onInsert` with each new row;
 * returns an unsubscribe function. The caller re-aggregates (cheap) or prepends
 * to the activity feed.
 */
export function subscribePayments(onInsert: (row: PaymentRow) => void): () => void {
  const sb = dataSupabase();
  const channel = sb
    .channel("economy:payments")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "payments" },
      (payload) => onInsert(normalizePayment(payload.new as Record<string, unknown>))
    )
    .subscribe();
  return () => {
    void sb.removeChannel(channel);
  };
}
