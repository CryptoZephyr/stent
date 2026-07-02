import type { AgentRun } from "@/lib/console";
import { shortAddr } from "@/lib/wallet";
import { formatUsdc, timeAgo } from "../economy/format";

export function RunHeader({ run }: { run: AgentRun }) {
  return (
    <div className="con-runhead">
      <div className="con-runhead-top">
        <span className={`con-status con-status-${run.status}`}>
          <span className="dot" />
          {run.status}
        </span>
        <span className="con-runtime mono">{timeAgo(run.created_at)}</span>
      </div>
      <div className="con-goal-label">Goal</div>
      <p className="con-goal">{run.goal}</p>
      <div className="con-runmeta">
        <span className="mono" title={run.agent_wallet}>
          agent {shortAddr(run.agent_wallet)}
        </span>
        {run.payment_count != null && <span className="mono">{run.payment_count} payments</span>}
        {run.total_spent_usdc != null && (
          <span className="mono">{formatUsdc(run.total_spent_usdc)} spent</span>
        )}
      </div>
    </div>
  );
}
