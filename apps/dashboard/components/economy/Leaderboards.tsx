import type { Leaderboards as LB, LeaderboardEntry } from "@/lib/economy";
import { formatUsdc, formatCount } from "./format";

function Board({
  title,
  entries,
  metric,
  unavailable = false,
}: {
  title: string;
  entries: LeaderboardEntry[];
  metric: "usdc" | "count";
  unavailable?: boolean;
}) {
  return (
    <div className="eco-board">
      <h4>{title}</h4>
      {unavailable ? (
        <p className="eco-empty sm">Live data unavailable</p>
      ) : entries.length === 0 ? (
        <p className="eco-empty sm">—</p>
      ) : (
        <ol className="eco-rank">
          {entries.map((e, i) => (
            <li key={e.key}>
              <span className="eco-rank-no">{i + 1}</span>
              <span className="eco-rank-label mono" title={e.key}>
                {e.label}
              </span>
              <span className="eco-rank-val">
                {metric === "usdc" ? formatUsdc(e.usdc) : `${formatCount(e.count)} calls`}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function Leaderboards({
  boards,
  unavailable = false,
}: {
  boards: LB;
  unavailable?: boolean;
}) {
  return (
    <section className="eco-panel">
      <div className="eco-panel-head">
        <h3>Leaderboards</h3>
      </div>
      <Board title="Top publishers" entries={boards.topPublishers} metric="usdc" unavailable={unavailable} />
      <Board title="Most active agents" entries={boards.topAgents} metric="count" unavailable={unavailable} />
      <Board title="Most popular APIs" entries={boards.topEndpoints} metric="count" unavailable={unavailable} />
    </section>
  );
}
