"use client";

import { useEffect, useState } from "react";
import { PROXY_URL, NETWORK_LABEL } from "@/lib/config";
import { ConnectStep, RegisterStep, VerifyStep, LiveStep } from "@/components/steps";
import { StatusLookup } from "@/components/StatusLookup";
import { PublisherLookup } from "@/components/PublisherLookup";
import type { RegisterInput, RegisterOk, RegisterDraft } from "@/lib/api";
import { EMPTY_REGISTER_DRAFT } from "@/lib/api";
import { listPending, savePending, removePending, type PendingReg } from "@/lib/storage";

type Step = "connect" | "register" | "verify" | "live";

const STATIONS: { id: Step; name: string }[] = [
  { id: "connect", name: "Payout" },
  { id: "register", name: "Register" },
  { id: "verify", name: "Verify" },
  { id: "live", name: "Live" },
];

export default function Page() {
  const [step, setStep] = useState<Step>("connect");
  const [wallet, setWallet] = useState<string | null>(null);
  const [reg, setReg] = useState<RegisterOk | null>(null);
  const [input, setInput] = useState<RegisterInput | null>(null);
  const [draft, setDraft] = useState<RegisterDraft>(EMPTY_REGISTER_DRAFT);
  const [pending, setPending] = useState<PendingReg[]>([]);

  const patchDraft = (patch: Partial<RegisterDraft>) => setDraft((d) => ({ ...d, ...patch }));

  // Recover any endpoint that was registered but not yet verified.
  useEffect(() => setPending(listPending()), []);

  const idx = STATIONS.findIndex((s) => s.id === step);
  const origin = input ? safeOrigin(input.target_url) : "";
  const resumable = pending[pending.length - 1];

  function resetToRegister() {
    setReg(null);
    setInput(null);
    setDraft(EMPTY_REGISTER_DRAFT);
    setStep(wallet ? "register" : "connect");
  }

  function resume(p: PendingReg) {
    setWallet(p.publisher_wallet);
    setInput({
      slug: p.slug,
      target_url: p.target_url,
      price_usdc: p.price_usdc,
      publisher_wallet: p.publisher_wallet,
    });
    setReg({ slug: p.slug, verified: false, verification_token: p.verification_token, next_steps: {} });
    setStep("verify");
  }

  function discard(slug: string) {
    removePending(slug);
    setPending(listPending());
  }

  return (
    <>
      <header className="rig">
        <div className="rig-inner">
          <div className="brand-row">
            <div className="brand">
              <span className="brand-mark">STENT</span>
              <span className="badge-402">PUBLISH</span>
            </div>
            <div className="network">
              <span className="dot" />
              {NETWORK_LABEL}
            </div>
          </div>

          {step === "connect" && (
            <div className="thesis">
              <p className="eyebrow">
                <b>Payment required</b> — by design
              </p>
              <h1>Put a price on your API.</h1>
              <p>
                Agents pay per request in USDC. Paste a URL, set a price, prove it&apos;s yours —
                and never touch the payment code.
              </p>
            </div>
          )}

          <div className="rail" role="list" aria-label="Onboarding progress">
            {STATIONS.map((s, i) => (
              <div
                key={s.id}
                role="listitem"
                aria-current={i === idx ? "step" : undefined}
                className={`station ${i < idx ? "done" : i === idx ? "active" : "todo"}`}
              >
                <div className="station-track" />
                <div className="station-node" />
                <div className="station-meta">
                  <div className="station-no">{String(i + 1).padStart(2, "0")}</div>
                  <div className="station-name">{s.name}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </header>

      <main className="stage">
        {step === "connect" && resumable && (
          <div className="card">
            <p className="step-eyebrow">Resume</p>
            <h2 style={{ marginBottom: 8 }}>An endpoint is waiting to verify</h2>
            <p className="lede">
              You registered <span className="mono">{resumable.slug}</span> but haven&apos;t
              verified it yet. Pick up where you left off — your token is saved on this device.
            </p>
            <div className="btn-row">
              <button className="btn btn-primary" onClick={() => resume(resumable)}>
                Resume verification
              </button>
              <button className="btn btn-ghost" onClick={() => discard(resumable.slug)}>
                Discard
              </button>
            </div>
          </div>
        )}

        {step === "connect" && (
          <ConnectStep
            onConnect={(addr) => {
              setWallet(addr);
              setStep("register");
            }}
          />
        )}

        {step === "register" && wallet && (
          <RegisterStep
            wallet={wallet}
            draft={draft}
            onDraft={patchDraft}
            onChangeWallet={() => setStep("connect")}
            onRegistered={(r, i) => {
              setReg(r);
              setInput(i);
              savePending({
                slug: r.slug,
                verification_token: r.verification_token,
                target_url: i.target_url,
                price_usdc: i.price_usdc,
                publisher_wallet: i.publisher_wallet,
              });
              setPending(listPending());
              setStep("verify");
            }}
          />
        )}

        {step === "verify" && reg && input && (
          <VerifyStep
            reg={reg}
            origin={origin}
            targetUrl={input.target_url}
            onVerified={() => {
              removePending(reg.slug);
              setPending(listPending());
              setStep("live");
            }}
          />
        )}

        {step === "live" && reg && input && (
          <LiveStep
            slug={reg.slug}
            price={input.price_usdc}
            wallet={input.publisher_wallet}
            onReset={resetToRegister}
          />
        )}
      </main>

      {step !== "live" && (
        <section className="lookup">
          <div className="divider" />
          <StatusLookup />
          <div className="divider" />
          <PublisherLookup />
        </section>
      )}

      <footer className="foot">
        <div className="line">
          <span>Stent · USDC micropayments on {NETWORK_LABEL}</span>
          <span>{PROXY_URL.replace(/^https?:\/\//, "")}</span>
        </div>
      </footer>
    </>
  );
}

function safeOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}
