import Link from "next/link";
import type { EndpointSummary } from "@/lib/api";
import { shortAddr } from "@/lib/wallet";
import { endpointUrl } from "@/lib/snippet";
import { Copy } from "@/components/ui";

export function EndpointCard({ ep }: { ep: EndpointSummary }) {
  return (
    <div className="mkt-card">
      <div className="mkt-card-head">
        <span className="mkt-icon" aria-hidden>
          ⬡
        </span>
        <span className="badge live">
          <span className="dot" />
          live
        </span>
      </div>
      <Link href={`/marketplace/${ep.slug}`} className="mkt-slug mono">
        {ep.slug}
      </Link>
      <p className="mkt-desc">{ep.description || "A paywalled API behind Stent."}</p>
      <div className="mkt-statrow">
        <div className="mkt-stat">
          <div className="mkt-stat-k">price</div>
          <div className="mkt-stat-v mono">${ep.price_usdc} USDC</div>
        </div>
        <div className="mkt-stat">
          <div className="mkt-stat-k">publisher</div>
          <div className="mkt-stat-v mono" title={ep.publisher_wallet}>
            {shortAddr(ep.publisher_wallet)}
          </div>
        </div>
      </div>
      <div className="inline-copy mkt-url">
        <code>{endpointUrl(ep.slug)}</code>
        <Copy text={endpointUrl(ep.slug)} label="Copy URL" />
      </div>
      <Link href={`/marketplace/${ep.slug}`} className="btn btn-ghost btn-block mkt-cta">
        View &amp; integrate
      </Link>
    </div>
  );
}
