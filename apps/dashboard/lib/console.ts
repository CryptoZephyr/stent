/**
 * Agent Console data layer — reads real agent runs + lifecycle steps (emitted by
 * the demo agent into `agent_runs` / `agent_run_steps`) and threads them into the
 * Stent payment lifecycle: reasoning narrative interleaved with per-endpoint call
 * cards (selected → payment → response). Pure logic (`buildBlocks`) is separated
 * for testability; reads/Realtime use the shared public data client.
 */
import { dataSupabase } from "./supabaseData";

export type RunStatus = "running" | "complete" | "failed";
export type StepKind =
  | "reasoning"
  | "selected"
  | "payment"
  | "response"
  | "complete"
  | "blocked"
  | "error";

export interface AgentRun {
  id: string;
  created_at: string;
  agent_wallet: string;
  goal: string;
  status: RunStatus;
  total_spent_usdc: number | null;
  payment_count: number | null;
  finished_at: string | null;
}

export interface AgentStep {
  id: string;
  run_id: string;
  seq: number;
  created_at: string;
  kind: StepKind;
  title: string | null;
  detail: string | null;
  endpoint_slug: string | null;
  amount_usdc: number | null;
  tx_ref: string | null;
}

/** A run-level narrative entry (the agent thinking, finishing, or erroring). */
export interface NarrativeBlock {
  type: "narrative";
  kind: "reasoning" | "complete" | "error";
  seq: number;
  title: string | null;
  detail: string | null;
}

/** One endpoint interaction, threaded across its (possibly interleaved) steps. */
export interface CallBlock {
  type: "call";
  seq: number; // position of the `selected` (or first) step
  endpointSlug: string;
  selected?: AgentStep;
  payment?: AgentStep;
  response?: AgentStep;
  /** A terminal `blocked`/`error` carrying this endpoint slug. */
  outcome?: AgentStep;
}

export type ConsoleBlock = NarrativeBlock | CallBlock;

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

export function normalizeRun(raw: Record<string, unknown>): AgentRun {
  return {
    id: String(raw.id ?? ""),
    created_at: String(raw.created_at ?? ""),
    agent_wallet: String(raw.agent_wallet ?? "").toLowerCase(),
    goal: String(raw.goal ?? ""),
    status: (String(raw.status ?? "running") as RunStatus),
    total_spent_usdc: num(raw.total_spent_usdc),
    payment_count: raw.payment_count == null ? null : Number(raw.payment_count),
    finished_at: raw.finished_at ? String(raw.finished_at) : null,
  };
}

export function normalizeStep(raw: Record<string, unknown>): AgentStep {
  return {
    id: String(raw.id ?? ""),
    run_id: String(raw.run_id ?? ""),
    seq: Number(raw.seq ?? 0),
    created_at: String(raw.created_at ?? ""),
    kind: String(raw.kind ?? "reasoning") as StepKind,
    title: raw.title == null ? null : String(raw.title),
    detail: raw.detail == null ? null : String(raw.detail),
    endpoint_slug: raw.endpoint_slug == null ? null : String(raw.endpoint_slug),
    amount_usdc: num(raw.amount_usdc),
    tx_ref: raw.tx_ref == null ? null : String(raw.tx_ref),
  };
}

/**
 * Thread ordered steps into console blocks. `selected` opens a per-endpoint call
 * card; later `payment`/`response`/`blocked`/`error` steps carrying the same slug
 * attach to the most recent open card for that slug — so parallel tool calls
 * still render as clean, separate lifecycles. Reasoning / final / run-level error
 * steps become narrative blocks in place.
 */
export function buildBlocks(steps: AgentStep[]): ConsoleBlock[] {
  const ordered = [...steps].sort((a, b) => a.seq - b.seq);
  const blocks: ConsoleBlock[] = [];
  const openCallBySlug = new Map<string, CallBlock>();

  for (const s of ordered) {
    const slug = s.endpoint_slug ?? undefined;

    if (s.kind === "reasoning" || s.kind === "complete") {
      blocks.push({ type: "narrative", kind: s.kind, seq: s.seq, title: s.title, detail: s.detail });
      continue;
    }
    if (s.kind === "error" && !slug) {
      blocks.push({ type: "narrative", kind: "error", seq: s.seq, title: s.title, detail: s.detail });
      continue;
    }

    if (s.kind === "selected" && slug) {
      const block: CallBlock = { type: "call", seq: s.seq, endpointSlug: slug, selected: s };
      openCallBySlug.set(slug, block);
      blocks.push(block);
      continue;
    }

    // payment / response / blocked / error carrying a slug → attach to its card.
    if (slug) {
      let block = openCallBySlug.get(slug);
      if (!block) {
        block = { type: "call", seq: s.seq, endpointSlug: slug };
        openCallBySlug.set(slug, block);
        blocks.push(block);
      }
      if (s.kind === "payment") block.payment = s;
      else if (s.kind === "response") block.response = s;
      else block.outcome = s; // blocked | error with slug
      if (s.kind === "blocked" || s.kind === "error") openCallBySlug.delete(slug);
    }
  }

  return blocks;
}

// ── reads ────────────────────────────────────────────────────────────────────

const RUN_COLS = "id, created_at, agent_wallet, goal, status, total_spent_usdc, payment_count, finished_at";
const STEP_COLS = "id, run_id, seq, created_at, kind, title, detail, endpoint_slug, amount_usdc, tx_ref";

export async function fetchRecentRuns(limit = 10): Promise<AgentRun[]> {
  const { data, error } = await dataSupabase()
    .from("agent_runs")
    .select(RUN_COLS)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`fetchRecentRuns: ${error.message}`);
  return (data ?? []).map((r) => normalizeRun(r as Record<string, unknown>));
}

export async function fetchRunSteps(runId: string): Promise<AgentStep[]> {
  const { data, error } = await dataSupabase()
    .from("agent_run_steps")
    .select(STEP_COLS)
    .eq("run_id", runId)
    .order("seq", { ascending: true });
  if (error) throw new Error(`fetchRunSteps: ${error.message}`);
  return (data ?? []).map((s) => normalizeStep(s as Record<string, unknown>));
}

// ── realtime ─────────────────────────────────────────────────────────────────

/** Stream new steps for a specific run as the agent emits them. */
export function subscribeRunSteps(runId: string, onStep: (step: AgentStep) => void): () => void {
  const sb = dataSupabase();
  const channel = sb
    .channel(`console:steps:${runId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "agent_run_steps", filter: `run_id=eq.${runId}` },
      (payload) => onStep(normalizeStep(payload.new as Record<string, unknown>))
    )
    .subscribe();
  return () => {
    void sb.removeChannel(channel);
  };
}

/** Watch the run list for new runs (INSERT) and status changes (UPDATE). */
export function subscribeRuns(onChange: (run: AgentRun, event: "INSERT" | "UPDATE") => void): () => void {
  const sb = dataSupabase();
  const channel = sb
    .channel("console:runs")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "agent_runs" },
      (payload) => onChange(normalizeRun(payload.new as Record<string, unknown>), "INSERT")
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "agent_runs" },
      (payload) => onChange(normalizeRun(payload.new as Record<string, unknown>), "UPDATE")
    )
    .subscribe();
  return () => {
    void sb.removeChannel(channel);
  };
}
