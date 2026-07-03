import Link from "next/link";
import { NETWORK_LABEL, PROXY_URL } from "@/lib/config";
import { CodeBlock } from "@/components/ui";

const SDK_QUICKSTART = `// @stent/sdk isn't on npm yet — copy packages/sdk from
// github.com/CryptoZephyr/stent into your project.
import { StentClient, SpendCapExceededError, InsufficientGatewayBalanceError } from "@stent/sdk";

const client = new StentClient({
  privateKey: process.env.AGENT_PRIVATE_KEY, // a wallet you control
  spendCapUsdc: 1.00,                         // hard cap across this client's lifetime
});

// One-time setup: get testnet USDC from https://faucet.circle.com,
// then fund the Gateway balance this client pays from.
await client.deposit("10");

try {
  // Detects the 402, signs, pays in USDC, retries, returns the data.
  const data = await client.fetch("${PROXY_URL}/arc-stats");
  console.log(data);
} catch (err) {
  if (err instanceof SpendCapExceededError) {
    console.error("Hit the spend cap:", err.message);
  } else if (err instanceof InsufficientGatewayBalanceError) {
    // err.requiredUsdc / err.availableUsdc tell you exactly how short you are.
    console.error("Gateway balance too low:", err.message);
  } else {
    throw err;
  }
}

console.log(client.getSpendSummary());`;

const VERIFY_HEADER_EXAMPLE = `app.get("/data", (req, res) => {
  res.set("X-Stent-Verify", "stent-verify-..."); // your token from registration
  res.json({ /* your real response */ });
});`;

const VERIFY_FILE_EXAMPLE = `app.get("/stent-verification.txt", (_req, res) =>
  res.type("text/plain").send("stent-verify-...")
);`;

