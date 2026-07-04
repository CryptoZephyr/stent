import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "404 - Stent",
};

export default function NotFound() {
  return (
    <main className="utility-page">
      <div className="flow-card">
        <p className="page-kicker">HTTP 404</p>
        <h2>This route doesn&apos;t resolve</h2>
        <p className="lede">
          The page you&apos;re looking for doesn&apos;t exist. The link may be stale, or a paid link name
          may be mistyped. Nothing was paid.
        </p>
        <div className="action-row">
          <Link href="/marketplace" className="btn btn-primary">
            Browse paid APIs
          </Link>
          <Link href="/" className="btn btn-quiet">
            Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}
