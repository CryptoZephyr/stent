import Link from "next/link";
import type { EndpointSummary } from "@/lib/api";
import type { EndpointStats } from "@/lib/economy";
import { endpointUrl } from "@/lib/snippet";
import { Copy } from "@/components/ui";
import { formatCount, timeAgo } from "@/components/economy/format";

export function EndpointCard({ ep, stats }: { ep: EndpointSummary; stats?: EndpointStats }) {
  const hasCalls = stats && stats.calls > 0;

  return (
    <article className="mkt-card">
      <div className="mkt-card-head">
        <span className="badge live">
          <span className="dot" />
          Live
        </span>
        {hasCalls && (
          <span className="mkt-activity">
            {formatCount(stats.calls)}
            {stats.lastActiveAt ? ` · ${timeAgo(stats.lastActiveAt)}` : ""}
          </span>
        )}
      </div>

      <h2>
        <Link href={`/marketplace/${ep.slug}`} className="mkt-slug mono">
          {ep.slug}
        </Link>
      </h2>
      <p className="mkt-desc">{ep.description || "A paid API published through Stent."}</p>

      <dl className="mkt-facts">
        <div>
          <dt>Price</dt>
          <dd className="mono">${ep.price_usdc} / request</dd>
        </div>
        <div>
          <dt>Paid URL</dt>
          <dd className="mono">{endpointUrl(ep.slug).replace(/^https?:\/\//, "")}</dd>
        </div>
      </dl>

      <div className="mkt-actions">
        <Link href={`/marketplace/${ep.slug}`} className="btn btn-primary btn-block">
          Try this API
        </Link>
        <Copy text={endpointUrl(ep.slug)} label="Copy URL" className="copy-inline" />
      </div>
    </article>
  );
}
