"use client";

import { useEffect, useRef, useState } from "react";
import { isAddress as isChecksumAddress } from "viem";
import { connectInjected, isAddress, shortAddr } from "@/lib/wallet";
import type { RegisterDraft } from "@/lib/api";
import { registerEndpoint, verifyEndpoint, type RegisterInput, type RegisterOk } from "@/lib/api";
import { verifyMessage, type VerifyMessage } from "@/lib/verifyMessages";
import { NETWORK_LABEL, PROXY_URL } from "@/lib/config";
import { endpointUrl, sdkSnippet, curlSnippet } from "@/lib/snippet";
import { CodeBlock, InlineCopy, StatusBadge } from "./ui";

// Verify polling schedule: 7 checks max per round (immediate + 6 retries),
// spread over ~60s. Delays are the WAIT before each subsequent check, so the
// checks land at t = 0s, 5s, 15s, 27s, 39s, 51s, 63s. Two full rounds back to
// back stay well under the proxy's REGISTER_RPM (20/min) budget.
const POLL_DELAYS_MS = [5000, 10000, 12000, 12000, 12000, 12000];
const WINDOW_MS = 60000;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function deriveSlug(url: string): string {
  try {
    const u = new URL(url);
    const seg = u.pathname.split("/").filter(Boolean).pop();
    const host = u.hostname.replace(/^www\./, "").split(".")[0];
    const raw = seg && seg.length > 1 ? seg : host;
    return (raw || "")
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
  } catch {
    return "";
  }
}

function validateDraft(draft: RegisterDraft): { ok: true } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  let parsed: URL | null = null;

  try {
    parsed = new URL(draft.url.trim());
  } catch {
    errors.url = "Enter a full URL, like https://api.yoursite.com/data.";
  }

  if (parsed && parsed.protocol !== "https:") {
    errors.url = "Use an https:// endpoint. Stent only publishes secure URLs.";
  }

  if (!SLUG_RE.test(draft.slug.trim())) {
    errors.slug = "Use lowercase letters, numbers, and hyphens. Keep it 2-40 characters.";
  }

  const price = Number(draft.price);
  if (!/^\d+(\.\d{1,6})?$/.test(draft.price.trim()) || price <= 0) {
    errors.price = "Enter a positive USDC amount, up to 6 decimals.";
  } else if (price > 1000) {
    errors.price = "Keep the price under 1000 USDC for now.";
  }

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true };
}

