# `architecture.md`

```markdown
# Stent — System Architecture

---

## Component Map

```
┌────────────────────────────────────────────────────────────────────┐
│                         AGENT RUNTIME                              │
│                                                                    │
│   LangChain agent (GPT-4o-mini, openai-functions)                 │
│        │                                                           │
│   StentClient                                                   │
│        │  wraps GatewayClient (@circle-fin/x402-batching)         │
│        │  signs EIP-3009 authorization LOCALLY — no tx broadcast  │
│        │  unique nonce per authorization                           │
│        │  enforces agent-side spend cap                            │
│        │  validates proxy is on TLS before sending keys           │
└────────┼───────────────────────────────────────────────────────────┘
         │ HTTPS only — TLS required
         │ GET /:slug (no payment header)
         │ GET /:slug + X-PAYMENT: <signed EIP-3009 auth>
         ▼
┌────────────────────────────────────────────────────────────────────┐
│                      STENT PROXY                                │
│                      Node.js + Express                             │
│                      Deployed: Railway                             │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  Route: /:slug/*                                            │  │
│  │                                                             │  │
│  │  1. Read endpoint config from Supabase cache (TTL: 60s)    │  │
│  │     Cache invalidated synchronously on config update        │  │
│  │     Stale configs never served                              │  │
│  │                                                             │  │
│  │  2. No X-PAYMENT header:                                    │  │
│  │     → Return HTTP 402 with x402 payment instruction         │  │
│  │     → Price locked from this 402 for authorization check   │  │
│  │                                                             │  │
│  │  3. X-PAYMENT header present → withGateway() middleware:   │  │
│  │     (a) Verify EIP-3009 signature cryptographically        │  │
│  │     (b) Verify nonce not used (Supabase unique constraint)  │  │
│  │     (c) Verify amount === price from 402 response           │  │
│  │     (d) Verify upstream is reachable (health check)         │  │
│  │     (e) ALL checks pass → queue for Gateway settlement      │  │
│  │     (f) ANY check fails → reject, do not forward            │  │
│  │                                                             │  │
│  │  4. Write payment to Supabase SYNCHRONOUSLY                 │  │
│  │     If write fails → fail payment, return error to agent    │  │
│  │     Payment is not complete until durably logged            │  │
│  │                                                             │  │
│  │  5. Forward request to config.target_url via HTTPS          │  │
│  │     Return upstream response to agent                       │  │
│  │                                                             │  │
│  │  6. Per-endpoint rate limiter                               │  │
│  │     Default: 100 req/min per endpoint                       │  │
│  │     Default: 10 req/min per agent wallet                    │  │
│  │     Configurable per endpoint in Supabase                   │  │
│  └─────────────────────────────────────────────────────────────┘  │
└────────┬───────────────────────────────────────────────────────────┘
         │                              │ batch settlement queue
         │ HTTPS proxy forward          ▼
         │                  ┌───────────────────────────────────┐
         │                  │       CIRCLE GATEWAY              │
         │                  │                                   │
         │                  │  Receives signed EIP-3009 auths   │
         │                  │  Verifies authorization nonces    │
         │                  │  Batches → single Arc onchain tx  │
         │                  │  Publisher Gateway wallet credited │
         │                  │  Crosschain withdrawal available  │
         │                  │                                   │
         │                  │  Gateway Wallet (Arc Testnet):    │
         │                  │  0x0077777d7EBA4688BDeF3E311b846  │
         │                  │        F25870A19B9                │
         │                  └──────────────┬────────────────────┘
         │                                 │ batch settles onchain
         │                                 ▼
         │                  ┌───────────────────────────────────┐
         │                  │         ARC TESTNET               │
         │                  │                                   │
         │                  │  Chain ID:  5042002               │
         │                  │  USDC:      0x360000...0000       │
         │                  │  Block:     ~480ms                │
         │                  │  Finality:  deterministic         │
         │                  │  Gas:       USDC (~$0.01/tx)      │
         │                  │  Explorer:  testnet.arcscan.app   │
         │                  └───────────────────────────────────┘
         ▼
┌────────────────────────────────────────────────────────────────────┐
│                  UPSTREAM PUBLISHER SERVER                         │
│                  (unmodified — has no idea Stent exists)        │
│                  Connection: HTTPS only, TLS enforced              │
│                                                                    │
│  /arc-stats      → queries Arc RPC, returns block data            │
│  /crypto-news    → static curated headlines (demo)                │
│  /usdc-volume    → queries Arc RPC getLogs, returns volume        │
└────────────────────────────────────────────────────────────────────┘
         │ synchronous write (payment not complete until logged)
         ▼
┌────────────────────────────────────────────────────────────────────┐
│                       SUPABASE                                     │
│                  Authoritative source of truth                     │
│                                                                    │
│  endpoints table                                                   │
│  → slug, publisher_wallet, price_usdc, target_url                 │
│  → rate_limit_rpm, agent_limit_rpm                                │
│  → verified (URL ownership proof), active                         │
│                                                                    │
│  payments table                                                    │
│  → tx audit trail (agent, amount, auth ID, endpoint, time)        │
│  → gateway_authorization_id UNIQUE → nonce dedup + replay guard   │
│                                                                    │
│  Daily reconciliation job (Supabase Edge Function)                │
│  → compares payment log totals vs Circle Gateway balances         │
│  → alerts team on discrepancy                                     │
│                                                                    │
│  Realtime CDC → Next.js dashboard (live payment feed)             │
│  Config updates → synchronous cache invalidation in proxy         │
└────────────────────────────────────────────────────────────────────┘
         │ Supabase Realtime
         ▼
┌────────────────────────────────────────────────────────────────────┐
│                   STENT DASHBOARD (Next.js)                     │
│                   Deployed: Vercel                                 │
│                                                                    │
│  Publisher onboarding:                                             │
│   → paste target URL + price + wallet address                     │
│   → URL ownership verification (stent-verification.txt check)  │
│   → get a live paywalled endpoint slug instantly                  │
│   → one-click Gateway wallet setup via Circle CLI                 │
│   → configure rate limits per endpoint                            │
│                                                                    │
│  Publisher earnings view:                                          │
│   → total USDC earned (real-time)                                 │
│   → requests per hour by endpoint                                 │
│   → unique agent wallets paying                                   │
│   → live payment feed (agent address, amount, timestamp)          │
│   → Gateway balance + withdraw button (crosschain)                │
│                                                                    │
│  Public endpoint directory:                                        │
│   → list of all active, verified Stent endpoints               │
│   → price, description, sample curl command                       │
│   → "copy SDK snippet" button for agent developers                │
└────────────────────────────────────────────────────────────────────┘
```

---

## StentClient SDK

```typescript
import { GatewayClient } from '@circle-fin/x402-batching';

export interface StentClientConfig {
  privateKey: string;
  spendCapUsdc?: number;
  network?: string;
}

export class StentClient {
  private gateway: GatewayClient;
  private spendCapUsdc: number;
  private totalSpent: number = 0;

  constructor(config: StentClientConfig) {
    this.gateway = new GatewayClient({
      privateKey: config.privateKey,
      network: config.network ?? 'arc-testnet',
    });
    this.spendCapUsdc = config.spendCapUsdc ?? Infinity;
  }

  async fetch(url: string, options?: RequestInit): Promise<unknown> {
    // GatewayClient handles full 402 → sign (unique nonce) → retry cycle
    // EIP-3009 signed locally — no tx broadcast, no RPC call
    const response = await this.gateway.fetch(url, options);

    if (response.paymentMade) {
      this.totalSpent += response.amountPaid;
      if (this.totalSpent > this.spendCapUsdc) {
        throw new Error(
          `Spend cap reached: $${this.totalSpent.toFixed(6)} > $${this.spendCapUsdc}`
        );
      }
    }

    return response.json();
  }

  getSpendSummary() {
    return {
      totalSpent: this.totalSpent,
      remainingCap: this.spendCapUsdc - this.totalSpent,
    };
  }
}
```

---

## Proxy Core

```typescript
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { withGateway } from '@circle-fin/x402-batching';
import { createClient } from '@supabase/supabase-js';
import rateLimit from 'express-rate-limit';

const app = express();
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Endpoint config cache — TTL 60s, invalidated synchronously on update
let endpointCache: Record<string, EndpointConfig> = {};

async function refreshEndpointCache() {
  const { data } = await supabase
    .from('endpoints')
    .select('*')
    .eq('active', true)
    .eq('verified', true);         // only serve verified endpoints
  if (data) {
    endpointCache = Object.fromEntries(data.map(e => [e.slug, e]));
  }
}

await refreshEndpointCache();
setInterval(refreshEndpointCache, 60_000);

// Supabase Realtime — synchronous cache invalidation on config update
supabase
  .channel('endpoint-config-changes')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'endpoints' },
    () => refreshEndpointCache()   // invalidate immediately on any config change
  )
  .subscribe();

app.use('/:slug/*', async (req, res) => {
  const config = endpointCache[req.params.slug];
  if (!config) return res.status(404).json({ error: 'endpoint_not_found' });

  // Per-endpoint rate limiter from Supabase config
  const limiter = rateLimit({
    windowMs: 60_000,
    max: config.rate_limit_rpm ?? 100,
    keyGenerator: (req) => req.ip ?? 'unknown',
  });

  // Upstream health check — payment is NOT committed if upstream is down
  try {
    const health = await fetch(config.target_url, { method: 'HEAD' });
    if (!health.ok) {
      return res.status(503).json({ error: 'upstream_unavailable' });
    }
  } catch {
    return res.status(503).json({ error: 'upstream_unreachable' });
  }

  // withGateway: verifies sig, nonce, amount — all offchain, <5ms
  const proxyHandler = createProxyMiddleware({
    target: config.target_url,
    changeOrigin: true,
    pathRewrite: { [`^/${req.params.slug}`]: '' },
    on: {
      proxyRes: async (proxyRes, req) => {
        const payment = (req as any).gatewayPayment;
        if (payment) {
          // SYNCHRONOUS write — payment not complete until logged
          const { error } = await supabase.from('payments').insert({
            endpoint_slug: req.params.slug,
            publisher_wallet: config.publisher_wallet,
            agent_address: payment.from,
            amount_usdc: payment.amount,
            gateway_authorization_id: payment.authorizationId,
          });
          if (error) {
            // Supabase write failed — fail the payment
            res.status(500).json({ error: 'payment_log_failed' });
            return;
          }
        }
      }
    }
  });

  const paywalled = withGateway(
    (req, res) => proxyHandler(req, res, () => {}),
    config.price_usdc,
    `/${req.params.slug}`,
    { network: 'arc-testnet', payTo: config.publisher_wallet }
  );

  return paywalled(req, res);
});

app.listen(8080, () => console.log('Stent proxy on :8080'));
```

---

## The Three Live Demo Endpoints

| Endpoint | Price | Source | Purpose |
|---|---|---|---|
| `/arc-stats` | $0.001/call | Arc testnet RPC | Block number, gas price, tx count |
| `/crypto-news` | $0.0005/call | Static curated headlines (demo) | Top 5 headlines |
| `/usdc-volume` | $0.0003/call | Arc RPC getLogs | USDC transfer count + volume last 100 blocks |

All three are Arc-native or Arc-adjacent. All three demonstrate price variation.
All three are real agent tools — not toy examples.
```

---
