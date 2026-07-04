import { useRef } from "react";
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

function CallCard({
  block,
  enterClass = "",
  style,
}: {
  block: CallBlock;
  enterClass?: string;
  style?: React.CSSProperties;
}) {
  const state = callState(block);
  return (
    <div className={`con-call con-call-${state}${enterClass}`} style={style}>
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

/** How many just-arrived blocks still get a staggered entrance delay at once. */
const STAGGER_WINDOW = 6;

export function Timeline({ blocks }: { blocks: ConsoleBlock[] }) {
  // Blocks stream in over time (Realtime) but can also arrive as a full batch
  // on initial load. Either way, only blocks new to this render pass get an
  // entrance animation + stagger delay; blocks already on screen (identified
  // by their stable `seq`) must not replay it as later blocks are appended.
  const enteredRef = useRef<Set<number>>(new Set());
  const entered = enteredRef.current;
  const freshSeqs: number[] = [];
  for (const b of blocks) {
    if (!entered.has(b.seq)) freshSeqs.push(b.seq);
  }
  const staggerIndex = new Map<number, number>();
  freshSeqs.slice(-STAGGER_WINDOW).forEach((seq, idx) => staggerIndex.set(seq, idx));
  for (const seq of freshSeqs) entered.add(seq);

  if (blocks.length === 0) {
    return <p className="con-empty con-empty-pulse">No steps yet — waiting for the agent to act…</p>;
  }
  return (
    <div className="con-timeline">
      {blocks.map((b, i) => {
        const stagger = staggerIndex.get(b.seq);
        const style = stagger != null ? ({ "--con-stagger": stagger } as React.CSSProperties) : undefined;
        const enterClass = stagger != null ? " con-enter" : "";
        return b.type === "narrative" ? (
          <div key={i} className={`con-narr con-narr-${b.kind}${enterClass}`} style={style}>
            <div className="con-narr-label">{NARRATIVE_LABEL[b.kind]}</div>
            {b.detail && <p className="con-narr-text">{b.detail}</p>}
          </div>
        ) : (
          <CallCard key={i} block={b} enterClass={enterClass} style={style} />
        );
      })}
    </div>
  );
}
