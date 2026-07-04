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

/** Global top navigation for the V2 product spine. */
export function Nav() {
  const path = usePathname();
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const [status, setStatus] = useState<"checking" | "operational" | "degraded">("checking");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const r = await fetch(`${PROXY_URL}/_api/endpoints`, { signal: AbortSignal.timeout(5000) });
        if (active) setStatus(r.ok ? "operational" : "degraded");
      } catch {
        if (active) setStatus("degraded");
      }
    })();
    return () => { active = false; };
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
