"use client";

import type { AgentProfile, AgentHistory } from "@/lib/fleet";
import { shortAddr } from "@/lib/wallet";
import { formatUsdc, formatCount, timeAgo } from "@/components/economy/format";
import { InlineCopy } from "@/components/ui";

export function AgentPanel({
  agent,
  history,
  onEdit,
}: {
  agent: AgentProfile;
  history: AgentHistory | null;
  onEdit: () => void;
}) {
  return (
    <div className="card">
      <div className="fleet-head">
        <div className="fleet-id">
          <span className="fleet-avatar" aria-hidden>
            <span className="fleet-avatar-dot" />
          </span>
          <div>
            <p className="step-eyebrow" style={{ margin: 0 }}>
              Your agent
            </p>
            <h2 style={{ margin: "2px 0 0" }}>{agent.name}</h2>
          </div>
        </div>
        <button className="btn btn-ghost" onClick={onEdit}>
          Edit
        </button>
      </div>
      {agent.description && <p className="lede" style={{ marginBottom: 18 }}>{agent.description}</p>}

      <InlineCopy value={agent.agent_wallet} />

      <div className="fleet-stats">
        <div className="fleet-stat">
          <div className="fleet-stat-v">{history ? formatCount(history.paymentCount) : "—"}</div>
          <div className="fleet-stat-k">Payments</div>
        </div>
        <div className="fleet-stat">
          <div className="fleet-stat-v">{history ? formatUsdc(history.totalSpentUsdc) : "—"}</div>
          <div className="fleet-stat-k">Total spent</div>
        </div>
        <div className="fleet-stat">
          <div className="fleet-stat-v">{history ? formatCount(history.endpointsUsed) : "—"}</div>
          <div className="fleet-stat-k">APIs used</div>
        </div>
      </div>

      <p className="step-eyebrow" style={{ marginTop: 22 }}>
        Recent activity
      </p>
      {!history ? (
        <p className="hint">Loading history…</p>
      ) : history.items.length === 0 ? (
        <p className="hint">
          No payments yet. Point this wallet at a Stent endpoint and its calls will appear here.
        </p>
      ) : (
        <ul className="fleet-feed">
          {history.items.slice(0, 25).map((it) => (
            <li key={it.id} className="fleet-feed-row">
              <span className="eco-ep mono">{it.endpoint_slug}</span>
              <span className="eco-amt">{formatUsdc(it.amount_usdc)}</span>
              <span className="eco-time">{timeAgo(it.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
