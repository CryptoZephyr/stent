# `readme.md`

```markdown
# Stent

> Any API. Any price. Paid by agents, per request, in under a second.

Stent is a no-code reverse proxy that turns any existing API into an
x402-paywalled service — monetized per request in USDC via Circle Gateway
Nanopayments on Arc — without the publisher modifying a single line of code.

Built for the **Lepton Agents Hackathon** (Canteen × Circle × Arc, June 2026).

---

## How It Works

**For publishers:**
1. Paste your API endpoint URL into the Stent dashboard
2. Set a USDC price per request
3. Paste your wallet address
4. Complete URL ownership verification
5. Your endpoint is live and paywalled in 30 seconds

**For agents:**
```typescript
import { StentClient } from 'stent-sdk';

const client = new StentClient({
  privateKey: process.env.AGENT_PRIVATE_KEY!,
  spendCapUsdc: 1.00,  // $1 max spend
});

// Agent autonomously detects 402, pays, retries, returns data
const data = await client.fetch('https://api.stent.xyz/arc-stats');
```

**What happens under the hood:**
1. Agent hits endpoint → proxy returns HTTP 402 with payment instructions
2. `StentClient` signs an EIP-3009 authorization locally in <10ms
3. Agent retries with signed authorization in `X-PAYMENT` header
4. Proxy verifies signature, nonce uniqueness, and amount — offchain, <5ms
5. Proxy checks upstream is reachable before committing payment
6. Request forwarded to publisher's server
7. Payment logged to Supabase synchronously
8. Circle Gateway batches and settles onchain on Arc

Total round-trip: ~50ms. No polling. No blockchain call per request.

---

## Live Endpoints (Arc Testnet)

| Endpoint | Price | Description |
|---|---|---|
| `https://api.stent.xyz/arc-stats` | $0.001/call | Arc testnet block stats |
| `https://api.stent.xyz/crypto-news` | $0.0005/call | Top 5 crypto headlines |
| `https://api.stent.xyz/usdc-volume` | $0.0003/call | USDC transfer volume on Arc |

Hit these immediately with test USDC — no Stent account required to access them.

---

## Quick Integration (5 Minutes)

### 1. Install the SDK
```bash
npm install stent-sdk
```

### 2. Get testnet USDC
Go to [faucet.circle.com](https://faucet.circle.com) → select Arc Testnet →
paste your agent wallet address → request USDC.

### 3. Drop into your LangChain agent
```typescript
import { Tool } from 'langchain/tools';
import { StentClient } from 'stent-sdk';

const client = new StentClient({
  privateKey: process.env.AGENT_PRIVATE_KEY!,
  spendCapUsdc: 1.00,
});

export const arcStatsTool = new Tool({
  name: 'arc_block_stats',
  description: 'Get current Arc testnet block stats. Costs $0.001 USDC per call.',
  func: async () => {
    const data = await client.fetch('https://api.stent.xyz/arc-stats');
    return JSON.stringify(data);
  },
});
```

### 4. Run your agent
Your agent will autonomously discover the paywall, pay for access, and receive
data — all without any manual intervention.

---

## Register Your Own Endpoint

1. Go to [stent.xyz](https://stent.xyz)
2. Click "Register Endpoint"
3. Fill in: target URL, price (USDC), wallet address, description
4. Complete URL ownership verification:
   - Place `stent-verification.txt` at your domain root
   - File must contain your Stent account token
5. Your endpoint appears in the public directory immediately

---

## Security Model

Stent enforces strict payment integrity at the proxy level:

- **Replay protection:** Every EIP-3009 authorization uses a unique nonce.
  Reused nonces are rejected. Nonces stored in Supabase with a unique constraint.
- **Price integrity:** Authorization amount must match the 402 response price
  exactly. Any mismatch causes immediate rejection.
- **Atomic payment-delivery:** Upstream availability is checked before payment
  is committed. If upstream is down, payment is rejected. You cannot pay for
  something that won't be delivered.
- **Durable logging:** Payment is not considered complete until synchronously
  written to Supabase. If the write fails, the payment fails.
- **TLS enforcement:** All connections (agent → proxy, proxy → upstream) require
  valid TLS certificates. No unencrypted connections.
- **URL ownership verification:** Publishers must prove they own the domain
  before an endpoint goes live. Prevents squatting and spoofing.
- **Rate limiting:** Per-endpoint and per-agent rate limits prevent economic
  DOS attacks. Configurable per endpoint.
- **Daily reconciliation:** Supabase payment logs are reconciled against Circle
  Gateway balances daily. Discrepancies trigger team alerts.

---

## Monorepo Structure

```
stent/
├── apps/
│   ├── proxy/              Node.js + Express reverse proxy
│   ├── dashboard/          Next.js 14 publisher dashboard
│   └── demo-agent/         LangChain demo agent (3 tools)
├── packages/
│   └── sdk/                StentClient (npm: stent-sdk)
└── supabase/
    └── migrations/         Database schema
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Payment middleware | `@circle-fin/x402-batching` (`withGateway`, `GatewayClient`) |
| Settlement | Circle Gateway → Arc Testnet (Chain ID: 5042002) |
| Settlement asset | USDC (`0x3600000000000000000000000000000000000000`) |
| Proxy runtime | Node.js + Express + http-proxy-middleware |
| Dashboard | Next.js 14 + Supabase Realtime |
| State / audit log | Supabase (PostgreSQL + RLS) |
| Agent framework | LangChain (openai-functions mode) |
| Proxy deployment | Railway |
| Dashboard deployment | Vercel |

**Zero Solidity. No custom contracts. No ERC-8004 in MVP.**

---

## Environment Setup

Create `.env` (see `DEPLOYMENT.md` §5 for the full var list) and fill in:

```bash
# Circle (required)
CIRCLE_API_KEY=...
CIRCLE_ENTITY_SECRET=...
GATEWAY_FACILITATOR_URL=https://gateway.circle.com

# Wallets (generated via npm run generate-wallets)
SELLER_PRIVATE_KEY=0x...
BUYER_PRIVATE_KEY=0x...

# Arc Testnet (constants)
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

**Never commit `.env`. Never commit your entity secret or recovery file.**

---

## Local Development

```bash
# Clone
git clone https://github.com/CryptoZephyr/stent
cd stent

# Install dependencies
npm install

# Generate wallets + get testnet USDC
npm run generate-wallets
# → go to faucet.circle.com and fund the buyer wallet

# Run Supabase migrations
npx supabase db push

# Start proxy (terminal 1)
cd apps/proxy && npm run dev

# Start dashboard (terminal 2)
cd apps/dashboard && npm run dev

# Run demo agent (terminal 3)
cd apps/demo-agent && npm run start
```

---

## Built By

**Tommy** (GitHub: [@CryptoZephyr](https://github.com/CryptoZephyr))
Solo builder. Arc Network. Lepton Agents Hackathon 2026.

---

## License

MIT
```

