import type { AgentRun } from "@/lib/console";
import { timeAgo } from "../economy/format";

export function RunList({
  runs,
  selectedId,
  onSelect,
}: {
  runs: AgentRun[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="con-runlist">
      <div className="con-runlist-head">Recent runs</div>
      {runs.length === 0 ? (
        <p className="con-empty sm">No agent runs yet.</p>
      ) : (
        <ul>
          {runs.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className={`con-runitem${r.id === selectedId ? " active" : ""}`}
                onClick={() => onSelect(r.id)}
              >
                <span className={`con-dot con-dot-${r.status}`} />
                <span className="con-runitem-goal">{r.goal}</span>
                <span className="con-runitem-time mono">{timeAgo(r.created_at)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
