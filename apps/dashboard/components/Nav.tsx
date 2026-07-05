"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { PROXY_URL } from "@/lib/config";

const LINKS = [
  { href: "/publish", label: "Publish API" },
  { href: "/marketplace", label: "Browse APIs" },
  { href: "/console", label: "Runs" },
  { href: "/live", label: "Payments" },
  { href: "/docs", label: "Docs" },
];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Global top navigation for the V2 product spine. */
export function Nav() {
  const path = usePathname();
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const [status, setStatus] = useState<"checking" | "operational" | "degraded">("checking");

  useEffect(() => {
    let active = true;
    // Aborts any in-flight fetch on unmount/nav so we don't leak requests.
    const cleanupAbort = new AbortController();

    async function check(timeoutMs: number): Promise<"ok" | "aborted" | "failed"> {
      const signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), cleanupAbort.signal]);
      try {
        const r = await fetch(`${PROXY_URL}/_api/endpoints`, { signal });
        return r.ok ? "ok" : "failed";
      } catch (e) {
        // AbortError covers both our own timeout and effect cleanup (nav away /
        // dev double-mount) — neither means the proxy is actually unreachable.
        return (e as Error)?.name === "AbortError" ? "aborted" : "failed";
      }
    }

    (async () => {
      const first = await check(5000);
      if (!active) return;
      if (first === "ok") {
        setStatus("operational");
        return;
      }

      // Genuine failure or an ambiguous abort — either way, give it one real
      // retry before ever declaring degraded. Stay in "checking" meanwhile.
      setStatus("checking");
      await sleep(3000);
      if (!active) return;

      const second = await check(8000);
      if (!active) return;
      if (second === "ok") setStatus("operational");
      else if (second === "aborted") setStatus("checking");
      else setStatus("degraded");
    })();

    return () => {
      active = false;
      cleanupAbort.abort();
    };
  }, []);

  return (
    <nav className="nav">
      <div className="nav-inner">
        <Link href="/" className="nav-logo" aria-label="Stent home">
          <span className="nav-mark" aria-hidden>
            <span className="nav-mark-dot" />
          </span>
          <span className="nav-word">Stent</span>
        </Link>

        <div className="nav-links">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`nav-link${isActive(l.href) ? " active" : ""}`}
              aria-current={isActive(l.href) ? "page" : undefined}
            >
              {l.label}
            </Link>
          ))}
        </div>

        <div className="nav-right">
          <span role="status" className="nav-status" title={status === "operational" ? "All systems operational" : status === "degraded" ? "Proxy unreachable" : "Checking..."}>
            <span className={`dot${status === "degraded" ? " dot-warn" : ""}`} />
            {status === "checking" ? "checking..." : status}
          </span>
        </div>
      </div>
    </nav>
  );
}
