/**
 * Agent Fleet data layer — an owner's agents + each agent's real payment history.
 *
 * Identity model (kept deliberately lightweight, no custody): the wallet you sign
 * in with IS the agent. Claiming names that wallet — `owner_wallet == agent_wallet`
 * — and the server enforces it from the verified session, so you can only
 * claim/edit the agent for the wallet you control. To run several agents, sign in
 * with several wallets. The schema keeps `owner_wallet` separate from
 * `agent_wallet`, so an owner→many-wallets model can be added later with no
 * migration. Reads are public (RLS); the write goes through the gated route.
 */
import { dataSupabase } from "./supabaseData";
import { auth } from "./auth";

export interface AgentProfile {
  agent_wallet: string;
  owner_wallet: string;
  name: string;
  description: string | null;
  created_at: string;
}

export interface AgentHistoryItem {
  id: string;
  created_at: string;
  endpoint_slug: string;
  amount_usdc: number;
}

export interface AgentHistory {
  items: AgentHistoryItem[];
  totalSpentUsdc: number;
  paymentCount: number;
  endpointsUsed: number;
}

/** Agents owned by `ownerWallet` (self-agent model → usually 0 or 1). */
export async function fetchMyAgents(ownerWallet: string): Promise<AgentProfile[]> {
  const { data, error } = await dataSupabase()
    .from("agents")
    .select("agent_wallet, owner_wallet, name, description, created_at")
    .eq("owner_wallet", ownerWallet.toLowerCase())
    .order("created_at", { ascending: true });
  if (error) throw new Error(`fetchMyAgents: ${error.message}`);
  return (data ?? []) as AgentProfile[];
}

/** Real payment history + rolled-up stats for one agent wallet. */
export async function fetchAgentHistory(agentWallet: string): Promise<AgentHistory> {
  const { data, error } = await dataSupabase()
    .from("payments")
    .select("id, created_at, endpoint_slug, amount_usdc")
    .eq("agent_address", agentWallet.toLowerCase())
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error(`fetchAgentHistory: ${error.message}`);
  const items: AgentHistoryItem[] = (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: String(row.id ?? ""),
      created_at: String(row.created_at ?? ""),
      endpoint_slug: String(row.endpoint_slug ?? ""),
      amount_usdc: Number(row.amount_usdc) || 0,
    };
  });
  const endpoints = new Set(items.map((i) => i.endpoint_slug));
  const total = items.reduce((s, i) => s + i.amount_usdc, 0);
  return {
    items,
    totalSpentUsdc: Math.round(total * 1e6) / 1e6,
    paymentCount: items.length,
    endpointsUsed: endpoints.size,
  };
}

/** Claim or rename the signed-in wallet's agent via the gated server route. */
export async function claimAgent(name: string, description: string): Promise<AgentProfile> {
  const token = await auth.getAccessToken();
  if (!token) throw new Error("Please sign in first.");
  const res = await fetch("/api/agents", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ name, description }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.detail || body?.error || "Couldn't save your agent.");
  }
  return body.agent as AgentProfile;
}
