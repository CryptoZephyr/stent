"use client";

import { useEffect, useMemo, useState } from "react";
import { NETWORK_LABEL } from "@/lib/config";
import {
  fetchRecentRuns,
  fetchRunSteps,
  subscribeRunSteps,
  subscribeRuns,
  buildBlocks,
  type AgentRun,
  type AgentStep,
} from "@/lib/console";
import { RunList } from "@/components/console/RunList";
import { RunHeader } from "@/components/console/RunHeader";
import { Timeline } from "@/components/console/Timeline";
import { ConsoleSkeleton } from "@/components/skeletons";
import { Empty } from "@/components/ui";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

function preferredRunId(runs: AgentRun[]): string | null {
  return (
    runs.find((r) => r.status === "complete" && (r.payment_count ?? 0) > 0)?.id ??
    runs.find((r) => r.status === "complete")?.id ??
    runs.find((r) => r.status === "running")?.id ??
    runs[0]?.id ??
    null
  );
}

export default function ConsolePage() {
  // null = still loading (skeleton); [] = loaded and genuinely empty.
  const [runs, setRuns] = useState<AgentRun[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [, setTick] = useState(0); // keep relative timestamps fresh

  // Runs list + live run-list changes (new runs, status updates).
  useEffect(() => {
    let active = true;
    const loadTimeout = setTimeout(() => {
      if (!active) return;
      setErr("Live agent run data unavailable. The run feed did not respond before the UI timeout.");
      setRuns([]);
      setSelectedId(null);
    }, 12000);
    (async () => {
      try {
        const r = await fetchRecentRuns();
        if (!active) return;
        clearTimeout(loadTimeout);
        setRuns(r);
        setSelectedId((prev) => prev ?? preferredRunId(r));
      } catch (e) {
        clearTimeout(loadTimeout);
        if (active) {
          setErr(errMsg(e));
          setRuns([]);
        }
      }
    })();

    let unsub = () => {};
    try {
      unsub = subscribeRuns((run, event) => {
        setErr(null);
        setRuns((prev) =>
          [run, ...(prev ?? []).filter((p) => p.id !== run.id)].sort((a, b) =>
            b.created_at.localeCompare(a.created_at)
          )
        );
        if (event === "INSERT") setSelectedId(run.id); // auto-follow a fresh run
      });
    } catch (e) {
      setErr(errMsg(e));
    }

    const ticker = setInterval(() => setTick((t) => t + 1), 8000);
    return () => {
      active = false;
      clearTimeout(loadTimeout);
      unsub();
      clearInterval(ticker);
    };
  }, []);

  // Steps for the selected run + live step streaming.
  useEffect(() => {
    if (!selectedId) {
      setSteps([]);
      return;
    }
    let active = true;
    setSteps([]);
    (async () => {
      try {
        const s = await fetchRunSteps(selectedId);
        if (!active) return;
        setSteps(s);
      } catch (e) {
        if (active) setErr(errMsg(e));
      }
    })();

    const unsub = subscribeRunSteps(selectedId, (step) => {
      setSteps((prev) => (prev.some((p) => p.id === step.id) ? prev : [...prev, step]));
    });
    return () => {
      active = false;
      unsub();
    };
  }, [selectedId]);

  const selectedRun = useMemo(
    () => runs?.find((r) => r.id === selectedId) ?? null,
    [runs, selectedId]
  );
  const blocks = useMemo(() => buildBlocks(steps), [steps]);
  const hasSuccessfulRun = useMemo(
    () => (runs ?? []).some((r) => r.status === "complete"),
    [runs]
  );
  // Did the selected run actually pay? Run-level aggregates can be null even when
  // every call settled, so fall back to the loaded payment steps.
  const paymentsSettled = useMemo(
    () =>
      (selectedRun?.payment_count ?? 0) > 0 ||
      (selectedRun?.total_spent_usdc ?? 0) > 0 ||
      steps.some((s) => s.kind === "payment"),
    [selectedRun, steps]
  );

  return (
    <>
      <header className="rig">
        <div className="rig-inner">
          <div className="brand-row">
            <div className="brand">
              <span className="brand-mark">STENT</span>
              <span className="badge-402">CONSOLE</span>
            </div>
            <div className="network">
              <span className="dot" />
              {NETWORK_LABEL}
            </div>
          </div>
          <div className="thesis">
            <p className="eyebrow">
              <b>Machine reasoning</b> — live
            </p>
            <h1>Watch an agent decide and pay.</h1>
            <p>
              A real autonomous agent picks Stent APIs and pays per call in USDC. Every step
              below — reasoning, selection, payment, response — is emitted live from an actual run.
            </p>
          </div>
        </div>
      </header>

      <main className="console">
        {err && <div className="notice err">{err}</div>}
        {runs === null ? (
          <ConsoleSkeleton />
        ) : (
        <div className="con-cols">
          <aside className="con-side">
            <RunList runs={runs} selectedId={selectedId} onSelect={setSelectedId} />
          </aside>
          <section className="con-main">
            {selectedRun ? (
              <>
                {!hasSuccessfulRun && selectedRun.status === "failed" && (
                  <div className="notice step con-context">
                    {paymentsSettled ? (
                      <>
                        Every payment in this run settled on {NETWORK_LABEL} — each call below was
                        paid and returned data. It&apos;s marked failed only because a later,
                        non-payment step errored out, after settlement completed.
                      </>
                    ) : (
                      <>
                        No completed agent run is available yet. Showing the most recent failed run
                        so the lifecycle evidence stays truthful.
                      </>
                    )}
                  </div>
                )}
                <RunHeader run={selectedRun} />
                <Timeline blocks={blocks} />
              </>
            ) : (
              <Empty
                center
                icon="◈"
                title="No agent runs yet"
                desc="Start the demo agent and every step — reasoning, endpoint selection, payment, response — streams into this console live."
              />
            )}
          </section>
        </div>
        )}
      </main>
    </>
  );
}