export function ApiStep({
  draft,
  onDraft,
  onContinue,
}: {
  draft: RegisterDraft;
  onDraft: (patch: Partial<RegisterDraft>) => void;
  onContinue: () => void;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});

  function next() {
    const result = validateDraft(draft);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    onContinue();
  }

  return (
    <div className="flow-card">
      <p className="page-kicker">API details</p>
      <h2>What API should Stent sell access to?</h2>
      <p className="lede">
        Start with one endpoint. Stent will create a paid public URL and forward successful paid
        requests to the URL you enter here.
      </p>

      <div className="field">
        <label className="label" htmlFor="url">
          Existing HTTPS endpoint
        </label>
        <input
          id="url"
          className={`input ${errors.url ? "bad" : ""}`}
          placeholder="https://api.yoursite.com/data"
          value={draft.url}
          onChange={(e) => {
            const url = e.target.value;
            onDraft(draft.slugTouched ? { url } : { url, slug: deriveSlug(url) });
            setErrors((current) => ({ ...current, url: "" }));
          }}
          onKeyDown={(e) => e.key === "Enter" && next()}
        />
        {errors.url ? (
          <p className="field-error">{errors.url}</p>
        ) : (
          <>
            <p className="hint">Your API keeps returning the same data. Stent adds paid access.</p>
            <p className="hint">
              No API yet?{" "}
              <a className="text-link" href="/docs#sample-origin">
                See the docs for a 10-line sample origin you can deploy free.
              </a>
            </p>
          </>
        )}
      </div>

      <div className="grid-2">
        <div className="field">
          <label className="label" htmlFor="slug">
            Paid URL name
          </label>
          <input
            id="slug"
            className={`input ${errors.slug ? "bad" : ""}`}
            placeholder="weather-now"
            value={draft.slug}
            onChange={(e) => {
              onDraft({ slug: e.target.value, slugTouched: true });
              setErrors((current) => ({ ...current, slug: "" }));
            }}
            onKeyDown={(e) => e.key === "Enter" && next()}
          />
          {errors.slug ? (
            <p className="field-error">{errors.slug}</p>
          ) : (
            <p className="hint">
              Paid URL preview: {PROXY_URL}/{draft.slug || "weather-now"}
            </p>
          )}
        </div>

        <div className="field">
          <label className="label" htmlFor="price">
            Price per successful request
          </label>
          <div className="input-prefix">
            <span className="pfx">$</span>
            <input
              id="price"
              className={`input ${errors.price ? "bad" : ""}`}
              inputMode="decimal"
              placeholder="0.001"
              value={draft.price}
              onChange={(e) => {
                onDraft({ price: e.target.value });
                setErrors((current) => ({ ...current, price: "" }));
              }}
              onKeyDown={(e) => e.key === "Enter" && next()}
            />
          </div>
          {errors.price ? (
            <p className="field-error">{errors.price}</p>
          ) : (
            <p className="hint">Charged only when Stent forwards a successful paid request.</p>
          )}
        </div>
      </div>

      <div className="action-row">
        <button className="btn btn-primary" onClick={next}>
          Continue to earnings
        </button>
      </div>

      <details className="optional-field">
        <summary>Add marketplace description</summary>
        <div className="field">
          <label className="label" htmlFor="desc">
            What will buyers receive?
          </label>
          <textarea
            id="desc"
            className="textarea"
            placeholder="Describe the response buyers will receive."
            value={draft.desc}
            onChange={(e) => onDraft({ desc: e.target.value })}
            maxLength={280}
          />
          <p className="hint">Optional. You can publish without this.</p>
        </div>
      </details>
    </div>
  );
}

