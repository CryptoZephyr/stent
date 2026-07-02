import type { ActivityItem } from "@/lib/economy";
import { formatUsdc, timeAgo } from "./format";

export function ActivityFeed({
  items,
  flashId,
  live = true,
  lastActivityAt = null,
  unavailable = false,
}: {
  items: ActivityItem[];
  flashId: string | null;
  live?: boolean;
  lastActivityAt?: string | null;
  unavailable?: boolean;
}) {
  return (
    <section className="eco-panel">
      <div className="eco-panel-head">
        <h3>{live && !unavailable ? "Live activity" : "Recent activity"}</h3>
        <span className={`eco-live${live && !unavailable ? "" : " off"}`}>
          <span className="dot" />{" "}
          {unavailable
            ? "unavailable"
            : live
              ? "streaming"
              : lastActivityAt
                ? `last ${timeAgo(lastActivityAt)}`
                : "idle"}
        </span>
      </div>
      {unavailable ? (
        <p className="eco-empty">
          Live data unavailable. The feed could not connect to Supabase, so no activity is shown.
        </p>
      ) : items.length === 0 ? (
        <p className="eco-empty">
          No payments yet. When an agent pays for an API, it appears here in real time.
        </p>
      ) : (
        <ul className="eco-feed">
          {items.map((it) => (
            <li key={it.id} className={`eco-feed-row${flashId === it.id ? " fresh" : ""}`}>
              <span className="eco-feed-icon" aria-hidden>
                ◈
              </span>
              <div className="eco-feed-main">
                <div className="eco-feed-line">
                  <span className="eco-agent mono" title={it.agentAddress}>
                    {it.agentLabel}
                  </span>
                  <span className="eco-arrow" aria-hidden>
                    →
                  </span>
                  <span className="eco-ep mono">{it.endpointSlug}</span>
                </div>
                <div className="eco-feed-sub mono">{timeAgo(it.at)}</div>
              </div>
              <span className="eco-amt">+{formatUsdc(it.amountUsdc)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
