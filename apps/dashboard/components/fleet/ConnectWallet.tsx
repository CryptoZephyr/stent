"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { auth, type Session } from "@/lib/auth";

type View = "select" | "connecting" | "error" | "nowallet";

interface WalletOpt {
  key: string;
  name: string;
  initial: string;
  color: string;
  bg: string;
  bd: string;
  supported: boolean;
  tag: string;
}

const WALLETS: WalletOpt[] = [
  { key: "injected", name: "Browser wallet", initial: "E", color: "#2EE6D6", bg: "rgba(46,230,214,.16)", bd: "rgba(46,230,214,.34)", supported: true, tag: "Injected EVM" },
  { key: "walletconnect", name: "WalletConnect", initial: "W", color: "#3B99FC", bg: "rgba(59,153,252,.16)", bd: "rgba(59,153,252,.34)", supported: false, tag: "Not supported yet" },
];

/**
 * Wallet sign-in. Visual matches the "Connect Wallet" reference; behavior drives
 * the REAL Supabase Web3 / SIWE flow via the auth abstraction. Our `signIn()`
 * does connect + sign + verify atomically (the wallet shows its own prompt), so
 * the reference's connecting/sign/verifying screens collapse into "connecting".
 */
export function ConnectWallet({ onConnected }: { onConnected: (s: Session) => void }) {
  const [view, setView] = useState<View>("select");
  const [active, setActive] = useState<WalletOpt>(WALLETS[0]);
  const [hasInjected, setHasInjected] = useState(true);

  useEffect(() => {
    setHasInjected(typeof window !== "undefined" && !!(window as unknown as { ethereum?: unknown }).ethereum);
  }, []);

  async function connect(w: WalletOpt) {
    setActive(w);
    if (!w.supported) {
      setView("error");
      return;
    }
    if (!(window as unknown as { ethereum?: unknown }).ethereum) {
      setView("nowallet");
      return;
    }
    setView("connecting");
    try {
      const s = await auth.signIn();
      onConnected(s);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      setView(msg === "no_wallet" ? "nowallet" : "error");
    }
  }

  return (
    <div className="cw">
      {/* LEFT: gateway visual */}
      <div className="cw-left">
        <div className="land-bg" aria-hidden>
          <span className="land-glow a" />
          <span className="land-glow b" />
          <span className="land-grid" />
        </div>

        <div className="cw-gate" aria-hidden>
          <span className="cw-gate-ring" />
          <span className="cw-gate-ring two" />
          <span className="cw-gate-core">
            <span className="cw-gate-dot" />
          </span>
          <span className="land-chip cw-chip a">
            <span className="d accent" />
            wallet authenticated
          </span>
          <span className="land-chip cw-chip b">
            <span className="g pay">◈</span>USDC settlement
          </span>
          <span className="land-chip cw-chip c">
            <span className="g accent">⬡</span>non-custodial
          </span>
        </div>

        <div className="cw-left-copy">
          <h1>The gateway to the machine economy</h1>
          <p>
            Your wallet is your identity. Connect once to authorize autonomous agents, settle in
            USDC, and own every transaction they make.
          </p>
        </div>
      </div>

      {/* RIGHT: auth card */}
      <div className="cw-right">
        <div className="cw-card">
          {view === "select" && (
            <div className="cw-view">
              <span className="land-pill">
                <span className="dot" />
                Sign in with Ethereum
              </span>
              <h2>Connect your wallet</h2>
              <div className="cw-wallets">
                {WALLETS.map((w) => {
                  const detected = w.supported && hasInjected;
                  return (
                    <button
                      key={w.key}
                      className="cw-wallet"
                      onClick={() => connect(w)}
                      aria-disabled={!w.supported}
                    >
                      <span
                        className="cw-wallet-mark mono"
                        style={{ background: w.bg, borderColor: w.bd, color: w.color }}
                      >
                        {w.initial}
                      </span>
                      <span className="cw-wallet-name">{w.name}</span>
                      <span className={`cw-wallet-tag mono${detected ? " ok" : ""}`}>
                        {detected ? "Detected" : w.tag}
                      </span>
                      <span className="cw-wallet-chev">›</span>
                    </button>
                  );
                })}
              </div>
              <p className="cw-foothint">
                Signing proves you control the wallet — it&apos;s free and never a transaction.
              </p>
              <p className="cw-foothint">
                Just looking? <Link href="/console">Watch a live agent run</Link> or{" "}
                <Link href="/marketplace">browse the marketplace</Link> — no wallet needed.
              </p>
            </div>
          )}

          {view === "connecting" && (
            <div className="cw-view center">
              <div className="cw-spinner-wrap">
                <span className="cw-spinner-track" />
                <span className="cw-spinner" />
                <span className="cw-spinner-init mono" style={{ color: active.color }}>
                  {active.initial}
                </span>
              </div>
              <h2>Connecting to {active.name}</h2>
              <p>Approve the connection and sign the message in your wallet to continue.</p>
              <button className="btn btn-ghost" onClick={() => setView("select")}>
                Cancel
              </button>
            </div>
          )}

          {view === "error" && (
            <div className="cw-view center">
              <div className="cw-icon danger" aria-hidden>
                ⚠
              </div>
              <h2>{active.supported ? "Sign-in cancelled" : "Connection method unavailable"}</h2>
              <p>
                {active.supported
                  ? `You declined the request in ${active.name}. Nothing was shared and no funds moved.`
                  : "Stent currently supports injected EVM browser wallets through Supabase Web3 / SIWE. WalletConnect is not wired yet."}
              </p>
              <button className="btn btn-primary btn-block" onClick={() => setView("select")}>
                Try again
              </button>
            </div>
          )}

          {view === "nowallet" && (
            <div className="cw-view center">
              <div className="cw-icon warn" aria-hidden>
                ⬡
              </div>
              <h2>No wallet detected</h2>
              <p>
                We couldn&apos;t find a browser wallet. Install one (e.g. MetaMask) to continue, then
                reconnect.
              </p>
              <a
                className="btn btn-primary btn-block"
                href="https://metamask.io/download/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Install MetaMask ↗
              </a>
              <button className="btn btn-ghost btn-block" onClick={() => setView("select")}>
                Choose another wallet
              </button>
              <Link href="/console" className="btn btn-ghost btn-block">
                Explore without a wallet →
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
