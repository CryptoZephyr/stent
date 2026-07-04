"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { NETWORK_LABEL } from "@/lib/config";
import { listEndpoints, type EndpointSummary } from "@/lib/api";
import { fetchPayments, endpointStatsBySlug, type EndpointStats } from "@/lib/economy";
import { EndpointCard } from "@/components/marketplace/EndpointCard";
import { MarketplaceSkeleton } from "@/components/skeletons";
import { Empty } from "@/components/ui";

export default function MarketplacePage() {
  const [endpoints, setEndpoints] = useState<EndpointSummary[] | null>(null);
  const [stats, setStats] = useState<Map<string, EndpointStats>>(new Map());
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    (async () => {
      const result = await listEndpoints();
      if (!active) return;
      if (result.ok) setEndpoints(result.data);
      else setErr(result.error);
    })();

    (async () => {
      try {
        const rows = await fetchPayments();
        if (active) setStats(endpointStatsBySlug(rows));
      } catch {
        // Usage stats never block discovery.
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="market-page">
      <header className="page-hero compact">
        <div>
          <p className="page-kicker">Browse paid APIs</p>
          <h1>Find an API you can call with payment built in.</h1>
          <p>
            Every listing is a verified Stent endpoint. Pick one, inspect the price and sample
            response, then run the paid request from the detail page.
          </p>
        </div>
        <div className="flow-network">
          <span className="dot" />
          {NETWORK_LABEL}
        </div>
      </header>

      <section className="market-shell" aria-label="Paid API listings">
        {err && <div className="notice err">{err}</div>}
        {!err && !endpoints && <MarketplaceSkeleton />}
        {endpoints && endpoints.length === 0 && (
          <Empty
            center
            title="No paid APIs are live yet"
            desc="The first verified endpoint will appear here. If you own an API, publish it and Stent will create the paid URL."
            action={
              <Link href="/publish" className="btn btn-primary">
                Publish the first API
              </Link>
            }
          />
        )}
        {endpoints && endpoints.length > 0 && (
          <div className="mkt-grid">
            {endpoints.map((endpoint) => (
              <EndpointCard key={endpoint.slug} ep={endpoint} stats={stats.get(endpoint.slug)} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
