# Stent

Stent turns an existing API into a paywalled, per-request service in about 30
seconds, with zero code changes to the origin server: no publisher accounts, no
API keys, no smart contracts, no Solidity. A publisher registers an HTTPS
endpoint, sets a USDC price, proves control of the origin, and receives a public
Stent URL. An agent calls that URL with a wallet; the proxy verifies payment,
fetches the upstream response, logs the payment, and settles through Circle
Gateway on Arc testnet.

The goal is narrow: let software buy API calls without publisher-specific API
keys, subscriptions, invoices, or custom contracts. The publisher keeps their
server unchanged; Stent sits in front of it.

Built for the Lepton Agents Hackathon, Canteen x Circle x Arc, June 2026.

## Try It Now

The SDK is on npm and the proxy/dashboard are deployed live on Arc testnet.
This pays the live `/arc-stats` endpoint ($0.001/call) through the deployed
proxy:

```bash
npm install stent-sdk
```

```ts
import { StentClient } from "stent-sdk";

const client = new StentClient({
  privateKey: process.env.BUYER_PRIVATE_KEY as `0x${string}`, // agent wallet
  spendCapUsdc: 1,
});

// One-time: fund the wallet from https://faucet.circle.com, then
// await client.deposit("10") to move USDC into the Gateway balance.

const data = await client.fetch(
  "https://stentproxy-production.up.railway.app/arc-stats"
);
console.log(data);
```

- Live dashboard: https://stent-dashboard.vercel.app
- Live proxy directory: https://stentproxy-production.up.railway.app/_api/endpoints
- Package: https://www.npmjs.com/package/stent-sdk

End-to-end (agent pays, proxy verifies and settles, ledger row lands in
Supabase) was rehearsed live on Arc testnet on July 5, 2026, with a LangChain
agent making autonomous tool calls, unique nonces per payment, and the Gateway
balance reconciled to the cent across runs.

## What Exists In This Repository

- `apps/proxy` - Express reverse proxy, x402 payment gateway, publisher
  registration API, endpoint cache, rate limiting, upstream forwarding, and
  payment logging.
- `apps/dashboard` - Next.js dashboard for publishing APIs, browsing the
  marketplace, watching live agent activity on the Runs screen (`/console`)
  and the Payments feed (`/live`), and naming agent wallets.
- `packages/sdk` - `stent-sdk`, a TypeScript client around Circle Gateway's
  x402 client with a spend cap and spend accounting.
- `apps/demo-origin` - Payment-unaware upstream API used for local and deployed
  demos.
- `supabase/migrations` - Postgres schema, RLS policies, grants, and Realtime
  publication setup.

The root package is an npm workspace. Node 22 is required (`.nvmrc` and
`package.json` both specify Node 22+).

## How A Paid Request Works

1. An agent calls `GET /:slug` on the Stent proxy.
2. The proxy resolves `slug` from its Supabase-backed cache. Only endpoints with
   `active = true` and `verified = true` are served.
3. If the request is unpaid, Circle's x402 middleware returns `402 Payment
   Required` with the endpoint price and seller wallet.
4. `StentClient` signs a payment authorization locally through Circle Gateway and
   retries with the payment header.
5. Before settlement, the proxy enforces paid-request limits, rejects replayed
   nonces, fetches the exact upstream URL once, and writes the payment row to
   Supabase.
6. If the upstream response is not 2xx, if the payment log cannot be written, or
   if a replay/rate-limit check fails, settlement is aborted.
7. If every check passes, Circle Gateway settles and the proxy returns the
   already-fetched upstream response bytes to the agent.

That ordering is deliberate: an agent only pays for data Stent can deliver, and
the ledger is written before settlement proceeds.

## Architecture

```text
Agent or SDK
  |
  | HTTPS /:slug
  v
apps/proxy
  |-- endpoint registry/cache  -> Supabase endpoints
  |-- x402 verification        -> @circle-fin/x402-batching
  |-- before-settle checks     -> rate limit, replay check, upstream fetch
  |-- payment ledger           -> Supabase payments
  |
  | one upstream request after payment verification
  v
Publisher API