export default function DocsPage() {
  return (
    <>
      <header className="rig">
        <div className="rig-inner">
          <div className="brand-row">
            <div className="brand">
              <span className="brand-mark">STENT</span>
              <span className="badge-402">DOCS</span>
            </div>
            <div className="network">
              <span className="dot" />
              {NETWORK_LABEL}
            </div>
          </div>
          <div className="thesis">
            <p className="eyebrow">
              <b>Reference</b> — how Stent actually works
            </p>
            <h1>Publish, pay, integrate.</h1>
            <p>
              Four short guides covering the whole product: putting a price on an API, paying for
              one as an agent, the SDK, and the raw <span className="mono">/_api</span> surface
              underneath the dashboard.
            </p>
          </div>
        </div>
      </header>

      <main className="stage">
        <div className="card">
          <p className="step-eyebrow">Contents</p>
          <div className="btn-row" style={{ flexWrap: "wrap" }}>
            <a className="btn btn-ghost" href="#publish">
              Publish an API
            </a>
            <a className="btn btn-ghost" href="#pay">
              Pay for an API
            </a>
            <a className="btn btn-ghost" href="#sdk">
              SDK quickstart
            </a>
            <a className="btn btn-ghost" href="#api-reference">
              /_api reference
            </a>
          </div>
        </div>

        {/* ── Publish an API ── */}
        <div id="publish" className="card">
          <p className="step-eyebrow">01 — Publish</p>
          <h2>Publish an API</h2>
          <p className="lede">
            Publishing does not touch your server. Stent sits in front of your existing URL and
            adds the paywall.
          </p>
          <ol className="ol">
            <li>
              Give a payout wallet address. This is just where USDC lands — no signature is
              required to register.
            </li>
            <li>
              Register the endpoint (<span className="mono">POST /_api/endpoints</span>): your
              API&apos;s HTTPS URL, a slug, a price in USDC, and an optional description. You get
              back a verification token.
            </li>
            <li>
              Prove you control the URL, either way:
              <div style={{ height: 8 }} />
              <p className="hint">
                <strong>File</strong> — serve the token as plain text at{" "}
                <span className="mono">{"{your domain's root}"}/stent-verification.txt</span>.
              </p>
              <CodeBlock code={VERIFY_FILE_EXAMPLE} filename="server.ts" />
              <div style={{ height: 10 }} />
              <p className="hint">
                <strong>Header</strong> — if you don&apos;t control your domain root (shared
                hosting, a managed API gateway, a subpath deployment), return the token as a
                response header on your API endpoint itself instead:
              </p>
              <CodeBlock code={VERIFY_HEADER_EXAMPLE} filename="server.ts" />
              <div style={{ height: 8 }} />
              <p className="hint">Either one verifies — the file is checked first, then the header.</p>
            </li>
            <li>
              Call <span className="mono">POST /_api/endpoints/:slug/verify</span> (the dashboard
              does this automatically while you wait). Once it matches, the endpoint is live at{" "}
              <span className="mono">{PROXY_URL}/:slug</span> and a sample of its real response is
              captured for the marketplace listing.
            </li>
          </ol>
          <p className="hint" style={{ marginTop: 14 }}>
            To pause or resume an endpoint later, connect the payout wallet on the{" "}
            <Link href="/publish">Publish</Link> page&apos;s status lookup — it signs a short
            message and calls the same <span className="mono">PATCH</span> route described below.
          </p>
          <div className="btn-row" style={{ marginTop: 18 }}>
            <Link href="/publish" className="btn btn-primary">
              Open the publish wizard →
            </Link>
          </div>
        </div>

        {/* ── Pay for an API ── */}
        <div id="pay" className="card">
          <p className="step-eyebrow">02 — Pay</p>
          <h2>Pay for an API</h2>
          <p className="lede">
            An agent needs a wallet, a small amount of testnet USDC, and the SDK — no publisher
            accounts, keys, or invoices.
          </p>
          <ol className="ol">
            <li>
              Find an endpoint on the <Link href="/marketplace">marketplace</Link>. The detail page
              shows the price, the exact URL, and — once one has been captured — a real sample of
              what the endpoint returns.
            </li>
            <li>
              Get a wallet (any EVM private key) and fund it with Arc testnet USDC from{" "}
              <span className="mono">https://faucet.circle.com</span>.
            </li>
            <li>
              Move that USDC into the Gateway balance your client pays from:{" "}
              <span className="mono">client.deposit(&quot;10&quot;)</span>. This is a one-time
              setup step, not something you do per request.
            </li>
            <li>
              Call <span className="mono">client.fetch(url)</span>. The SDK detects the 402, signs
              a payment authorization, retries, and returns the response. A spend cap you set
              yourself blocks any payment that would exceed it before it&apos;s ever signed.
            </li>
          </ol>
          <p className="hint" style={{ marginTop: 14 }}>
            If a payment fails because the Gateway balance is too low, the SDK throws a typed{" "}
            <span className="mono">InsufficientGatewayBalanceError</span> telling you the required
            and available amounts instead of a generic failure — see the SDK quickstart below.
          </p>
        </div>

        {/* ── SDK Quickstart ── */}
        <div id="sdk" className="card">
          <p className="step-eyebrow">03 — SDK</p>
          <h2>SDK quickstart</h2>
          <p className="lede">
            <span className="mono">@stent/sdk</span> wraps Circle Gateway&apos;s x402 client with a
            spend cap and clearer errors.
          </p>
          <CodeBlock code={SDK_QUICKSTART} filename="agent.ts" />
          <p className="hint" style={{ marginTop: 10 }}>
            <span className="mono">client.pay(url)</span> returns the same data plus the amount
            paid, the settlement reference, and the HTTP status, for callers that need more than
            just the response body. <span className="mono">client.getSpendSummary()</span> returns
            total spent, remaining cap, and payment count so an agent loop can budget itself.
          </p>
        </div>

        {/* ── /_api Reference ── */}
        <div id="api-reference" className="card">
          <p className="step-eyebrow">04 — Reference</p>
          <h2>
            <span className="mono">/_api</span> reference
          </h2>
          <p className="lede">
            The registration API the dashboard&apos;s publish wizard runs on top of. Every route
            below lives on the proxy, not the dashboard, at{" "}
            <span className="mono">{PROXY_URL}</span>.
          </p>

          <div className="kv" style={{ marginBottom: 4 }}>
            <div className="kv-row">
              <span className="kv-k mono">POST /_api/endpoints</span>
              <span className="kv-v">Register an unverified endpoint, get a verification token.</span>
            </div>
            <div className="kv-row">
              <span className="kv-k mono">POST /_api/endpoints/:slug/verify</span>
              <span className="kv-v">
                Check the verification file, then the X-Stent-Verify header; mark verified on
                either match. Verify-only — can never un-verify.
              </span>
            </div>
            <div className="kv-row">
              <span className="kv-k mono">GET /_api/endpoints</span>
              <span className="kv-v">Public directory: active, verified endpoints only. No tokens or target URLs.</span>
            </div>
            <div className="kv-row">
              <span className="kv-k mono">GET /_api/endpoints/:slug</span>
              <span className="kv-v">
                Status for one endpoint — price, verified/active state, and its captured sample
                response, if any.
              </span>
            </div>
            <div className="kv-row">
              <span className="kv-k mono">PATCH /_api/endpoints/:slug</span>
              <span className="kv-v">
                Pause or resume. Requires the payout wallet&apos;s signature over the slug, the new
                active value, and a timestamp — not just the address.
              </span>
            </div>
          </div>

          <p className="hint" style={{ marginTop: 14 }}>
            Registration is validated server-side: slug format, a positive USDC price with up to
            six decimals, an EVM payout address, and an HTTPS target URL (HTTP is only accepted for
            local development). Endpoints are served only once{" "}
            <span className="mono">verified = true</span> — an unverified or paused endpoint
            returns 404.
          </p>
        </div>
      </main>
    </>
  );
}
