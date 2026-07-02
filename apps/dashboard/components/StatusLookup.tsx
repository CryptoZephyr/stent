"use client";

import { useState } from "react";
import { getStatus, buildPatchOwnershipMessage, setEndpointActive, type EndpointStatus } from "@/lib/api";
import { endpointUrl } from "@/lib/snippet";
import { shortAddr, connectInjected, signMessage } from "@/lib/wallet";
import { StatusBadge, Copy } from "./ui";

export function StatusLookup() {
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<EndpointStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [wallet, setWallet] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [patching, setPatching] = useState(false);
  const [manageErr, setManageErr] = useState<string | null>(null);

  async function look() {
    const s = slug.trim();
    if (!s) return;
    setBusy(true);
    setErr(null);
    setRes(null);
    setManageErr(null);
    const r = await getStatus(s);
    setBusy(false);
    if (r.ok) setRes(r.data);
    else setErr(r.error);
  }

  async function connect() {
    setConnecting(true);
    setManageErr(null);
    try {
      setWallet(await connectInjected());
    } catch (e) {
      const code = (e as Error).message;
      setManageErr(
        code === "no_wallet" ? "No browser wallet detected." : "Wallet connection was cancelled."
      );
    } finally {
      setConnecting(false);
    }
  }

  async function toggleActive() {
    if (!res || !wallet) return;
    setPatching(true);
    setManageErr(null);
    const nextActive = !res.active;
    const issued_at = new Date().toISOString();
    try {
      const message = buildPatchOwnershipMessage({
        slug: res.slug,
        publisher_wallet: wallet,
        active: nextActive,
        issued_at,
      });
      const signature = await signMessage(wallet, message);
      const r = await setEndpointActive(res.slug, {
        publisher_wallet: wallet,
        active: nextActive,
        issued_at,
        signature,
      });
      if (r.ok) setRes({ ...res, active: r.data.active });
      else setManageErr(r.error);
    } catch (e) {
      setManageErr(e instanceof Error && e.message === "no_wallet" ? "No browser wallet detected." : "Signature request was cancelled.");
    } finally {
      setPatching(false);
    }
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

          {res.verified && (
            <div style={{ marginTop: 16 }}>
              {!wallet ? (
                <button className="btn btn-ghost" onClick={connect} disabled={connecting}>
                  {connecting ? "Connecting…" : "Connect wallet to manage"}
                </button>
              ) : wallet.toLowerCase() !== res.publisher_wallet.toLowerCase() ? (
                <div className="notice step">
                  Connected wallet doesn&apos;t match this endpoint&apos;s payout address — only
                  the owner can pause or resume it.
                </div>
              ) : (
                <button className="btn btn-primary" onClick={toggleActive} disabled={patching}>
                  {patching ? "Saving…" : res.active ? "Pause endpoint" : "Resume endpoint"}
                </button>
              )}
              {manageErr && <div className="notice err">{manageErr}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