export function EarningsStep({
  draft,
  wallet,
  onWallet,
  onBack,
  onRegistered,
}: {
  draft: RegisterDraft;
  wallet: string | null;
  onWallet: (wallet: string) => void;
  onBack: () => void;
  onRegistered: (reg: RegisterOk, input: RegisterInput) => void;
}) {
  const [addr, setAddr] = useState(wallet ?? "");
  const [mode, setMode] = useState<"paste" | "wallet">("paste");
  const [busy, setBusy] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [addrErr, setAddrErr] = useState<string | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);

  async function useWallet() {
    setAddrErr(null);
    setFormErr(null);
    setBusy(true);
    try {
      const connected = await connectInjected();
      setAddr(connected);
      onWallet(connected);
      setMode("paste");
    } catch (e) {
      const code = (e as Error).message;
      setFormErr(
        code === "no_wallet"
          ? "No browser wallet detected. Paste the payout address instead."
          : "Wallet connection was canceled."
      );
      setMode("paste");
    } finally {
      setBusy(false);
    }
  }

  function validateAddress(): string | null {
    const value = addr.trim();
    if (!isAddress(value)) return "Enter a wallet address that starts with 0x and has 42 characters.";
    if (!isChecksumAddress(value)) return "That address checksum does not match. Re-copy it or paste it in all lowercase.";
    return null;
  }

  async function createEndpoint() {
    const addressError = validateAddress();
    if (addressError) {
      setAddrErr(addressError);
      return;
    }

    const draftResult = validateDraft(draft);
    if (!draftResult.ok) {
      setFormErr("Go back and fix the API details before creating the paid URL.");
      return;
    }

    const publisher_wallet = addr.trim();
    onWallet(publisher_wallet);
    const input: RegisterInput = {
      slug: draft.slug.trim(),
      target_url: draft.url.trim(),
      price_usdc: draft.price.trim(),
      publisher_wallet,
      description: draft.desc.trim() || undefined,
    };

    setAddrErr(null);
    setFormErr(null);
    setRegistering(true);
    const result = await registerEndpoint(input);
    setRegistering(false);

    if (result.ok) {
      onRegistered(result.data, input);
      return;
    }

    if (result.status === 409) setFormErr("That paid URL name is taken. Go back and choose another.");
    else if (result.details?.length) setFormErr(result.details[0]);
    else setFormErr(result.error);
  }

  return (
    <div className="flow-card">
      <p className="page-kicker">Earnings</p>
      <h2>Where should paid requests send USDC?</h2>
      <p className="lede">
        This is the payout address for every successful paid request. You are not signing anything
        to publish; Stent only needs the destination address.
      </p>

      <div className="endpoint-summary">
        <div>
          <span>Paid URL</span>
          <strong className="mono">{PROXY_URL}/{draft.slug || "your-api"}</strong>
        </div>
        <div>
          <span>Price</span>
          <strong className="mono">${draft.price || "0.001"} / request</strong>
        </div>
      </div>

      {mode === "wallet" ? (
        <div className="action-row">
          <button className="btn btn-primary" onClick={useWallet} disabled={busy}>
            {busy ? "Opening wallet..." : "Connect wallet"}
          </button>
          <button className="btn btn-quiet" onClick={() => setMode("paste")}>
            Paste address instead
          </button>
        </div>
      ) : (
        <div className="field">
          <label className="label" htmlFor="payout">
            Payout address
          </label>
          <input
            id="payout"
            className={`input ${addrErr ? "bad" : ""}`}
            placeholder="0x..."
            value={addr}
            onChange={(e) => {
              setAddr(e.target.value);
              setAddrErr(null);
              setFormErr(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && createEndpoint()}
          />
          {addrErr ? (
            <p className="field-error">{addrErr}</p>
          ) : (
            <p className="hint">Use the address that should receive publisher earnings.</p>
          )}
        </div>
      )}

      {formErr && <div className="notice err">{formErr}</div>}

      <div className="action-row between">
        <button className="btn btn-quiet" onClick={onBack}>
          Back to API details
        </button>
        <div className="action-row compact">
          {mode === "paste" && (
            <button className="btn btn-ghost" onClick={() => setMode("wallet")}>
              Use a wallet
            </button>
          )}
          <button className="btn btn-primary" onClick={createEndpoint} disabled={registering}>
            {registering ? "Creating..." : "Create paid URL"}
          </button>
        </div>
      </div>
    </div>
  );
}

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
  const [progress, setProgress] = useState(0);
  const cancelRef = useRef(false);
  const fileUrl = `${origin}/stent-verification.txt`;

  useEffect(
    () => () => {
      cancelRef.current = true;
    },
    []
  );

  async function poll() {
    cancelRef.current = false;
    setPhase("checking");
    setMsg(null);
    setProgress(0);
    const start = Date.now();

    // Immediate check, then retries at increasing intervals (POLL_DELAYS_MS).
    // At most 1 + POLL_DELAYS_MS.length requests per round, regardless of how
    // this loop is entered — keeps us well under the proxy's per-IP register
    // rate limit even across two consecutive rounds.
    const attempts = POLL_DELAYS_MS.length + 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) await sleep(POLL_DELAYS_MS[attempt - 1]);
      if (cancelRef.current) return;

      const result = await verifyEndpoint(reg.slug);
      if (cancelRef.current) return;

      if (result.verified) {
        onVerified();
        return;
      }

      if (result.status === 429) {
        setMsg({
          title: "Too many verification checks",
          guidance: "Too many verification checks in the last minute. Wait a moment, then Check again.",
          detail: "rate_limited",
        });
        setProgress(1);
        setPhase("failed");
        return;
      }

      setMsg(verifyMessage(result, { fileUrl }));
      setProgress(Math.min(1, (Date.now() - start) / WINDOW_MS));
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
    <div className="flow-card">
      <p className="page-kicker">Ownership</p>
      <h2>Prove this API is yours.</h2>
      <p className="lede">
        This check prevents someone else from charging for your URL. Add the token once, then
        Stent verifies it automatically.
      </p>

      <div className="verify-map">
        <div>
          <span>Your API</span>
          <strong className="mono">{targetUrl || `${origin}/...`}</strong>
        </div>
        <div>
          <span>Verification file</span>
          <strong className="mono">{fileUrl}</strong>
        </div>
      </div>

      <div className="verify-steps">
        <article>
          <h3>1. Return this exact token as plain text</h3>
          <InlineCopy value={reg.verification_token} />
          <p className="hint">Token only. No quotes, HTML, or extra lines.</p>
        </article>
        <article>
          <h3>2. Serve it at this URL</h3>
          <InlineCopy value={fileUrl} />
          <p className="hint">Same host, domain root. Stent checks this first.</p>
        </article>
      </div>

      <details className="host-help">
        <summary>Use a response header instead</summary>
        <div className="host-body">
          <p>
            If you cannot add a root file, return this header from the API endpoint itself. Stent
            checks the file first, then the header.
          </p>
          <InlineCopy value={`X-Stent-Verify: ${reg.verification_token}`} />
          <CodeBlock
            filename="server.ts"
            code={`app.get("/data", (_req, res) => {\n  res.set("X-Stent-Verify", "${reg.verification_token}");\n  res.json({ ok: true });\n});`}
          />
        </div>
      </details>

      {phase === "checking" ? (
        <div className="check-wrap">
          <div className="check" role="status" aria-live="polite">
            <span className="spinner" aria-hidden="true" />
            <div>
              <div className="check-text">Checking for verification...</div>
              <div className="check-sub">Stent will keep trying for about a minute.</div>
            </div>
            <button className="btn btn-quiet" onClick={stop}>
              Stop
            </button>
          </div>
          <div className="progress" aria-hidden="true">
            <i style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        </div>
      ) : (
        <div className="action-row">
          <button className="btn btn-primary" onClick={poll}>
            {phase === "failed" ? "Check again" : "Check verification"}
          </button>
          <a className="text-link" href={fileUrl} target="_blank" rel="noreferrer">
            Open verification URL
          </a>
        </div>
      )}

      {phase === "failed" && msg && (
        <div className="notice err">
          <strong>{msg.title}</strong>
          <p>{msg.guidance}</p>
          <small className="mono">details: {msg.detail}</small>
        </div>
      )}
    </div>
  );
}

