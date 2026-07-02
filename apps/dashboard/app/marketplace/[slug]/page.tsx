"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { NETWORK_LABEL } from "@/lib/config";
import { getStatus, type EndpointStatus } from "@/lib/api";
import { fetchPayments, endpointStatsBySlug, type EndpointStats } from "@/lib/economy";
import { endpointUrl, sdkSnippet, curlSnippet } from "@/lib/snippet";
import { shortAddr } from "@/lib/wallet";
import { formatCount, timeAgo } from "@/components/economy/format";
import { CodeBlock, InlineCopy, StatusBadge } from "@/components/ui";
import { EndpointDetailSkeleton } from "@/components/skeletons";

export default function EndpointDetailPage({ params }: { params: { slug: string } }) {
  const { slug } = params;
  const [ep, setEp] = useState<EndpointStatus | null>(null);
  const [stats, setStats] = useState<EndpointStats | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const r = await getStatus(slug);
      if (!active) return;
      if (r.ok) setEp(r.data);
      else setErr(r.error);
      setLoaded(true);
    })();
    // Usage stats are a nice-to-have: fetched separately so a Supabase hiccup
    // never blocks the endpoint detail itself from rendering.
    (async () => {
      try {
        const rows = await fetchPayments();
        if (active) setStats(endpointStatsBySlug(rows).get(slug));
      } catch {
        // leave stats unset — the detail page just omits the "calls" row
      }
    })();
    return () => {
      active = false;
    };
  }, [slug]);

  return (
    <>
      <header className="rig">
        <div className="rig-inner">
          <div className="brand-row">
            <div className="brand">
              <span className="brand-mark">STENT</span>
              <span className="badge-402">MARKETPLACE</span>
            </div>
            <div className="network">
              <span className="dot" />
              {NETWORK_LABEL}
            </div>
          </div>
          <div className="thesis">
            <p className="eyebrow">
              <Link href="/marketplace">← All APIs</Link>
            </p>
            <h1 className="mono mkt-detail-slug">{slug}</h1>
            {ep && (
              <p>
                ${ep.price_usdc} per request · earnings to {shortAddr(ep.publisher_wallet)} · settled
                on {NETWORK_LABEL}
              </p>
            )}
          </div>
        </div>
      </header>

      <main className="stage">
        {err && <div className="notice err">{err}</div>}
        {!err && !loaded && <EndpointDetailSkeleton />}

        {ep && (
          <div className="card">
            <div className="mkt-detail-head">
              <p className="step-eyebrow">Endpoint</p>
              <StatusBadge verified={ep.verified} active={ep.active} />
            </div>
            <h2 style={{ marginBottom: 8 }}>{ep.description || "A paywalled API behind Stent."}</h2>

            <div className="kv" style={{ marginBottom: 22 }}>
              <div className="kv-row">
                <span className="kv-k">Price</span>
                <span className="kv-v">${ep.price_usdc} / request</span>
              </div>
              <div className="kv-row">
                <span className="kv-k">Publisher</span>
                <span className="kv-v">{shortAddr(ep.publisher_wallet)}</span>
              </div>
              <div className="kv-row">
                <span className="kv-k">Network</span>
                <span className="kv-v">{NETWORK_LABEL}</span>
              </div>
              {stats && stats.calls > 0 && (
                <div className="kv-row">
                  <span className="kv-k">Calls</span>
                  <span className="kv-v">
                    {formatCount(stats.calls)}
                    {stats.lastActiveAt ? ` · last active ${timeAgo(stats.lastActiveAt)}` : ""}
                  </span>
                </div>
              )}
            </div>

            <p className="step-eyebrow">Public URL</p>
            <InlineCopy value={endpointUrl(ep.slug)} />

            <p className="step-eyebrow" style={{ marginTop: 22 }}>
              Integrate with the Stent SDK
            </p>
            <p className="hint" style={{ marginBottom: 10 }}>
              The SDK detects the 402, pays in USDC, and returns your data — no keys, no accounts.
            </p>
            <CodeBlock code={sdkSnippet(ep.slug)} filename="agent.ts" />

            <p className="step-eyebrow" style={{ marginTop: 22 }}>
              Or see the paywall with curl
            </p>
            <CodeBlock code={curlSnippet(ep.slug)} filename="terminal" />
          </div>
        )}
      </main>
    </>
  );
}
