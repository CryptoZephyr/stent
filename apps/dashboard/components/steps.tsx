"use client";

import { useEffect, useRef, useState } from "react";
import { isAddress as isChecksumAddress } from "viem";
import { connectInjected, isAddress, shortAddr } from "@/lib/wallet";
import type { RegisterDraft } from "@/lib/api";
import { registerEndpoint, verifyEndpoint, type RegisterInput, type RegisterOk } from "@/lib/api";
import { verifyMessage, type VerifyMessage } from "@/lib/verifyMessages";
import { PROXY_URL, NETWORK_LABEL } from "@/lib/config";
import { endpointUrl, sdkSnippet, curlSnippet } from "@/lib/snippet";
import { Copy, CodeBlock, InlineCopy, StatusBadge } from "./ui";

// Verification auto-poll: re-check every POLL_MS for up to WINDOW_MS.
const POLL_MS = 3000;
const WINDOW_MS = 60000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/* ── 01 · Connect ───────────────────────────────────────────────────────── */

export function ConnectStep({ onConnect }: { onConnect: (addr: string) => void }) {
  const [pasting, setPasting] = useState(true);
  const [addr, setAddr] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function connect() {
    setErr(null);
    setBusy(true);
    try {
      onConnect(await connectInjected());
    } catch (e) {
      const code = (e as Error).message;
      setErr(
        code === "no_wallet"
          ? "No browser wallet detected. Paste your payout address instead."
          : "Wallet connection was cancelled."
      );
      setPasting(true);
    } finally {
      setBusy(false);
    }
  }

  function usePasted() {
    const a = addr.trim();
    if (!isAddress(a)) {
      setErr("That doesn't look like a wallet address (0x…, 42 characters).");
      return;
    }
    // Match the proxy's server-side guard (viem isAddress) so a bad EIP-55
    // checksum is caught here, not after the whole form is filled in.
    if (!isChecksumAddress(a)) {
      setErr("That address's checksum doesn't match — re-copy it, or paste it in all-lowercase.");
      return;
    }
    onConnect(a);
  }

  return (
    <div className="card">
      <p className="step-eyebrow">Step 01 — Payout address</p>
      <h2>Where should earnings land?</h2>
      <p className="lede">
        Every paid request settles in USDC to one wallet. You&apos;re not signing anything —
        agents pay <em>into</em> this address. You just need it on file.
      </p>

      {!pasting ? (
        <div className="btn-row">
          <button className="btn btn-primary" onClick={connect} disabled={busy}>
            {busy ? "Opening wallet…" : "Connect wallet"}
          </button>
          <button className="btn btn-ghost" onClick={() => setPasting(true)}>
            Paste an address instead
          </button>
        </div>
      ) : (
        <div className="field" style={{ marginTop: 4 }}>
          <label className="label" htmlFor="addr">
            Payout address
          </label>
          <input
            id="addr"
            className={`input ${err ? "bad" : ""}`}
            placeholder="0x…"
            value={addr}
            onChange={(e) => {
              setAddr(e.target.value);
              setErr(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && usePasted()}
          />
          <div className="btn-row" style={{ marginTop: 14 }}>
            <button className="btn btn-primary" onClick={usePasted}>
              Continue
            </button>
            <button className="btn btn-ghost" onClick={() => setPasting(false)}>
              Use a wallet
            </button>
          </div>
        </div>
      )}

      {err && <div className="notice err">{err}</div>}
    </div>
  );
}

/* ── 02 · Register ──────────────────────────────────────────────────────── */

function deriveSlug(url: string): string {
  try {
    const u = new URL(url);
    const seg = u.pathname.split("/").filter(Boolean).pop();
    const host = u.hostname.replace(/^www\./, "").split(".")[0];
    const raw = seg && seg.length > 1 ? seg : host;
    return (raw || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  } catch {
    return "";
  }
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;

export function RegisterStep({
  wallet,
  draft,
  onDraft,
  onChangeWallet,
  onRegistered,
}: {
  wallet: string;
  draft: RegisterDraft;
  onDraft: (patch: Partial<RegisterDraft>) => void;
  onChangeWallet: () => void;
  onRegistered: (reg: RegisterOk, input: RegisterInput) => void;
}) {
  // Form fields live on the parent page (RegisterDraft) so they survive a trip
  // back to Connect (e.g. "change" the payout address) without being wiped.
  const { url, slug, slugTouched, price, desc } = draft;
  const [busy, setBusy] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [formErr, setFormErr] = useState<string | null>(null);

  function validate(): RegisterInput | null {
    const e: Record<string, string> = {};
    let parsed: URL | null = null;
    try {
      parsed = new URL(url.trim());
    } catch {
      e.url = "Enter a full URL, like https://api.yoursite.com/data";
    }
    if (parsed && parsed.protocol !== "https:") e.url = "The URL must use https://";
    if (!SLUG_RE.test(slug.trim()))
      e.slug = "Lowercase letters, numbers, and hyphens. 2–40 characters.";
    const p = Number(price);
    if (!/^\d+(\.\d{1,6})?$/.test(price.trim()) || p <= 0)
      e.price = "A positive amount, up to 6 decimals (e.g. 0.001).";
    else if (p > 1000) e.price = "Keep it under 1000 for now.";
    setErrs(e);
    if (Object.keys(e).length) return null;
    return {
      slug: slug.trim(),
      target_url: url.trim(),
      price_usdc: price.trim(),
      publisher_wallet: wallet,
      description: desc.trim() || undefined,
    };
  }

  async function submit() {
    setFormErr(null);
    const input = validate();
    if (!input) return;
    setBusy(true);
    const res = await registerEndpoint(input);
    setBusy(false);
    if (res.ok) {
      onRegistered(res.data, input);
      return;
    }
    if (res.status === 409) setErrs((p) => ({ ...p, slug: "Taken — try another id." }));
    else if (res.details?.length) {
      // map server validation to fields
      const e: Record<string, string> = {};
      for (const d of res.details) {
        if (d.includes("slug")) e.slug = d;
        else if (d.includes("target_url")) e.url = d;
        else if (d.includes("price")) e.price = d;
        else if (d.includes("wallet")) e.wallet = d;
      }
      setErrs(e);
    } else setFormErr(res.error);
  }

  return (
    <div className="card">
      <p className="step-eyebrow">Step 02 — Register</p>
      <h2>Point Stent at your API</h2>
      <p className="lede">
        Stent sits in front of this URL and adds the paywall. Your server stays exactly as it is.
      </p>

      <div className="field">
        <label className="label" htmlFor="url">
          Your API endpoint <span className="req">*</span>
        </label>
        <input
          id="url"
          className={`input ${errs.url ? "bad" : ""}`}
          placeholder="https://api.yoursite.com/data"
          value={url}
          onChange={(e) => {
            const v = e.target.value;
            onDraft(slugTouched ? { url: v } : { url: v, slug: deriveSlug(v) });
            setErrs((p) => ({ ...p, url: "" }));
          }}
        />
        {errs.url ? (
          <div className="field-error">{errs.url}</div>
        ) : (
          <div className="hint">Must be reachable over https. Stent forwards each paid request here.</div>
        )}
      </div>

      <div className="grid-2">
        <div className="field">
          <label className="label" htmlFor="slug">
            Endpoint id <span className="req">*</span>
          </label>
          <input
            id="slug"
            className={`input ${errs.slug ? "bad" : ""}`}
            placeholder="weather-now"
            value={slug}
            onChange={(e) => {
              onDraft({ slug: e.target.value, slugTouched: true });
              setErrs((p) => ({ ...p, slug: "" }));
            }}
          />
          {errs.slug ? (
            <div className="field-error">{errs.slug}</div>
          ) : (
            <div className="hint">Your public path: {PROXY_URL}/{slug || "weather-now"}</div>
          )}
        </div>

        <div className="field">
          <label className="label" htmlFor="price">
            Price per request <span className="req">*</span>
          </label>
          <div className="input-prefix">
            <span className="pfx">$</span>
            <input
              id="price"
              className={`input ${errs.price ? "bad" : ""}`}
              inputMode="decimal"
              placeholder="0.001"
              value={price}
              onChange={(e) => {
                onDraft({ price: e.target.value });
                setErrs((p) => ({ ...p, price: "" }));
              }}
            />
          </div>
          {errs.price ? (
            <div className="field-error">{errs.price}</div>
          ) : (
            <div className="hint">USDC, charged per call.</div>
          )}
        </div>
      </div>

      <div className="field">
        <label className="label" htmlFor="desc">
          Description <span className="muted">(optional)</span>
        </label>
        <textarea
          id="desc"
          className="textarea"
          placeholder="What does this endpoint return? Agents see this in the directory."
          value={desc}
          onChange={(e) => onDraft({ desc: e.target.value })}
          maxLength={280}
        />
      </div>

      <div className="divider" />

      <div className="btn-row between">
        <div className="wallet-chip">
          <span className="avatar" />
          <span className="addr">{shortAddr(wallet)}</span>
          <button className="swap" onClick={onChangeWallet}>
            change
          </button>
        </div>
        <button className="btn btn-primary" onClick={submit} disabled={busy}>
          {busy ? "Creating…" : "Create endpoint"}
        </button>
      </div>

      {errs.wallet && <div className="notice err">{errs.wallet}</div>}
      {formErr && <div className="notice err">{formErr}</div>}
    </div>
  );
}

/* ── 03 · Verify ────────────────────────────────────────────────────────── */

export function VerifyStep({
  reg,
  origin,
  targetUrl,
  onVerified,
}: {
  reg: RegisterOk;
  origin: string;
  targetUrl: string;
  onVerified: () => void;
}) {
  const [phase, setPhase] = useState<"idle" | "checking" | "failed">("idle");
  const [msg, setMsg] = useState<VerifyMessage | null>(null);
  const [progress, setProgress] = useState(0); // 0..1 across the polling window
  const cancelRef = useRef(false);
  const fileUrl = `${origin}/stent-verification.txt`;

  // Stop polling if the publisher leaves this step.
  useEffect(() => () => {
    cancelRef.current = true;
  }, []);

  async function poll() {
    cancelRef.current = false;
    setPhase("checking");
    setMsg(null);
    setProgress(0);
    const deadline = Date.now() + WINDOW_MS;
    while (!cancelRef.current) {
      const r = await verifyEndpoint(reg.slug);
      if (cancelRef.current) return;
      if (r.verified) {
        onVerified();
        return;
      }
      setMsg(verifyMessage(r, { fileUrl })); // remember the latest reason for the timeout state
      const remaining = deadline - Date.now();
      setProgress(Math.min(1, 1 - remaining / WINDOW_MS));
      if (remaining <= POLL_MS) break;
      await sleep(POLL_MS);
    }
    if (!cancelRef.current) {
      setProgress(1);
      setPhase("failed");
    }
  }

  function stop() {
    cancelRef.current = true;
    setPhase("idle");
  }

  return (
    <div className="card">
      <p className="step-eyebrow">Step 03 — Verify</p>
      <h2>Prove the API is yours</h2>
      <p className="lede">
        One quick check stops anyone else from paywalling your URL. Make your server return this
        token, then we&apos;ll confirm it.
      </p>

      <div className="url-map" aria-label="Where the verification file goes">
        <div className="url-row top">
          <span className="url-k">Your API</span>
          <span className="url-v mono">{targetUrl || `${origin}/…`}</span>
        </div>
        <div className="url-row">
          <span className="url-k">Verification file</span>
          <span className="url-v file mono">{fileUrl}</span>
        </div>
        <div className="url-note">same host · domain root · not under your API path</div>
      </div>

      <ol className="ol" style={{ marginTop: 18 }}>
        <li>
          Make your server return this exact token as plain text:
          <div style={{ height: 8 }} />
          <InlineCopy value={reg.verification_token} />
          <div className="hint" style={{ marginTop: 8 }}>
            Token only — no quotes, HTML, or extra lines.
          </div>
        </li>
        <li style={{ paddingTop: 14 }}>
          …served at this exact URL:
          <div style={{ height: 8 }} />
          <InlineCopy value={fileUrl} />
        </li>
      </ol>

      <details className="host-help">
        <summary>How do I host this file?</summary>
        <div className="host-body">
          <p>
            <strong>Static site:</strong> add a file named{" "}
            <span className="mono">stent-verification.txt</span> at your web root containing only
            the token.
          </p>
          <p style={{ marginBottom: 8 }}>
            <strong>Express / Node:</strong>
          </p>
          <CodeBlock
            code={`app.get("/stent-verification.txt", (_req, res) =>\n  res.type("text/plain").send("${reg.verification_token}")\n);`}
          />
        </div>
      </details>

      {phase === "checking" ? (
        <div style={{ marginTop: 22 }}>
          <div className="check" role="status" aria-live="polite">
            <span className="spinner" aria-hidden="true" />
            <div>
              <div className="check-text">Checking for your file…</div>
              <div className="check-sub">We&apos;ll keep trying for about a minute.</div>
            </div>
            <button className="btn btn-ghost" style={{ marginLeft: "auto" }} onClick={stop}>
              Stop
            </button>
          </div>
          <div className="progress" aria-hidden="true">
            <i style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        </div>
      ) : (
        <div className="btn-row" style={{ marginTop: 22 }}>
          <button className="btn btn-primary" onClick={poll}>
            {phase === "failed" ? "Check again" : "I've added the file — check"}
          </button>
          <a className="btn btn-ghost" href={fileUrl} target="_blank" rel="noreferrer">
            Open the file
          </a>
        </div>
      )}

      {phase === "failed" && msg && (
        <div className="notice err">
          <strong>{msg.title}</strong>
          <p style={{ margin: "4px 0 0" }}>{msg.guidance}</p>
          <p style={{ margin: "8px 0 0", fontSize: 12, opacity: 0.7 }}>
            details: <span className="mono">{msg.detail}</span>
          </p>
        </div>
      )}
    </div>
  );
}

/* ── 04 · Live ──────────────────────────────────────────────────────────── */

export function LiveStep({
  slug,
  price,
  wallet,
  onReset,
}: {
  slug: string;
  price: string;
  wallet: string;
  onReset: () => void;
}) {
  return (
    <div className="card">
      <p className="step-eyebrow" style={{ color: "var(--live-2)" }}>
        Step 04 — Live
      </p>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <h2 style={{ marginBottom: 0 }}>Your endpoint is live</h2>
        <StatusBadge verified active />
      </div>
      <p className="lede" style={{ marginTop: 10 }}>
        Stent now charges <strong>${price}</strong> in USDC per request and forwards each paid call
        to your API. Hand this to any agent developer.
      </p>

      <div className="kv">
        <div className="kv-row">
          <span className="kv-k">Public URL</span>
          <span className="kv-v">{endpointUrl(slug)}</span>
        </div>
        <div className="kv-row">
          <span className="kv-k">Price</span>
          <span className="kv-v">${price} / request</span>
        </div>
        <div className="kv-row">
          <span className="kv-k">Earnings to</span>
          <span className="kv-v">{shortAddr(wallet)}</span>
        </div>
        <div className="kv-row">
          <span className="kv-k">Network</span>
          <span className="kv-v">{NETWORK_LABEL}</span>
        </div>
      </div>

      <div style={{ height: 24 }} />
      <p className="label" style={{ marginBottom: 10 }}>
        Drop-in for an agent (TypeScript)
      </p>
      <CodeBlock code={sdkSnippet(slug)} />

      <div style={{ height: 14 }} />
      <p className="label" style={{ marginBottom: 10 }}>
        Or see the paywall yourself
      </p>
      <CodeBlock code={curlSnippet(slug)} />

      <div className="btn-row" style={{ marginTop: 24 }}>
        <button className="btn btn-ghost" onClick={onReset}>
          Register another endpoint
        </button>
      </div>
    </div>
  );
}