export function FirstPaidRequestStep({
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
    <div className="flow-card success-card">
      <div className="success-head">
        <div>
          <p className="page-kicker">First paid request</p>
          <h2>Your paid API is live. Now run one paid call.</h2>
        </div>
        <StatusBadge verified active />
      </div>

      <p className="lede">
        Stent charges <strong>${price}</strong> per successful request and forwards paid calls to
        your API. The last activation step is proving the buyer path works.
      </p>

      <div className="endpoint-summary">
        <div>
          <span>Public URL</span>
          <strong className="mono">{endpointUrl(slug)}</strong>
        </div>
        <div>
          <span>Earnings</span>
          <strong className="mono">{shortAddr(wallet)}</strong>
        </div>
        <div>
          <span>Network</span>
          <strong className="mono">{NETWORK_LABEL}</strong>
        </div>
      </div>

      <section className="request-block" aria-labelledby="paywall-check">
        <div>
          <h3 id="paywall-check">First, confirm the paywall</h3>
          <p className="hint">This unpaid request should return HTTP 402.</p>
        </div>
        <CodeBlock code={curlSnippet(slug)} filename="terminal" />
      </section>

      <section className="request-block" aria-labelledby="paid-request">
        <div>
          <h3 id="paid-request">Then complete a paid request</h3>
          <p className="hint">
            Use a funded buyer wallet with a small spend cap. The SDK pays once, retries, and
            prints your API response.
          </p>
        </div>
        <CodeBlock code={sdkSnippet(slug)} filename="first-paid-request.ts" />
      </section>

      <div className="action-row between">
        <a className="btn btn-primary" href={`/marketplace/${slug}`}>
          Open live listing
        </a>
        <button className="btn btn-quiet" onClick={onReset}>
          Publish another API
        </button>
      </div>
    </div>
  );
}
