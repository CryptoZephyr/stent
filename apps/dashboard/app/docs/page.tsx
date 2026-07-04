import Link from "next/link";
import { NETWORK_LABEL, PROXY_URL } from "@/lib/config";
import { CodeBlock } from "@/components/ui";

const VERIFY_FILE_EXAMPLE = `app.get("/stent-verification.txt", (_req, res) =>
  res.type("text/plain").send("stent-verify-...")
);`;

const VERIFY_HEADER_EXAMPLE = `app.get("/data", (_req, res) => {
  res.set("X-Stent-Verify", "stent-verify-...");
  res.json({ ok: true });
});`;

const SDK_EXAMPLE = `// npm install stent-sdk
import { StentClient } from "stent-sdk";

const client = new StentClient({
  privateKey: process.env.BUYER_PRIVATE_KEY,
  spendCapUsdc: 1.00,
});

// One-time setup after funding a buyer wallet with testnet USDC:
// await client.deposit("10");

const data = await client.fetch("${PROXY_URL}/your-api");
console.log(data);`;

export default function DocsPage() {
  return (
    <main className="docs-page">
      <header className="page-hero compact">
        <div>
          <p className="page-kicker">Reference</p>
          <h1>Use Stent when you already know the task.</h1>
          <p>
            The publish flow contains everything needed for first success. Use this page for exact
            verification methods, SDK setup, and proxy API routes.
          </p>
        </div>
        <Link href="/publish" className="btn btn-primary btn-lg">
          Publish API
        </Link>
      </header>

      <section className="docs-layout">
        <nav className="docs-index" aria-label="Docs sections">
          <a href="#publish">Publish</a>
          <a href="#verify">Verify ownership</a>
          <a href="#paid-request">Paid request</a>
          <a href="#api">Proxy API</a>
          <a href="#errors">Errors</a>
        </nav>

        <div className="docs-content">
          <section id="publish" className="doc-section">
            <h2>Publish an API</h2>
            <p>
              Publishing registers an existing HTTPS endpoint with a slug, a USDC price, a payout
              address, and an optional marketplace description. Registration creates an unverified
              endpoint until ownership is confirmed.
            </p>
            <ol className="ordered-list">
              <li>Enter the endpoint URL, public paid URL name, and per-request price.</li>
              <li>Add the payout wallet that should receive publisher earnings.</li>
              <li>Verify ownership with a file or response header.</li>
              <li>Run the paywall check and paid request from the success screen.</li>
            </ol>
          </section>

          <section id="verify" className="doc-section">
            <h2>Verify ownership</h2>
            <p>
              Stent checks a root file first. If your hosting setup cannot serve a root file, it
              checks the API endpoint response header next.
            </p>
            <div className="doc-grid">
              <article>
                <h3>Root file</h3>
                <p>Serve the token as plain text at your domain root.</p>
                <CodeBlock code={VERIFY_FILE_EXAMPLE} filename="server.ts" />
              </article>
              <article>
                <h3>Response header</h3>
                <p>Return the token on the endpoint response itself.</p>
                <CodeBlock code={VERIFY_HEADER_EXAMPLE} filename="server.ts" />
              </article>
            </div>
          </section>

          <section id="paid-request" className="doc-section">
            <h2>Make a paid request</h2>
            <p>
              Buyers use a funded EVM wallet, deposit into Gateway once, then call the paid Stent
              URL with a spend cap. Payments currently settle on {NETWORK_LABEL}.
            </p>
            <CodeBlock code={SDK_EXAMPLE} filename="agent.ts" />
          </section>

          <section id="api" className="doc-section">
            <h2>Proxy API reference</h2>
            <p>
              These routes live on the proxy at <span className="mono">{PROXY_URL}</span>. The
              dashboard uses the same routes.
            </p>
            <div className="api-table">
              <div>
                <code>POST /_api/endpoints</code>
                <span>Register an unverified endpoint and receive a verification token.</span>
              </div>
              <div>
                <code>POST /_api/endpoints/:slug/verify</code>
                <span>Check the verification file, then the X-Stent-Verify header.</span>
              </div>
              <div>
                <code>GET /_api/endpoints</code>
                <span>List active, verified public endpoints for the marketplace.</span>
              </div>
              <div>
                <code>GET /_api/endpoints/:slug</code>
                <span>Load price, status, publisher wallet, and sample response.</span>
              </div>
              <div>
                <code>PATCH /_api/endpoints/:slug</code>
                <span>Pause or resume with a payout-wallet signature.</span>
              </div>
            </div>
          </section>

          <section id="errors" className="doc-section">
            <h2>Common fixes</h2>
            <div className="fix-list">
              <article>
                <h3>Verification keeps failing</h3>
                <p>
                  Open the verification URL directly. It must return only the token, or your API
                  response must include the exact X-Stent-Verify header.
                </p>
              </article>
              <article>
                <h3>The paid request cannot fund</h3>
                <p>
                  Fund the buyer wallet with testnet USDC, then deposit into Gateway before calling
                  the paid URL.
                </p>
              </article>
              <article>
                <h3>The slug is taken</h3>
                <p>Choose another paid URL name. Slugs are unique across public Stent endpoints.</p>
              </article>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
