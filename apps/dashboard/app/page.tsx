"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { NETWORK_LABEL } from "@/lib/config";
import {
  getEconomySnapshot,
  subscribePayments,
  toActivity,
  fetchPayments,
  fetchAgentNames,
  computeStats,
  isRecent,
  type EconomySnapshot,
  type ActivityItem,
  type PaymentRow,
} from "@/lib/economy";
import { listEndpoints, type EndpointSummary } from "@/lib/api";
import { formatUsdc, formatCount, timeAgo } from "@/components/economy/format";
import { shortAddr } from "@/lib/wallet";
import { NetworkViz } from "@/components/landing/NetworkViz";

interface LogLine {
  id: number;
  tag: string;
  color: string;
  text: string;
  typed: string;
  typing: boolean;
}

function buildConsoleTape({
  feed,
  payments,
  endpoints,
  publishers,
  unavailable,
}: {
  feed: ActivityItem[];
  payments: number;
  endpoints: number;
  publishers: number;
  unavailable: boolean;
}): Array<{ tag: string; color: string; text: string }> {
  if (unavailable) {
    return [
      { tag: "error", color: "var(--red)", text: "live data unavailable" },
      { tag: "wait", color: "var(--text-2)", text: "waiting for Supabase reconnect" },
    ];
  }

  if (feed.length === 0) {
    return [
      { tag: "live", color: "var(--live)", text: "waiting for first settlement" },
      { tag: "market", color: "var(--usdc)", text: `${formatCount(endpoints)} live APIs listed` },
      { tag: "fleet", color: "var(--text-2)", text: `${formatCount(publishers)} publishers onboarded` },
      { tag: "task", color: "var(--text-2)", text: "agent discovers endpoint → pays → receives data" },
    ];
  }

  const latest = feed.slice(0, 3);
  const lines = latest.flatMap((f, i) => [
    {
      tag: i === 0 ? "pay" : "settle",
      color: "var(--live)",
      text: `${f.agentLabel} paid ${formatUsdc(f.amountUsdc)} for ${f.endpointSlug}`,
    },
    {
      tag: "data",
      color: "var(--text-2)",
      text: `settled ${timeAgo(f.at)}`,
    },
  ]);
  lines.push({ tag: "done", color: "var(--usdc)", text: `${formatCount(payments)} payments settled` });
  return lines.slice(0, 4);
}

const SDK_CODE = `import { StentClient } from "@stent/sdk";

const agent = new StentClient({
  privateKey: process.env.AGENT_PRIVATE_KEY, // a funded wallet
  spendCapUsdc: 1.00,                         // safety cap
});

// discovers the 402, pays in USDC, returns the data
const data = await agent.fetch(
  "https://stentproxy-production.up.railway.app/arc-stats",
);`;

const FEATURES = [
  { icon: "◈", title: "Atomic settlement", desc: "Payment clears only when the upstream returns 2xx. Both succeed or neither does." },
  { icon: "⬡", title: "Wallet-native auth", desc: "Every agent signs with its own wallet and spend cap. No shared API keys." },
  { icon: "⌗", title: "Replay-proof ledger", desc: "Each EIP-3009 nonce is unique and logged before settlement. Full audit trail." },
];

