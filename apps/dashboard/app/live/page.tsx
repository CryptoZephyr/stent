"use client";

import { useEffect, useMemo, useState } from "react";
import { NETWORK_LABEL } from "@/lib/config";
import {
  fetchPayments,
  fetchAgentNames,
  subscribePayments,
  computeStats,
  computeLeaderboards,
  toActivity,
  isToday,
  isRecent,
  type PaymentRow,
} from "@/lib/economy";
import { StatsTiles } from "@/components/economy/StatsTiles";
import { ActivityFeed } from "@/components/economy/ActivityFeed";
import { Leaderboards } from "@/components/economy/Leaderboards";
import { LiveSkeleton } from "@/components/skeletons";

export default function LivePage() {
  const [rows, setRows] = useState<PaymentRow[] | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [err, setErr] = useState<string | null>(null);
  const [dataUnavailable, setDataUnavailable] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [, setTick] = useState(0); // re-render so relative timestamps stay fresh

  useEffect(() => {
    let active = true;
    const loadTimeout = setTimeout(() => {
      if (!active) return;
      setDataUnavailable(true);
      setErr("The live payment feed did not respond before the UI timeout.");
      setRows([]);
    }, 12000);

    (async () => {
      try {
        const r = await fetchPayments();
        const n = await fetchAgentNames(r.map((x) => x.agent_address));
        if (!active) return;
        clearTimeout(loadTimeout);
        setRows(r);
        setNames(n);
        setDataUnavailable(false);
      } catch (e) {
        clearTimeout(loadTimeout);
        if (active) {
          setDataUnavailable(true);
          setErr(e instanceof Error ? e.message : "Couldn't load the machine economy.");
          setRows([]);
        }
      }
    })();

    // New payments stream in live — prepend and briefly highlight.
    let unsub = () => {};
    try {
      unsub = subscribePayments((row) => {
        setRows((prev) => (prev ? [row, ...prev.filter((p) => p.id !== row.id)] : [row]));
        setDataUnavailable(false);
        setErr(null);
        setFlashId(row.id);
        setTimeout(() => setFlashId((cur) => (cur === row.id ? null : cur)), 1600);
      });
    } catch (e) {
      setDataUnavailable(true);
      setErr(e instanceof Error ? e.message : "Realtime feed unavailable.");
    }

    const ticker = setInterval(() => setTick((t) => t + 1), 8000);
    return () => {
      active = false;
      clearTimeout(loadTimeout);
      unsub();
      clearInterval(ticker);
    };
  }, []);

  const view = useMemo(() => {
    if (!rows) return null;
    const today = rows.filter((r) => isToday(r.created_at));
    return {
      all: computeStats(rows),
      today: computeStats(today),
      leaderboards: computeLeaderboards(rows, names),
      activity: toActivity(rows, names, 24),
    };
  }, [rows, names]);

  // Rows are newest-first; the feed only counts as "live" if the most recent
  // payment settled within LIVE_WINDOW_MS. The 8s ticker re-renders this so it
  // decays to "idle" on its own, and a realtime payment flips it back to live.
  const lastActivityAt = rows && rows.length ? rows[0].created_at : null;
  const liveNow = isRecent(lastActivityAt);

  return (
    <main className="economy-page">
      <header className="page-hero compact">
        <div>
          <p className="page-kicker">Machine economy — live</p>
          <h1>Watch machines pay machines.</h1>
          <p>
            Autonomous agents discover Stent APIs and pay per request in USDC. Every payment
            below is real and settled on {NETWORK_LABEL}.
          </p>
        </div>
        <div className="flow-network">
          <span className="dot" />
          {NETWORK_LABEL}
        </div>
      </header>

      {err && (
        <div className="notice err">
          <strong>Live data unavailable.</strong> {err}
        </div>
      )}
      {!dataUnavailable && !view && <LiveSkeleton />}
      {view && (
        <>
          <StatsTiles
            all={view.all}
            today={view.today}
            live={liveNow}
            lastActivityAt={lastActivityAt}
            unavailable={dataUnavailable}
          />
          <div className="eco-cols">
            <ActivityFeed
              items={view.activity}
              flashId={flashId}
              live={liveNow}
              lastActivityAt={lastActivityAt}
              unavailable={dataUnavailable}
            />
            <Leaderboards boards={view.leaderboards} unavailable={dataUnavailable} />
          </div>
        </>
      )}
    </main>
  );
}
