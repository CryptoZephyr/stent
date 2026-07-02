"use client";

import { useState } from "react";

export function Copy({
  text,
  label = "Copy",
  className = "",
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={`copy ${done ? "copied" : ""} ${className}`}
      aria-label={done ? "Copied" : label}
      aria-live="polite"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } catch {
          /* clipboard blocked — no-op */
        }
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}

export function CodeBlock({ code, filename }: { code: string; filename?: string }) {
  return (
    <div className="code">
      <div className="code-head">
        <span className="code-file mono">{filename ?? "snippet"}</span>
        <Copy text={code} />
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function InlineCopy({ value }: { value: string }) {
  return (
    <div className="inline-copy">
      <code>{value}</code>
      <Copy text={value} />
    </div>
  );
}

/** One shimmering placeholder block. Compose these to mirror the loaded layout. */
export function Skel({
  w,
  h = 14,
  r,
  style,
  className = "",
}: {
  w?: number | string;
  h?: number | string;
  r?: number | string;
  style?: React.CSSProperties;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`skel ${className}`}
      style={{ display: "block", width: w ?? "100%", height: h, borderRadius: r, ...style }}
    />
  );
}

/** Teaching empty state: icon + what this surface is + how to fill it. */
export function Empty({
  icon = "⬡",
  title,
  desc,
  action,
  center = false,
}: {
  icon?: string;
  title: string;
  desc: string;
  action?: React.ReactNode;
  center?: boolean;
}) {
  return (
    <div className={`empty${center ? " center" : ""}`}>
      <span className="empty-icon" aria-hidden>
        {icon}
      </span>
      <p className="empty-title">{title}</p>
      <p className="empty-desc">{desc}</p>
      {action && <span className="empty-action">{action}</span>}
    </div>
  );
}

export function StatusBadge({ verified, active }: { verified: boolean; active: boolean }) {
  if (verified && active)
    return (
      <span className="badge live">
        <span className="dot" />
        Live
      </span>
    );
  if (!verified)
    return (
      <span className="badge pending">
        <span className="dot" />
        Needs verification
      </span>
    );
  return (
    <span className="badge off">
      <span className="dot" />
      Paused
    </span>
  );
}
