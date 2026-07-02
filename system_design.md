# `system_design.md`

```markdown
# Stent — System Design

---

## Core Design Principles

### 1. Atomic Request-Payment-Response
Every request → `withGateway()` → upstream → response flow MUST succeed or
fail atomically. Partial completions are not allowed. If upstream is unavailable,
`withGateway()` MUST fail the payment authorization. Payment MUST NOT succeed
if the request cannot be serviced. This prevents the worst failure mode: an
agent pays but receives nothing.

### 2. Offchain Payment Verification
Payment verification is offchain via EIP-3009 signature (Circle Gateway).
Arc is used only for final USDC batch settlement. This means:
- No blockchain RPC call per request
- No polling loop
- No sleep()
- Total payment verification time: <5ms

### 3. Supabase as Authoritative State
Supabase is the single source of truth for endpoint configurations and processed
payments. Payment logging to Supabase MUST be synchronous — payments are not
considered complete until durably logged. If a Supabase write fails, the
associated payment MUST fail. Partial state changes are not allowed.

### 4. Proxy-Side Trust — SDK Is Not Trusted
The Agent SDK is NOT a trust boundary. All SDK input MUST be validated by the
Stent proxy. The proxy MUST defend against malicious SDK instances. Every
EIP-3009 authorization signature is fully verified by the proxy regardless of
what the SDK claims.

### 5. No Stale Configs Served
Endpoint config caches have a maximum TTL of 60 seconds. Caches are
proactively invalidated on all config updates. Stale configs MUST NOT be served.

---

## Payment Verification Flow

```
1. Agent sends GET /:slug
   No X-PAYMENT header present.

2. Proxy reads endpoint config from Supabase cache (TTL: 60s).
   Returns HTTP 402:
   {
     "x402Version": 1,
     "accepts": [{
       "scheme": "exact",
       "network": "arc-testnet",
       "maxAmountRequired": "1000",      // USDC atomic units (6 dec)
       "resource": "/:slug",
       "description": "endpoint description",
       "mimeType": "application/json",
       "payTo": "0xPUBLISHER_WALLET",
       "maxTimeoutSeconds": 60,
       "asset": "0x3600000000000000000000000000000000000000",
       "extra": { "name": "USD Coin", "version": "2" }
     }]
   }
   NOTE: The price in this 402 response is the ONLY valid price.
   Any authorization with a different amount MUST be rejected.

3. StentClient receives 402.
   GatewayClient signs EIP-3009 transferWithAuthorization LOCALLY.
   Unique nonce generated per authorization. No tx broadcast. No RPC call.
   Signing takes <10ms.

4. Agent retries with X-PAYMENT header containing signed authorization.

5. withGateway() middleware:
   (a) Verifies EIP-3009 signature cryptographically (offchain, <5ms)
   (b) Verifies nonce has NOT been used before — rejects duplicate nonces
   (c) Verifies authorization amount matches the 402 response price exactly
   (d) Queues authorization for Gateway batch settlement
   (e) Only proceeds if ALL checks pass

6. Proxy verifies upstream is reachable BEFORE committing payment.
   If upstream is unavailable → payment authorization is REJECTED.
   Payment and fulfillment are atomic.

7. Proxy forwards request to config.target_url.
   Upstream response returned to agent.

8. Payment is logged to Supabase SYNCHRONOUSLY.
   If Supabase write fails → payment is failed and agent receives an error.
   Payment is not considered complete until durably written.

9. Circle Gateway settles batch onchain on Arc periodically.
   Publisher Gateway wallet credited.
   Settlement visible on testnet.arcscan.app.

