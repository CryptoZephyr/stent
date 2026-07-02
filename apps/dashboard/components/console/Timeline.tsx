import type { ConsoleBlock, CallBlock } from "@/lib/console";
import { formatUsdc } from "../economy/format";

function txShort(tx: string): string {
  return tx.length > 18 ? `${tx.slice(0, 10)}…${tx.slice(-4)}` : tx;
}

function callState(b: CallBlock): "selected" | "paid" | "blocked" | "error" {
  if (b.outcome?.kind === "error") return "error";
  if (b.outcome?.kind === "blocked") return "blocked";
  if (b.payment) return "paid";
  return "selected";
}

function CallCard({ block }: { block: CallBlock }) {
  const state = callState(block);
  return (
    <div className={`con-call con-call-${state}`}>
      <div className="con-call-head">
        <span className="con-call-ep mono">{block.endpointSlug}</span>
        <span className={`con-pill con-pill-${state}`}>{state}</span>
      </div>
      <ol className="con-life">
        <li className="done">
          <span className="con-life-dot" />
          <span className="con-life-label">Selected</span>
          {block.selected?.detail && <span className="con-life-sub">{block.selected.detail}</span>}
        </li>
        {block.payment && (
          <li className="done">
            <span className="con-life-dot" />
            <span className="con-life-label">Paid {formatUsdc(block.payment.amount_usdc ?? 0)}</span>
            {block.payment.tx_ref && (
              <span className="con-life-sub mono">tx {txShort(block.payment.tx_ref)}</span>
            )}
          </li>
        )}
        {block.response && (
          <li className="done">
            <span className="con-life-dot" />
            <span className="con-life-label">Response received</span>
            {block.response.detail && (
              <details className="con-resp">
                <summary>view payload</summary>
                <pre>{block.response.detail}</pre>
              </details>
            )}
          </li>
        )}
        {block.outcome && (
          <li className="bad">
            <span className="con-life-dot" />
            <span className="con-life-label">
              {block.outcome.kind === "blocked" ? "Payment blocked" : "Error"}
            </span>
            {block.outcome.detail && <span className="con-life-sub">{block.outcome.detail}</span>}
          </li>
        )}
      </ol>
    </div>
  );
}

const NARRATIVE_LABEL: Record<string, string> = {
  reasoning: "Reasoning",
  complete: "Task complete",
  error: "Run failed",
};

export function Timeline({ blocks }: { blocks: ConsoleBlock[] }) {
  if (blocks.length === 0) {
    return <p className="con-empty">No steps yet — waiting for the agent to act…</p>;
  }
  return (
    <div className="con-timeline">
      {blocks.map((b, i) =>
        b.type === "narrative" ? (
          <div key={i} className={`con-narr con-narr-${b.kind}`}>
            <div className="con-narr-label">{NARRATIVE_LABEL[b.kind]}</div>
            {b.detail && <p className="con-narr-text">{b.detail}</p>}
          </div>
        ) : (
          <CallCard key={i} block={b} />
        )
      )}
    </div>
  );
}