export default function Landing() {
  const [snap, setSnap] = useState<EconomySnapshot | null>(null);
  const [eps, setEps] = useState<EndpointSummary[]>([]);
  const [statsUnavailable, setStatsUnavailable] = useState(false);
  const [marketplaceUnavailable, setMarketplaceUnavailable] = useState(false);
  const [feed, setFeed] = useState<ActivityItem[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [log, setLog] = useState<LogLine[]>(() =>
    buildConsoleTape({
      feed: [],
      payments: 0,
      endpoints: 0,
      publishers: 0,
      unavailable: false,
    }).map((l, i) => ({ ...l, id: i, typed: l.text, typing: false }))
  );
  const visRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [s, r] = await Promise.all([getEconomySnapshot(), listEndpoints()]);
        if (!active) return;
        setSnap(s);
        setStatsUnavailable(false);
        setFeed(s.activity.slice(0, 5));
        if (r.ok) {
          setEps(r.data);
          setMarketplaceUnavailable(false);
        } else {
          setMarketplaceUnavailable(true);
        }
      } catch {
        if (!active) return;
        setStatsUnavailable(true);
        setMarketplaceUnavailable(true);
      }
      try {
        const p = await fetchPayments();
        const n = await fetchAgentNames(p.map((x) => x.agent_address));
        if (!active) return;
        setRows(p);
        setNames(n);
        setStatsUnavailable(false);
      } catch {
        if (active) setStatsUnavailable(true);
      }
    })();
    let unsub = () => {};
    try {
      unsub = subscribePayments((row) => {
        setRows((prev) => [row, ...prev.filter((p) => p.id !== row.id)]);
        setStatsUnavailable(false);
      });
    } catch {
      setStatsUnavailable(true);
    }
    return () => {
      active = false;
      unsub();
    };
  }, []);

  // Keep the live feed + ledger fresh as payments stream in.
  useEffect(() => {
    if (rows.length) setFeed(toActivity(rows, names, 5));
  }, [rows, names]);

  const stats = useMemo(() => {
    const all = snap?.all ?? computeStats(rows);
    return {
      payments: all.payments,
      apis: eps.length,
      publishers: all.publishers,
    };
  }, [snap, eps, rows]);

  // Honest liveness for the settlement feed: only "live" if the newest payment
  // is recent. Otherwise the badge reads "idle" instead of pulsing over old data.
  const settlementLive = isRecent(feed[0]?.at ?? null);

  const consoleTape = useMemo(
    () =>
      buildConsoleTape({
        feed,
        payments: stats.payments,
        endpoints: stats.apis,
        publishers: stats.publishers,
        unavailable: statsUnavailable,
      }),
    [feed, stats.payments, stats.apis, stats.publishers, statsUnavailable]
  );

  useEffect(() => {
    setLog(consoleTape.slice(0, 4).map((l, i) => ({ ...l, id: i, typed: l.text, typing: false })));
  }, [consoleTape]);

  // Live Agent Console — types each new line in, then rolls the window forward.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let idx = 4;
    let charTimer: ReturnType<typeof setTimeout>;
    let lineTimer: ReturnType<typeof setTimeout>;
    if (consoleTape.length === 0) return;
    const pushNext = () => {
      const src = consoleTape[idx % consoleTape.length];
      idx += 1;
      const id = Date.now() + Math.random();
      setLog((prev) => [...prev.slice(-4), { ...src, id, typed: "", typing: true }]);
      let n = 0;
      const typeChar = () => {
        n += 1;
        const typed = src.text.slice(0, n);
        setLog((prev) => prev.map((e) => (e.id === id ? { ...e, typed } : e)));
        if (n < src.text.length) {
          charTimer = setTimeout(typeChar, 26);
        } else {
          setLog((prev) => prev.map((e) => (e.id === id ? { ...e, typing: false } : e)));
          lineTimer = setTimeout(pushNext, 1600);
        }
      };
      charTimer = setTimeout(typeChar, 360);
    };
    lineTimer = setTimeout(pushNext, 1300);
    return () => {
      clearTimeout(charTimer);
      clearTimeout(lineTimer);
    };
  }, [consoleTape]);

  // Pointer parallax — layers drift at different depths around the cursor.
  useEffect(() => {
    const el = visRef.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const target = (el.closest(".land-hero") as HTMLElement | null) ?? el;
    let raf = 0;
    const onMove = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.setProperty("--mx", x.toFixed(3));
        el.style.setProperty("--my", y.toFixed(3));
      });
    };
    const onLeave = () => {
      el.style.setProperty("--mx", "0");
      el.style.setProperty("--my", "0");
    };
    target.addEventListener("mousemove", onMove);
    target.addEventListener("mouseleave", onLeave);
    return () => {
      target.removeEventListener("mousemove", onMove);
      target.removeEventListener("mouseleave", onLeave);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="land">
      {/* ambient background */}
      <div className="land-bg" aria-hidden>
        <span className="land-glow a" />
        <span className="land-glow b" />
        <span className="land-grid" />
      </div>

      {/* ── HERO ── */}
      <section className="land-hero">
        <div className="land-hero-copy">
          <span className="land-pill">
            <span className="dot" />
            The machine economy is live
          </span>
          <h1>
            Agents that discover, pay for, and call APIs on their own.
          </h1>
          <p>
            Stent is the infrastructure layer where autonomous agents find the endpoints they need,
            settle in USDC per call, and execute real work — no keys to pass around, no invoices.
          </p>
          <div className="land-hero-cta">
            <Link href="/agents" className="btn btn-primary btn-lg">
              Connect an agent wallet →
            </Link>
            <Link href="/marketplace" className="btn btn-ghost btn-lg">
              Explore the marketplace
            </Link>
          </div>
        </div>

        <div className="land-hero-vis" ref={visRef}>
          <span className="land-vis-glow" aria-hidden />
          <NetworkViz className="land-net" />

          <span className="land-chip a">
            <span className="d accent" />
            company.enrich
          </span>
          <span className="land-chip b">
            <span className="g accent">⌕</span>discovering endpoints
          </span>
          <span className="land-chip c">
            <span className="g pay">◈</span>USDC settled per call
          </span>

          <div className="land-console">
            <div className="land-console-head">
              <span className="land-console-title mono">Agent Console</span>
              <span className="eco-live">
                <span className="dot" /> Live
              </span>
            </div>
            <div className="land-console-body">
              {log.map((l) => (
                <div className="land-log" key={l.id}>
                  <span className="land-log-tag mono" style={{ color: l.color }}>
                    {l.tag}
                  </span>
                  <span className="land-log-sep">›</span>
                  <span className="land-log-text mono">
                    {l.typed}
                    {l.typing && <span className="land-caret" aria-hidden />}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* trust strip */}
      <section className="land-trust">
        <span className="land-trust-k mono">BUILT ON OPEN STANDARDS</span>
        <span>x402</span>
        <span className="land-dot">·</span>
        <span>USDC</span>
        <span className="land-dot">·</span>
        <span>EVM wallets</span>
        <span className="land-dot">·</span>
        <span>{NETWORK_LABEL}</span>
      </section>

      {/* ── STATS BAND ── */}
      <section className="land-stats">
        <div className="land-stat">
          <div className="land-stat-v mono">{statsUnavailable ? "—" : formatCount(stats.payments)}</div>
          <div className="land-stat-k">Verified payments settled</div>
        </div>
        <div className="land-stat">
          <div className="land-stat-v mono accent">
            {marketplaceUnavailable ? "—" : formatCount(stats.apis)}
          </div>
          <div className="land-stat-k">Live APIs on the marketplace</div>
        </div>
        <div className="land-stat">
          <div className="land-stat-v mono">{statsUnavailable ? "—" : formatCount(stats.publishers)}</div>
          <div className="land-stat-k">Active publishers onboarded</div>
        </div>
        <div className="land-stat">
          <div className="land-stat-v mono pay">
            x402
          </div>
          <div className="land-stat-k">On-chain settled, no invoices</div>
        </div>
      </section>

      {/* ── 01 LIVE MACHINE ECONOMY ── */}
      <section id="economy" className="land-sec">
        <div className="land-sec-head">
          <span className="land-sec-no mono">01 / LIVE MACHINE ECONOMY</span>
          <h2>A market where software is both the buyer and the seller</h2>
          <p>
            Agents post intents. Endpoints quote a price. Payment settles the moment work is
            delivered. Every edge in the graph is a real, metered transaction.
          </p>
        </div>
        <div className="land-econ">
          <div className="land-econ-graph">
            <div className="land-hub">
              <span className="land-hub-core">
                <span className="land-hub-dot" />
              </span>
              <span className="mono land-hub-label">Stent</span>
            </div>
          </div>
          <div className="land-econ-feed">
            <div className="land-econ-feed-head">
              <span>Settlement feed</span>
              <span className={`eco-live${settlementLive && !statsUnavailable ? "" : " off"}`}>
                <span className="dot" />{" "}
                {statsUnavailable ? "offline" : settlementLive ? "live" : "idle"}
              </span>
            </div>
            {statsUnavailable ? (
              <p className="eco-empty">Live data unavailable. Settlement activity will appear when the feed reconnects.</p>
            ) : feed.length === 0 ? (
              <p className="eco-empty">Waiting for the next settlement…</p>
            ) : (
              feed.map((f) => (
                <div className="eco-feed-row" key={f.id}>
                  <span className="eco-feed-icon">◈</span>
                  <div className="eco-feed-main">
                    <div className="eco-feed-line">
                      <span className="eco-ep mono">{f.endpointSlug}</span>
                      <span className="eco-arrow">·</span>
                      <span className="eco-agent mono">{f.agentLabel}</span>
                    </div>
                    <div className="eco-feed-sub">settled · USDC</div>
                  </div>
                  <span className="eco-amt">+{formatUsdc(f.amountUsdc)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {/* ── 02 MARKETPLACE ── */}
      <section id="marketplace" className="land-sec">
        <div className="land-sec-head">
          <span className="land-sec-no mono">02 / MARKETPLACE</span>
          <h2>Every endpoint, priced and metered</h2>
          <p>
            Agents browse the same catalog you do, ranked by price and trust. Publishers list once
            and get paid per call.
          </p>
        </div>
        <div className="mkt-grid">
          {marketplaceUnavailable && (
            <div className="notice step mkt-card">
              Live marketplace data unavailable. Verified endpoints will appear when the catalog reconnects.
            </div>
          )}
          {!marketplaceUnavailable && eps.slice(0, 5).map((ep) => (
            <Link key={ep.slug} href={`/marketplace/${ep.slug}`} className="mkt-card land-card-link">
              <div className="mkt-card-head">
                <span className="mkt-icon" aria-hidden>
                  ⬡
                </span>
                <span className="badge live">
                  <span className="dot" />
                  live
                </span>
              </div>
              <div className="mkt-slug mono">{ep.slug}</div>
              <p className="mkt-desc">{ep.description || "A paywalled API behind Stent."}</p>
              <div className="mkt-statrow">
                <div className="mkt-stat">
                  <div className="mkt-stat-k">price</div>
                  <div className="mkt-stat-v mono">${ep.price_usdc}</div>
                </div>
                <div className="mkt-stat">
                  <div className="mkt-stat-k">publisher</div>
                  <div className="mkt-stat-v mono">{shortAddr(ep.publisher_wallet)}</div>
                </div>
              </div>
            </Link>
          ))}
          <Link href="/publish" className="land-publish-card">
            <span className="land-publish-icon" aria-hidden>
              +
            </span>
            <div className="land-publish-title">List your API</div>
            <div className="land-publish-desc">
              Publish an endpoint, set a per-call price, and let agents discover it. You keep the
              revenue, settled in USDC.
            </div>
            <span className="land-publish-cta">Become a publisher →</span>
          </Link>
        </div>
      </section>

      {/* ── 03 SDK ── */}
      <section id="sdk" className="land-sec">
        <div className="land-sdk">
          <div className="land-sdk-copy">
            <span className="land-sec-no mono">03 / SDK INTEGRATION</span>
            <h2>Ship an autonomous agent in a dozen lines</h2>
            <p>
              Give an agent a wallet and a spend cap. It discovers the right endpoint, pays per
              call, and returns the result — and you never touch an API key.
            </p>
            <div className="land-install">
              <span className="mono land-install-p">$</span>
              <span className="mono land-install-cmd">npm install @stent/sdk</span>
            </div>
          </div>
          <div className="code land-sdk-code">
            <div className="code-head">
              <span className="code-file mono">agent.ts</span>
              <span className="mono land-sdk-lang">TypeScript</span>
            </div>
            <pre>
              <code>{SDK_CODE}</code>
            </pre>
          </div>
        </div>
      </section>

      {/* ── 04 DEVELOPER EXPERIENCE ── */}
      <section className="land-sec">
        <div className="land-sec-head">
          <span className="land-sec-no mono">04 / DEVELOPER EXPERIENCE</span>
          <h2>Infrastructure you can actually operate</h2>
          <p>Atomicity, audit trails, and controls built for production agent fleets — not a demo.</p>
        </div>
        <div className="land-features">
          {FEATURES.map((f) => (
            <div className="land-feature" key={f.title}>
              <span className="land-feature-icon" aria-hidden>
                {f.icon}
              </span>
              <div className="land-feature-title">{f.title}</div>
              <div className="land-feature-desc">{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="land-cta">
        <div className="land-cta-inner">
          <span className="land-cta-line" aria-hidden />
          <h2>
            Start building the
            <br />
            machine economy
          </h2>
          <p>
            Spin up an agent with a wallet and a spend cap. It finds the APIs, pays for them, and
            gets to work.
          </p>
          <div className="land-cta-row">
            <Link href="/agents" className="btn btn-primary btn-lg">
              Build an agent →
            </Link>
            <Link href="/publish" className="btn btn-ghost btn-lg">
              Publish an API
            </Link>
          </div>
        </div>
      </section>

      <footer className="land-foot">
        <span className="mono">Stent · x402 micropayments on {NETWORK_LABEL}</span>
        <span className="mono">the machine economy, running</span>
      </footer>
    </div>
  );
}
