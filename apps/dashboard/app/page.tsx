import Link from "next/link";
import { NETWORK_LABEL, PROXY_URL } from "@/lib/config";

const PATH = [
  {
    title: "Point Stent at your HTTPS endpoint",
    text: "Use the API you already run. Stent becomes the paid public URL in front of it.",
  },
  {
    title: "Set the price per successful request",
    text: "Start with a small USDC price and change your product before you change your server.",
  },
  {
    title: "Prove you control the API",
    text: "Add one verification file or response header. Stent checks it automatically.",
  },
  {
    title: "Run the first paid request",
    text: "The success screen gives the paywall check and buyer request code in the product.",
  },
];

export default function Landing() {
  return (
    <main className="home">
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-hero-copy">
          <p className="page-kicker">Paid API links for existing endpoints</p>
          <h1 id="home-title">Sell access to an API you already run.</h1>
          <p className="home-lede">
            Stent adds a per-request USDC paywall in front of your HTTPS endpoint. Paste the URL,
            set a price, verify ownership, and share one paid link.
          </p>
          <div className="hero-actions">
            <Link href="/publish" className="btn btn-primary btn-lg">
              Publish your first API
            </Link>
            <Link href="/marketplace" className="text-link">
              Browse paid APIs
            </Link>
          </div>
        </div>

        <aside className="home-terminal" aria-label="What Stent creates">
          <div className="terminal-head">
            <span>First paid API</span>
            <span className="badge live">
              <span className="dot" />
              Ready after verify
            </span>
          </div>
          <dl className="terminal-list">
            <div>
              <dt>Your API</dt>
              <dd className="mono">https://api.yoursite.com/data</dd>
            </div>
            <div>
              <dt>Price</dt>
              <dd className="mono">$0.001 / request</dd>
            </div>
            <div>
              <dt>Paid URL</dt>
              <dd className="mono">{PROXY_URL.replace(/^https?:\/\//, "")}/weather-now</dd>
            </div>
          </dl>
          <p className="terminal-note">
            Buyers pay first. Stent forwards the request only after the payment clears on{" "}
            {NETWORK_LABEL}.
          </p>
        </aside>
      </section>

      <section className="home-fit" aria-labelledby="fit-title">
        <div className="section-copy">
          <p className="page-kicker">Who it is for</p>
          <h2 id="fit-title">Use Stent when the API already exists and the missing piece is payment.</h2>
        </div>
        <div className="fit-grid">
          <article className="fit-panel fit-primary">
            <h3>API owners</h3>
            <p>
              You have a working endpoint and want to charge per request without adding accounts,
              subscriptions, checkout, or billing code.
            </p>
          </article>
          <article className="fit-panel">
            <h3>Agent and app builders</h3>
            <p>
              You need a paid API URL that an agent loop or app can call with a spend cap and a
              predictable request path.
            </p>
          </article>
          <article className="fit-panel">
            <h3>Not a fit</h3>
            <p>
              Stent does not host your API, change your payment model, or introduce smart
              contracts. It is the paid access layer in front of what you already run.
            </p>
          </article>
        </div>
      </section>

      <section className="home-path" aria-labelledby="path-title">
        <div className="section-copy">
          <p className="page-kicker">First success</p>
          <h2 id="path-title">The product is built around one activation path.</h2>
          <p>
            Every screen moves a new publisher toward a verified paid URL and the first paid
            request. Documentation is available, but it is not required to finish.
          </p>
        </div>
        <div className="path-list">
          {PATH.map((step, index) => (
            <article className="path-row" key={step.title}>
              <span className="path-index mono">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="home-commit" aria-labelledby="commit-title">
        <div>
          <p className="page-kicker">What stays true</p>
          <h2 id="commit-title">Your server stays unchanged.</h2>
          <p>
            Stent reuses the existing proxy, verification, marketplace, sample response, and SDK
            surfaces. V2 changes the product journey, not the backend architecture.
          </p>
        </div>
        <Link href="/publish" className="btn btn-ghost btn-lg">
          Start with one endpoint
        </Link>
      </section>
    </main>
  );
}
