"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the real error for operators; users get the branded card below.
    console.error(error);
  }, [error]);

  return (
    <main className="stage">
      <div className="card">
        <p className="step-eyebrow" style={{ color: "var(--red)" }}>
          Unexpected error
        </p>
        <h2>Something broke on our side</h2>
        <p className="lede">
          The page hit an unexpected error while rendering. Your wallet wasn&apos;t touched and no
          payment was made — retrying is safe.
        </p>
        {error.digest && (
          <p className="hint mono" style={{ marginBottom: 16 }}>
            error ref: {error.digest}
          </p>
        )}
        <div className="btn-row">
          <button className="btn btn-primary" onClick={reset}>
            Try again
          </button>
          <Link href="/" className="btn btn-ghost">
            Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}
