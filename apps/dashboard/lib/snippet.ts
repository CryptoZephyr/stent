import { PROXY_URL } from "./config";

export function endpointUrl(slug: string): string {
  return `${PROXY_URL}/${slug}`;
}

export function sdkSnippet(slug: string): string {
  return `import { StentClient } from "@stent/sdk";

const client = new StentClient({
  privateKey: process.env.AGENT_PRIVATE_KEY,  // a funded Gateway wallet
  spendCapUsdc: 1.00,                          // safety cap
});

// Detects the 402, pays in USDC, retries, returns your data — automatically.
const data = await client.fetch("${endpointUrl(slug)}");
console.log(data);`;
}

export function curlSnippet(slug: string): string {
  return `curl -i ${endpointUrl(slug)}\n# → HTTP/1.1 402 Payment Required`;
}
