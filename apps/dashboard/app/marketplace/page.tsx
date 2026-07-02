"use client";

import { useEffect, useState } from "react";
import { NETWORK_LABEL } from "@/lib/config";
import Link from "next/link";
import { listEndpoints, type EndpointSummary } from "@/lib/api";
import { EndpointCard } from "@/components/marketplace/EndpointCard";
import { MarketplaceSkeleton } from "@/components/skeletons";
import { Empty } from "@/components/ui";

export default function MarketplacePage() {
  const [endpoints, setEndpoints] = useState<EndpointSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const r = await listEndpoints();
      if (!active) return;
      if (r.ok) setEndpoints(r.data);
      else setErr(r.error);
    })();
    return () => {
      active = false;
    };
  }, []);

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
              <b>Public APIs</b> — pay per call
            </p>
            <h1>APIs your agent can pay for.</h1>
            <p>
              Every endpoint is paywalled with x402 and settles per request in USDC. Drop one URL
              into the Stent SDK — no API keys, no accounts, no billing setup.
            </p>
          </div>
        </div>
      </header>

      <main className="mkt">
        {err && <div className="notice err">{err}</div>}
        {!err && !endpoints && <MarketplaceSkeleton />}
        {endpoints && endpoints.length === 0 && (
          <Empty
            center
            title="No public endpoints yet"
            desc="Once a publisher registers an API and verifies ownership of its URL, it appears here for every agent to discover."
            action={<Link href="/publish">Publish the first API →</Link>}
          />
        )}
        {endpoints && endpoints.length > 0 && (
          <div className="mkt-grid">
            {endpoints.map((ep) => (
              <EndpointCard key={ep.slug} ep={ep} />
            ))}
          </div>
        )}
      </main>
    </>
  );
}
