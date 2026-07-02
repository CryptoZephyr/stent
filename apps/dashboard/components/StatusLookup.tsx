"use client";

import { useState } from "react";
import { getStatus, type EndpointStatus } from "@/lib/api";
import { endpointUrl } from "@/lib/snippet";
import { shortAddr } from "@/lib/wallet";
import { StatusBadge, Copy } from "./ui";

export function StatusLookup() {
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<EndpointStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function look() {
    const s = slug.trim();
    if (!s) return;
    setBusy(true);
    setErr(null);
    setRes(null);
    const r = await getStatus(s);
    setBusy(false);
    if (r.ok) setRes(r.data);
    else setErr(r.error);
  }

  return (
    <div className="card">
      <p className="step-eyebrow">Already registered?</p>
      <h2>Check an endpoint&apos;s status</h2>
      <p className="lede">Enter an endpoint id to see whether it&apos;s verified and live.</p>

      <label className="label" htmlFor="status-slug">
        Endpoint id
      </label>
      <div className="lookup-bar">
        <input
          id="status-slug"
          className="input"
          placeholder="weather-now"
          value={slug}
          onChange={(e) => {
            setSlug(e.target.value);
            setErr(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && look()}
        />
        <button className="btn btn-primary" onClick={look} disabled={busy}>
          {busy ? "Checking…" : "Check status"}
        </button>
      </div>

      {err && <div className="notice err">{err}</div>}

      {res && (
        <div style={{ marginTop: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <span className="mono" style={{ fontSize: 14 }}>{res.slug}</span>
            <StatusBadge verified={res.verified} active={res.active} />
          </div>
          <div className="kv">
            <div className="kv-row">
              <span className="kv-k">Public URL</span>
              <span className="kv-v">{endpointUrl(res.slug)}</span>
            </div>
            <div className="kv-row">
              <span className="kv-k">Price</span>
              <span className="kv-v">${res.price_usdc} / request</span>
            </div>
            <div className="kv-row">
              <span className="kv-k">Earnings to</span>
              <span className="kv-v">{shortAddr(res.publisher_wallet)}</span>
            </div>
          </div>
          {!res.verified && (
            <div className="notice step" style={{ marginTop: 12 }}>
              Not live yet — it still needs URL verification before Stent will serve it.
            </div>
          )}
          {res.verified && (
            <div className="inline-copy" style={{ marginTop: 12 }}>
              <code>{endpointUrl(res.slug)}</code>
              <Copy text={endpointUrl(res.slug)} label="Copy URL" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
