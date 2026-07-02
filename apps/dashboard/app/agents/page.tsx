"use client";

import { useCallback, useEffect, useState } from "react";
import { auth, type Session } from "@/lib/auth";
import { NETWORK_LABEL } from "@/lib/config";
import { shortAddr } from "@/lib/wallet";
import {
  fetchMyAgents,
  fetchAgentHistory,
  claimAgent,
  type AgentProfile,
  type AgentHistory,
} from "@/lib/fleet";
import { ClaimForm } from "@/components/fleet/ClaimForm";
import { AgentPanel } from "@/components/fleet/AgentPanel";
import { ConnectWallet } from "@/components/fleet/ConnectWallet";
import { AgentPanelSkeleton } from "@/components/skeletons";

function msg(e: unknown): string {
  const raw = e instanceof Error ? e.message : "Something went wrong.";
  if (raw === "no_wallet")
    return "No browser wallet detected. Install one (e.g. MetaMask) and try again.";
  if (raw === "no_account") return "No wallet account available — unlock your wallet and retry.";
  return raw;
}

export default function AgentsPage() {
  const [session, setSession] = useState<Session | null | undefined>(undefined); // undefined = loading
  const [agent, setAgent] = useState<AgentProfile | null | undefined>(undefined); // undefined = loading
  const [history, setHistory] = useState<AgentHistory | null>(null);
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    auth.getSession().then(setSession).catch(() => setSession(null));
  }, []);

  const loadAgents = useCallback(async (wallet: string) => {
    setAgent(undefined);
    try {
      const a = (await fetchMyAgents(wallet))[0] ?? null;
      setAgent(a);
      if (a) {
        setHistory(null);
        fetchAgentHistory(a.agent_wallet).then(setHistory).catch(() => {});
      }
    } catch (e) {
      setErr(msg(e));
      setAgent(null);
    }
  }, []);

  useEffect(() => {
    if (session?.wallet) loadAgents(session.wallet);
  }, [session?.wallet, loadAgents]);

  async function signOut() {
    await auth.signOut();
    setSession(null);
    setAgent(undefined);
    setHistory(null);
    setEditing(false);
  }

  async function save(name: string, description: string) {
    const a = await claimAgent(name, description);
    setAgent(a);
    setEditing(false);
    fetchAgentHistory(a.agent_wallet).then(setHistory).catch(() => {});
  }

  if (session === undefined) {
    return <div className="fleet-loading" style={{ padding: "120px 24px" }}>Loading…</div>;
  }

  if (session === null) {
    return <ConnectWallet onConnected={setSession} />;
  }

  return (
    <>
      <header className="rig">
        <div className="rig-inner">
          <div className="brand-row">
            <div className="brand">
              <span className="brand-mark">STENT</span>
              <span className="badge-402">FLEET</span>
            </div>
            <div className="network">
              <span className="dot" />
              {NETWORK_LABEL}
            </div>
          </div>
          <div className="thesis">
            <p className="eyebrow">
              <b>Agent fleet</b> — your machines
            </p>
            <h1>Name your agent.</h1>
            <p>
              Your wallet is your agent. Claim it, give it a name and purpose, and watch its real
              spend across Stent APIs.
            </p>
          </div>
        </div>
      </header>

      <main className="stage">
        {err && <div className="notice err">{err}</div>}

        {
          <>
            <div className="fleet-bar">
              <span className="wallet-chip">
                <span className="avatar" />
                <span className="addr mono">{shortAddr(session.wallet)}</span>
              </span>
              <button className="btn btn-ghost" onClick={signOut}>
                Sign out
              </button>
            </div>

            {agent === undefined && <AgentPanelSkeleton />}

            {agent === null && !editing && (
              <div className="card">
                <p className="step-eyebrow">Claim</p>
                <h2 style={{ marginBottom: 8 }}>This wallet isn’t named yet</h2>
                <p className="lede">
                  Claiming turns this anonymous wallet into a named agent on the public machine
                  economy. It already works — this just gives it an identity.
                </p>
                <ClaimForm submitLabel="Claim agent" onSubmit={save} />
              </div>
            )}

            {agent && editing && (
              <div className="card">
                <p className="step-eyebrow">Edit agent</p>
                <h2 style={{ marginBottom: 8 }}>Update your agent</h2>
                <ClaimForm
                  initialName={agent.name}
                  initialDescription={agent.description ?? ""}
                  submitLabel="Save changes"
                  onSubmit={save}
                  onCancel={() => setEditing(false)}
                />
              </div>
            )}

            {agent && !editing && (
              <AgentPanel agent={agent} history={history} onEdit={() => setEditing(true)} />
            )}
          </>
        }
      </main>
    </>
  );
}
