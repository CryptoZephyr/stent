# stent-sdk

Agent-side SDK that pays x402-paywalled APIs per request in USDC via Circle Gateway on Arc.

`StentClient` is a thin wrapper around Circle's `GatewayClient`
(`@circle-fin/x402-batching`) that adds a hard spend cap enforced *before* any
payment is signed, plus running spend accounting so an agent loop can reason
about its remaining budget. Everything else — 402 detection, EIP-3009
signing, retry with the payment header, batched settlement — is handled by
the underlying `GatewayClient`.

## Install

```bash
npm install stent-sdk
```

## Quickstart

```ts
import { StentClient } from "stent-sdk";

const client = new StentClient({
  privateKey: process.env.BUYER_PRIVATE_KEY as `0x${string}`, // agent wallet
  spendCapUsdc: 1.0, // optional hard cap across this client's lifetime
});

// Calls a Stent-proxied endpoint. If it returns a 402, StentClient signs an
// EIP-3009 authorization, retries with the payment header, and returns the
// parsed response body — payment happens automatically, no manual retry.
const data = await client.fetch("https://your-proxy.example.com/arc-stats");

console.log(data);
```

Use `client.pay()` instead of `client.fetch()` when you also want payment
metadata (amount paid, settlement reference, HTTP status) alongside the data:

```ts
const { data, amount, formattedAmount, transaction } = await client.pay(
  "https://your-proxy.example.com/arc-stats"
);
```

## Spend caps

Set `spendCapUsdc` in the constructor to bound total spend across the
client's lifetime. The cap is enforced *before* a payment authorization is
signed — nothing is sent if the payment would exceed it.

```ts
import { StentClient, SpendCapExceededError } from "stent-sdk";

const client = new StentClient({
  privateKey: process.env.BUYER_PRIVATE_KEY as `0x${string}`,
  spendCapUsdc: 0.01,
});

try {
  await client.fetch("https://your-proxy.example.com/arc-stats");
} catch (err) {
  if (err instanceof SpendCapExceededError) {
    console.log("Spend cap reached:", err.attemptedUsdc, err.totalSpentUsdc, err.spendCapUsdc);
  } else {
    throw err;
  }
}

// Snapshot of spend so far, e.g. for logging or budgeting the next call.
const summary = client.getSpendSummary();
// { totalSpentUsdc, remainingCapUsdc, spendCapUsdc, paymentCount }
```

If a payment fails and the Gateway balance is confirmed too low to cover it,
`StentClient` throws a typed `InsufficientGatewayBalanceError` (with
`requiredUsdc`/`availableUsdc`) instead of a generic error, so an agent loop
can tell "you're out of funds" apart from other failures.

## Other methods

- `client.address` — the agent wallet's payer address.
- `client.supports(url)` — check whether a URL advertises a Gateway-batched
  x402 option, without paying.
- `client.getBalances()` — wallet + Gateway USDC balances in one call.
- `client.deposit(amountUsdc: string)` — move USDC into the Gateway balance
  (one-time setup before paying; fund the wallet from
  [faucet.circle.com](https://faucet.circle.com) first on testnet).

## How it works

- Your first request to a Stent-proxied endpoint gets a `402` challenge
  describing the price and payment requirements.
- `StentClient` signs an EIP-3009 authorization for that exact amount with
  your agent wallet's private key — no gas, no on-chain call from your side.
- The signed authorization is sent to Circle Gateway, which settles it on
  **Arc testnet** and the proxy verifies it offchain against the facilitator.
- On success, the original request is retried with the payment header and
  you get the real response back — paid, verified, and logged, in one
  `fetch()` call.

## Configuration

`new StentClient(config)` accepts:

- `privateKey` (required) — agent wallet private key (`0x${string}`), funds
  the Gateway balance used for payments.
- `chain` (optional) — Gateway chain; defaults to `"arcTestnet"`.
- `rpcUrl` (optional) — custom RPC URL, only needed for Arc mainnet.
- `spendCapUsdc` (optional) — maximum cumulative USDC this client may spend
  over its lifetime; defaults to no cap.

## Part of Stent

`stent-sdk` is the agent-side half of [Stent](https://github.com/CryptoZephyr/stent),
a no-code reverse proxy that turns any existing API into an x402-paywalled
service monetized per request in USDC. Publishers register endpoints through
the Stent proxy/dashboard; agents use this SDK to pay and consume them.
