import { PROXY_URL } from "./config";

export function endpointUrl(slug: string): string {
  return `${PROXY_URL}/${slug}`;
}

export function sdkSnippet(slug: string): string {
  return `// npm install stent-sdk
import { StentClient } from "stent-sdk";

const client = new StentClient({
  privateKey: process.env.BUYER_PRIVATE_KEY,
  spendCapUsdc: 1.00,
});

// One-time setup: get testnet USDC from faucet.circle.com, then fund Gateway.
// await client.deposit("10");

// Pays, retries, and returns your API response.
const data = await client.fetch("${endpointUrl(slug)}");
console.log(data);`;
}

export function curlSnippet(slug: string): string {
  return `curl -i ${endpointUrl(slug)}\n# HTTP/1.1 402 Payment Required`;
}
