// Minimal injected-wallet (EIP-1193) connect — just enough to read the publisher's
// payout address. No signing happens for registration; the wallet only receives.

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

function injected(): Eip1193 | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { ethereum?: Eip1193 }).ethereum;
}

export function hasInjectedWallet(): boolean {
  return !!injected();
}

export async function connectInjected(): Promise<string> {
  const eth = injected();
  if (!eth) throw new Error("no_wallet");
  const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
  const addr = accounts?.[0];
  if (!addr) throw new Error("no_account");
  return addr;
}

export function isAddress(a: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(a.trim());
}

export function shortAddr(a: string): string {
  return a.length >= 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}
