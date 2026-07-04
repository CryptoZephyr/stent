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
  const [endpoint, setEndpoint] = useState<EndpointStatus | null>(null);
  const [stats, setStats] = useState<EndpointStats | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;

    (async () => {
      const result = await getStatus(slug);
      if (!active) return;
      if (result.ok) setEndpoint(result.data);
      else setErr(result.error);
      setLoaded(true);
    })();

    (async () => {
      try {
        const rows = await fetchPayments();
        if (active) setStats(endpointStatsBySlug(rows).get(slug));
      } catch {
        // Stats are supporting evidence, not required to use the endpoint.
      }
    })();

    return () => {
      active = false;
    };
  }, [slug]);

  return (
    <main className="endpoint-page">
      <header className="page-hero compact">
        <div>
          <Link href="/marketplace" className="back-link">
            Back to paid APIs
          </Link>
          <p className="page-kicker">Paid API</p>
          <h1 className="mono">{slug}</h1>
          <p>
            Inspect the price, copy the paid URL, confirm the paywall, then run one paid request
            from this page.
          </p>
        </div>
        <a className="btn btn-primary btn-lg" href="#paid-request">
          Run paid request
        </a>
      </header>

      <section className="endpoint-shell">
        {err && <div className="notice err">{err}</div>}
        {!err && !loaded && <EndpointDetailSkeleton />}

        {endpoint && (
          <article className="endpoint-card">
            <div className="endpoint-title">
              <div>
                <p className="page-kicker">What this API returns</p>
                <h2>{endpoint.description || "A paid API published through Stent."}</h2>
              </div>
              <StatusBadge verified={endpoint.verified} active={endpoint.active} />
            </div>

            <dl className="endpoint-facts">
              <div>
                <dt>Price</dt>
                <dd className="mono">${endpoint.price_usdc} / request</dd>
              </div>
              <div>
                <dt>Publisher earnings</dt>
                <dd className="mono">{shortAddr(endpoint.publisher_wallet)}</dd>
              </div>
              <div>
                <dt>Network</dt>
                <dd className="mono">{NETWORK_LABEL}</dd>
              </div>
              {stats && stats.calls > 0 && (
                <div>
                  <dt>Recent use</dt>
                  <dd className="mono">
                    {formatCount(stats.calls)}
                    {stats.lastActiveAt ? ` · ${timeAgo(stats.lastActiveAt)}` : ""}
                  </dd>
                </div>
              )}
            </dl>

            <section className="request-block" aria-labelledby="public-url">
              <div>
                <h3 id="public-url">Paid URL</h3>
                <p className="hint">Use this URL from your app, agent loop, or integration test.</p>
              </div>
              <InlineCopy value={endpointUrl(endpoint.slug)} />
            </section>

            {endpoint.sample_response && (
              <section className="request-block" aria-labelledby="sample-response">
                <div>
                  <h3 id="sample-response">Sample response</h3>
                  <p className="hint">
                    Captured automatically when the publisher verified the endpoint.
                  </p>
                </div>
                <CodeBlock code={endpoint.sample_response} filename="response" />
              </section>
            )}

            <section className="request-block" aria-labelledby="paywall-check">
              <div>
                <h3 id="paywall-check">Confirm the paywall</h3>
                <p className="hint">An unpaid request should stop at HTTP 402.</p>
              </div>
              <CodeBlock code={curlSnippet(endpoint.slug)} filename="terminal" />
            </section>

            <section className="request-block" id="paid-request" aria-labelledby="paid-request-title">
              <div>
                <h3 id="paid-request-title">Make the paid request</h3>
                <p className="hint">
                  Use a funded buyer wallet and a spend cap. The SDK pays, retries, and returns the
                  API response.
                </p>
              </div>
              <CodeBlock code={sdkSnippet(endpoint.slug)} filename="agent.ts" />
            </section>
          </article>
        )}
      </section>
    </main>
  );
}