apps/dashboard
  |-- publish flow             -> proxy /_api/endpoints
  |-- marketplace/status       -> proxy public API
  |-- Runs + Payments screens  -> Supabase public reads + Realtime
  |-- agent claim route        -> Supabase service role after wallet auth
```

### Proxy Runtime

The proxy exposes two route groups:

- `/_api/*` for publisher registration and endpoint status.
- `/:slug` and `/:slug/*` for paid API traffic.

Payment middlewares are cached per endpoint because Circle Gateway binds the
seller address when the middleware is created. Supabase Realtime invalidates the
cache on endpoint changes, and a full refresh runs on a timer.

The payment path is implemented across:

- `apps/proxy/src/server.ts` - Express routes and middleware chain.
- `apps/proxy/src/gateway.ts` - Circle Gateway middleware and settlement hooks.
- `apps/proxy/src/settleLogic.ts` - pure before-settle decision logic.
- `apps/proxy/src/upstream.ts` - target URL resolution and upstream forwarding.
- `apps/proxy/src/endpointCache.ts` - live endpoint cache.
- `apps/proxy/src/registration.ts` - publisher onboarding API.

### Registration API

The proxy lets publishers onboard without SQL access:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/_api/endpoints` | Create an unverified endpoint and return a verification token. |
| `POST` | `/_api/endpoints/:slug/verify` | Fetch `{origin}/stent-verification.txt`, then check for a matching `X-Stent-Verify` header on `target_url` itself; mark the endpoint verified on either match. |
| `GET` | `/_api/endpoints` | Return the public directory of active, verified endpoints. |
| `GET` | `/_api/endpoints/:slug` | Return public status for one endpoint. |
| `PATCH` | `/_api/endpoints/:slug` | Toggle `active` when the request provides the recorded publisher wallet. |

Registration validation is server-side: slug format, reserved slugs, EVM payout
address, positive USDC price with up to six decimals, rate-limit bounds, and
HTTPS target URLs. `http://localhost` is accepted only when
`STENT_ALLOW_INSECURE_TARGETS=true` for local development.

### Data Model

Supabase stores four public domains:

- `endpoints` - slug, seller wallet, price, upstream URL, description, rate
  limits, verification token, verification state, active state.
- `payments` - payment audit rows keyed by unique Gateway authorization nonce.
- `agents` - optional public names/descriptions for agent wallets.
- `agent_runs` and `agent_run_steps` - agent lifecycle events shown on the
  dashboard's Runs screen (`/console`).

RLS is enabled. Public clients can read safe public data. The service role writes
endpoint, payment, agent, and run rows from trusted server code. Migration
`0004_endpoints_column_grants.sql` removes anon/authenticated read access to
`target_url` and `verification_token` so public endpoint listings do not expose
the origin URL or verification secret.

## SDK

The SDK lives in `packages/sdk` as workspace package `stent-sdk` and is
published to npm (see "Try It Now" above for the install and pay snippet).

`StentClient` delegates x402 discovery, signing, retry, and settlement handling
to `@circle-fin/x402-batching`. Stent adds a client-side cumulative spend cap,
typed spend-cap errors, and `getSpendSummary()` for agent loops.

The default SDK chain is `arcTestnet`. A custom `rpcUrl` is only passed when the
caller provides one.

## Development

### Prerequisites

- Node.js 22+
- npm
- A Supabase project or local Supabase stack for the database
- Arc testnet USDC for any wallet that will make paid calls
- A browser EVM wallet for dashboard wallet sign-in and publisher onboarding

### Install

```bash
npm install
```

### Environment

The proxy loads `.env` from the monorepo root.

```bash
# Required by apps/proxy
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# Optional proxy overrides
PORT=8080
GATEWAY_FACILITATOR_URL=https://gateway-api-testnet.circle.com
ARC_CAIP2=eip155:5042002
UPSTREAM_HEALTH_TIMEOUT_MS=4000
CACHE_REFRESH_MS=60000
IP_FLOOD_RPM=600
REGISTER_RPM=20
STENT_DASHBOARD_ORIGIN=*
STENT_ALLOW_INSECURE_TARGETS=false

# Used by SDK demos
BUYER_PRIVATE_KEY=
PROXY_URL=http://localhost:8080
```

The dashboard uses `apps/dashboard/.env.local` locally and host-level env vars in
deployment:

```bash
# Browser-exposed, required for dashboard public reads, Realtime, and Supabase Web3 auth
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# Browser-exposed, optional; defaults to the Railway proxy URL in apps/dashboard/lib/config.ts
NEXT_PUBLIC_PROXY_URL=https://stentproxy-production.up.railway.app

# Server-only, required by POST /api/agents
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

Do not put `SUPABASE_SERVICE_ROLE_KEY` or private keys in a `NEXT_PUBLIC_*`
variable.

### Database

Apply the migrations in `supabase/migrations` in order. With a linked Supabase
project, the usual CLI flow is:

```bash
npx supabase db push
```

`supabase/seed.sql` is for local demos only. It inserts the three demo endpoints
pointing at `http://localhost:8787`; do not run it in production.

### Run The Services

```bash
# Terminal 1: demo upstream API on ORIGIN_PORT or 8787
npm run dev:origin

# Terminal 2: proxy on PORT or 8080
npm run dev:proxy

# Terminal 3: dashboard on 3000
npm run dev --workspace @stent/dashboard
```

For local registration against `http://localhost:8787`, set
`STENT_ALLOW_INSECURE_TARGETS=true` on the proxy. Production registrations should
use public HTTPS targets.

### Build And Test

```bash
npm run build
npm test
npm run test:proxy
```

The proxy test suite covers registration validation, URL ownership verification,
SSRF blocking, upstream URL/header handling, rate limiting, replay behavior,
fail-closed payment logging, and upstream atomicity.

## Deployment

### Proxy On Railway

The root `railway.json` deploys `apps/proxy`:

```bash
npm install && npm run build --workspace @stent/proxy
npm run start --workspace @stent/proxy
```

Railway should use `/healthz` as the health check. Required runtime env vars are
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; the other proxy vars listed above
have defaults. Set `STENT_DASHBOARD_ORIGIN` to the deployed dashboard origin
instead of `*` for a public deployment.

Keep `STENT_ALLOW_INSECURE_TARGETS` unset or `false` in production.

### Dashboard

Deploy `apps/dashboard` as a Next.js app. The Vercel project is connected to
this repository with Root Directory set to `apps/dashboard`, so pushes to
`main` deploy to production automatically. The workspace commands below are
for local builds:

```bash
npm run build --workspace @stent/dashboard
npm run start --workspace @stent/dashboard
```

Set the dashboard env vars listed above before build. `NEXT_PUBLIC_*` values are
compiled into the client bundle by Next.js.

### Demo Origin

`apps/demo-origin/railway.json` deploys the optional demo upstream:

```bash
npm install && npm run build --workspace @stent/demo-origin
npm run start --workspace @stent/demo-origin
```

It exposes:

- `/arc-stats` - Arc testnet block and gas snapshot.
- `/usdc-volume` - USDC transfer count over roughly the last 50 blocks.
- `/crypto-news` - static demo headlines.
- `/stent-verification.txt` - ownership token from `STENT_VERIFICATION_TOKEN`.

## Security And Operational Notes

- Endpoint traffic is served only for active, verified endpoints.
- Verification fetches are SSRF-guarded. The proxy resolves the hostname before
  fetching and blocks loopback, private, link-local, metadata, CGNAT, ULA,
  multicast, reserved, and `localhost` targets.
- Payment nonces are stored in `payments.gateway_authorization_id` with a unique
  constraint. Reuse is treated as replay.
- The proxy strips hop-by-hop and x402 payment headers before forwarding to the
  publisher's origin.
- Upstream responses are fetched once during `onBeforeSettle` and then relayed
  from the captured bytes.
- If the payment row cannot be written, settlement is aborted.
- If settlement fails after a row is written, `onSettleFailure` deletes the row.
- Rate limiting is in-memory and fixed-window. The current implementation is
  correct for a single proxy instance; horizontal scaling should move the
  limiter to a shared store.
- No Solidity contracts are included in this repository.

## License

MIT

## Author

 [@CryptoZephyr](https://github.com/CryptoZephyr)
