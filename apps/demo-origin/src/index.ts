/**
 * Stent demo origin — an ordinary, payment-unaware API.
 *
 * This represents a publisher's existing server. It has ZERO knowledge of x402,
 * Circle, or Stent. Stent's proxy sits in front of it and adds the paywall.
 * Run it, register its routes in the Stent dashboard, and they become paid.
 */
import "dotenv/config";
import express from "express";

// Railway injects PORT; fall back to ORIGIN_PORT for local dev.
const PORT = Number(process.env.PORT ?? process.env.ORIGIN_PORT ?? 8787);
const ARC_RPC_URL = process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
const USDC = (process.env.ARC_USDC_ADDRESS ??
  "0x3600000000000000000000000000000000000000") as `0x${string}`;
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

async function rpc<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(ARC_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.result as T;
}

const app = express();

// Request logger — lets us prove the proxy hits each upstream path exactly once
// per paid call (no separate health-probe round-trip).
app.use((req, _res, next) => {
  console.log(`[origin] ${req.method} ${req.path}`);
  next();
});

// Health check for Railway.
app.get("/healthz", (_req, res) => res.json({ ok: true }));

// GET /arc-stats — current Arc testnet block + gas snapshot.
app.get("/arc-stats", async (_req, res) => {
  try {
    const [blockHex, gasHex] = await Promise.all([
      rpc<string>("eth_blockNumber"),
      rpc<string>("eth_gasPrice"),
    ]);
    res.json({
      network: "arc-testnet",
      chainId: 5042002,
      blockNumber: Number.parseInt(blockHex, 16),
      gasPriceWei: BigInt(gasHex).toString(),
      gasPriceGwei: Number(BigInt(gasHex)) / 1e9,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(502).json({ error: "rpc_error", detail: String(err) });
  }
});

// GET /usdc-volume — USDC Transfer count over the last ~50 blocks.
app.get("/usdc-volume", async (_req, res) => {
  try {
    const tipHex = await rpc<string>("eth_blockNumber");
    const tip = Number.parseInt(tipHex, 16);
    const from = Math.max(0, tip - 50);
    const logs = await rpc<unknown[]>("eth_getLogs", [
      {
        address: USDC,
        topics: [TRANSFER_TOPIC],
        fromBlock: `0x${from.toString(16)}`,
        toBlock: `0x${tip.toString(16)}`,
      },
    ]);
    res.json({
      asset: "USDC",
      address: USDC,
      fromBlock: from,
      toBlock: tip,
      transferCount: logs.length,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(502).json({ error: "rpc_error", detail: String(err) });
  }
});

// GET /crypto-news — top headlines. Static curation (no API key needed for demo).
app.get("/crypto-news", (_req, res) => {
  res.json({
    source: "stent-demo",
    fetchedAt: new Date().toISOString(),
    headlines: [
      "Circle Gateway enables sub-cent agent payments on Arc",
      "x402 batched settlement cuts per-request gas to zero for buyers",
      "Stablecoin micropayments unlock pay-per-call API economies",
      "Autonomous agents begin transacting USDC without human approval",
      "Arc testnet sees rising USDC transfer volume from agent traffic",
    ],
  });
});

// URL-ownership proof. A real publisher would place this file at their domain
// root containing their Stent account token. Configure the generated token in
// Railway as STENT_VERIFICATION_TOKEN before verifying this demo origin.
app.get("/stent-verification.txt", (_req, res) => {
  const token = process.env.STENT_VERIFICATION_TOKEN?.trim();
  if (!token) {
    res.status(500).type("text/plain").send("STENT_VERIFICATION_TOKEN is not configured");
    return;
  }
  res.type("text/plain").send(token);
});

app.get("/", (_req, res) =>
  res.json({ service: "stent-demo-origin", endpoints: ["/arc-stats", "/usdc-volume", "/crypto-news"] })
);

app.listen(PORT, () => console.log(`Stent demo origin listening on :${PORT}`));