10. Dashboard updates via Supabase Realtime CDC.
```

---

## Security Constraints

### EIP-3009 Signature Verification
The proxy MUST fully verify EIP-3009 authorization signatures. Partial or
skipped verification is not allowed. Checks performed on every authorization:
- Signature validity (cryptographic)
- Nonce uniqueness (never reused)
- Amount matches 402 response price exactly
- Authorization has not expired (maxTimeoutSeconds)

### Nonce Enforcement
All EIP-3009 payment authorizations MUST include a unique nonce. Reused
nonces MUST be rejected by `withGateway()`. Nonce tracking is maintained
in Supabase via the `gateway_authorization_id` unique constraint.

### Price Consistency
The price used for authorization MUST match the price served in the 402
response. Prices MUST NOT change between 402 and authorization. The proxy
reads price from the 402 it issued — never from the authorization itself.

### TLS Enforcement
All agent → proxy and proxy → upstream connections MUST use TLS with valid
certificates. Unencrypted connections are not allowed.

### URL Ownership Verification
Endpoint registration MUST require proof of URL ownership to prevent spoofing
or squatting. Proof mechanism: publisher places a `stent-verification.txt`
file at the root of their domain containing their Stent account token.
Proxy verifies file presence before activating the endpoint.

### Rate Limiting
The proxy enforces a per-endpoint rate limit to prevent economic DOS attacks.
Rate limit parameters are configurable per endpoint in Supabase. Default:
100 requests/minute per endpoint, 10 requests/minute per agent wallet.

---

## Known Failure Modes and Mitigations

### 1. Signature Replay Attacks
- **Impact:** Attacker replays a captured EIP-3009 authorization to drain
  publisher funds without paying.
- **Mitigation:** Strict nonce uniqueness enforced in `withGateway()`. Every
  authorization nonce stored in Supabase `gateway_authorization_id` (unique
  constraint). Duplicate nonces rejected at proxy before any upstream call.

### 2. Pricing Inconsistency Between 402 and Authorization
- **Impact:** Agents underpay if prices drop between 402 and authorization.
- **Mitigation:** Proxy uses only the price from its own issued 402 response
  for authorization validation. Any amount mismatch causes immediate rejection.

### 3. Upstream Unavailability
- **Impact:** Payment succeeds but no data is delivered to the agent.
- **Mitigation:** Proxy checks upstream reachability before committing payment
  authorization. `withGateway()` fails the authorization if upstream is
  unreachable. Payment and fulfillment are atomic — both succeed or both fail.

### 4. Supabase Write Failure
- **Impact:** Payments processed without being logged. Loss of payment record.
  Nonce not stored, enabling replay.
- **Mitigation:** All Supabase writes are synchronous. Payment is failed if
  Supabase write fails. Partial state changes are not allowed.

### 5. Economic DOS via Rapid Endpoint Cycling
- **Impact:** Attacker degrades system performance and crowds out legitimate
  publishers by creating thousands of endpoints or firing rapid requests.
- **Mitigation:** Per-publisher endpoint creation rate limits enforced at the
  dashboard API layer. Per-endpoint and per-agent request rate limits enforced
  at the proxy. Parameters are configurable per endpoint in Supabase.

### 6. Stale Endpoint Config Cache
- **Impact:** Proxy serves outdated price or target URL. Agent pays wrong
  amount or request forwards to wrong upstream.
- **Mitigation:** Cache TTL hard-capped at 60 seconds. Cache invalidated
  synchronously on any config update via Supabase Realtime subscription.

---

## State Consistency and Reconciliation

- Supabase is the authoritative source of truth for endpoint configurations
  and processed payments.
- Payment logging is synchronous — payments are not considered complete until
  durably logged to Supabase.
- Daily reconciliation is performed between Supabase payment logs and Circle
  Gateway balances. Discrepancies trigger an alert to the team via a scheduled
  Supabase Edge Function.
- Endpoint config caches have a maximum TTL of 60 seconds and are proactively
  invalidated on all config updates.

---

## Database Schema

```sql
-- Publisher endpoint registry
create table public.endpoints (
  id               uuid default gen_random_uuid() primary key,
  created_at       timestamptz default now() not null,
  slug             text unique not null,
  publisher_wallet text not null,
  price_usdc       text not null,           -- 6-decimal string e.g. "0.001"
  target_url       text not null,           -- upstream server to proxy
  description      text,
  rate_limit_rpm   integer default 100,     -- requests/min per endpoint
  agent_limit_rpm  integer default 10,      -- requests/min per agent wallet
  verified         boolean default false,   -- URL ownership verified
  active           boolean default true
);

-- Payment log — authoritative audit trail
create table public.payments (
  id                       uuid default gen_random_uuid() primary key,
  created_at               timestamptz default now() not null,
  endpoint_slug            text not null references endpoints(slug),
  publisher_wallet         text not null,
  agent_address            text not null,
  amount_usdc              numeric not null,
  gateway_authorization_id text unique not null   -- nonce dedup + replay protection
);

-- RLS
alter table public.endpoints enable row level security;
alter table public.payments enable row level security;

create policy "public_read_endpoints"
  on public.endpoints for select using (active = true and verified = true);

create policy "public_read_payments"
  on public.payments for select using (true);

create policy "service_write_payments"
  on public.payments for insert
  using (auth.role() = 'service_role');

-- Indexes
create index on public.payments (publisher_wallet, created_at desc);
create index on public.payments (endpoint_slug, created_at desc);
create index on public.payments (agent_address, created_at desc);
create index on public.payments (gateway_authorization_id);  -- fast nonce lookup
```

---

## Environment Variables

```bash
# Circle
CIRCLE_API_KEY=...
CIRCLE_ENTITY_SECRET=...
GATEWAY_FACILITATOR_URL=https://gateway.circle.com

# Wallets
SELLER_PRIVATE_KEY=0x...
BUYER_PRIVATE_KEY=0x...

# Arc Testnet
ARC_RPC_URL=https://rpc.testnet.arc.network
ARC_CHAIN_ID=5042002
ARC_USDC_ADDRESS=0x3600000000000000000000000000000000000000
GATEWAY_WALLET=0x0077777d7EBA4688BDeF3E311b846F25870A19B9

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...

# LLM
OPENAI_API_KEY=sk-...

# Deployment
NEXT_PUBLIC_PROXY_URL=https://api.stent.xyz
```
```

---