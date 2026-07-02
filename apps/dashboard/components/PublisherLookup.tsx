"use client";

import { useState } from "react";
import { isAddress } from "@/lib/wallet";
import { listEndpoints, type EndpointSummary } from "@/lib/api";
import { fetchPayments, publisherEarningsBySlug, type PublisherEndpointEarnings } from "@/lib/economy";
import { formatUsdc, formatCount, timeAgo } from "./economy/format";

export function PublisherLookup() {
  const [wallet, setWallet] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [endpoints, setEndpoints] = useState<EndpointSummary[] | null>(null);
  const [earned, setEarned] = useState<Map<string, PublisherEndpointEarnings>>(new Map());

  async function look() {
    const w = wallet.trim();
    if (!isAddress(w)) {
      setErr("That doesn't look like a wallet address (0x…, 42 characters).");
      setEndpoints(null);
      return;
    }
    setBusy(true);
    setErr(null);
    setEndpoints(null);
    try {
      const [epRes, rows] = await Promise.all([listEndpoints(), fetchPayments()]);
      if (!epRes.ok) {
        setErr(epRes.error);
        return;
      }
      setEndpoints(epRes.data.filter((e) => e.publisher_wallet.toLowerCase() === w.toLowerCase()));
      setEarned(publisherEarningsBySlug(rows, w));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't load your endpoints.");
    } finally {
      setBusy(false);
    }
  }

  const totalUsdc = [...earned.values()].reduce((sum, e) => sum + e.usdc, 0);

  return (
    <div className="card">
      <p className="step-eyebrow">Already publishing?</p>
      <h2>See your endpoints &amp; earnings</h2>
      <p className="lede">
        Enter your payout address to see every live endpoint registered to it and what
        it&apos;s earned.
      </p>

      <label className="label" htmlFor="publisher-wallet">
        Payout address
      </label>
      <div className="lookup-bar">
        <input
          id="publisher-wallet"
          className="input"
          placeholder="0x…"
          value={wallet}
          onChange={(e) => {
            setWallet(e.target.value);
            setErr(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && look()}
        />
        <button className="btn btn-primary" onClick={look} disabled={busy}>
          {busy ? "Checking…" : "View earnings"}
        </button>
      </div>

      {err && <div className="notice err">{err}</div>}

      {endpoints && endpoints.length === 0 && (
        <div className="notice step" style={{ marginTop: 12 }}>
          No live endpoints found for that address yet. An endpoint you registered but
          haven&apos;t verified won&apos;t show up here — finish verifying it above first.
        </div>
      )}

      {endpoints && endpoints.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div className="kv" style={{ marginBottom: 12 }}>
            <div className="kv-row">
              <span className="kv-k">Total earned</span>
              <span className="kv-v">{formatUsdc(totalUsdc)}</span>
            </div>
            <div className="kv-row">
              <span className="kv-k">Live endpoints</span>
              <span className="kv-v">{formatCount(endpoints.length)}</span>
            </div>
          </div>
          <div className="kv">
            {endpoints.map((ep) => {
              const e = earned.get(ep.slug);
              return (
                <div className="kv-row" key={ep.slug}>
                  <span className="kv-k mono">{ep.slug}</span>
                  <span className="kv-v">
                    {e
                      ? `${formatUsdc(e.usdc)} · ${formatCount(e.calls)} calls · last ${e.lastActiveAt ? timeAgo(e.lastActiveAt) : "—"}`
                      : "No calls yet"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
