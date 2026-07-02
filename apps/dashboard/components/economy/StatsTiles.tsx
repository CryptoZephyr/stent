import type { EconomyStats } from "@/lib/economy";
import { formatUsdc, formatCount, timeAgo } from "./format";

const TILES: { key: keyof EconomyStats; label: string; money?: boolean }[] = [
  { key: "payments", label: "Payments" },
  { key: "usdcSettled", label: "USDC settled", money: true },
  { key: "activeAgents", label: "Agents" },
  { key: "publishers", label: "Publishers" },
  { key: "endpointsCalled", label: "APIs called" },
];

const fmt = (v: number, money?: boolean) => (money ? formatUsdc(v) : formatCount(v));

export function StatsTiles({
  all,
  today,
  live = true,
  lastActivityAt = null,
  unavailable = false,
}: {
  all: EconomyStats;
  today: EconomyStats;
  live?: boolean;
  lastActivityAt?: string | null;
  unavailable?: boolean;
}) {
  return (
    <section className="eco-stats">
      <div className="eco-stats-head">
        <h2>Today’s machine economy</h2>
        <span className={`eco-live${live && !unavailable ? "" : " off"}`}>
          <span className="dot" />{" "}
          {unavailable
            ? "offline"
            : live
              ? "live"
              : lastActivityAt
                ? `last settled ${timeAgo(lastActivityAt)}`
                : "idle"}
        </span>
      </div>
      {unavailable && (
        <div className="notice step eco-unavailable">
          Live data is unavailable right now. Metrics refresh automatically as soon as the feed
          reconnects — nothing here is simulated.
        </div>
      )}
      <div className="eco-tiles">
        {TILES.map((t) => (
          <div className="eco-tile" key={t.key}>
            <div className={`eco-tile-v${t.money ? " money" : ""}`}>
              {unavailable ? "—" : fmt(today[t.key], t.money)}
            </div>
            <div className="eco-tile-k">{t.label}</div>
            <div className="eco-tile-all">
              {unavailable ? "Live data unavailable" : `${fmt(all[t.key], t.money)} all-time`}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
