import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "404 — Stent",
};

export default function NotFound() {
  return (
    <main className="stage">
      <div className="card">
        <p className="step-eyebrow">HTTP 404 — Not found</p>
        <h2>This route doesn&apos;t resolve</h2>
        <p className="lede">
          The page you&apos;re looking for doesn&apos;t exist — the link may be stale, or an
          endpoint id may be mistyped. Nothing was paid and nothing settled.
        </p>
        <div className="btn-row">
          <Link href="/marketplace" className="btn btn-primary">
            Browse the marketplace
          </Link>
          <Link href="/" className="btn btn-ghost">
            Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}
