"use client";

import { useEffect, useMemo, useState } from "react";
import { NETWORK_LABEL } from "@/lib/config";
import {
  ApiStep,
  EarningsStep,
  FirstPaidRequestStep,
  VerifyStep,
} from "@/components/steps";
import type { RegisterInput, RegisterOk, RegisterDraft } from "@/lib/api";
import { EMPTY_REGISTER_DRAFT } from "@/lib/api";
import { listPending, removePending, savePending, type PendingReg } from "@/lib/storage";

type Step = "api" | "earnings" | "verify" | "request";

const STATIONS: { id: Step; title: string; helper: string }[] = [
  { id: "api", title: "API details", helper: "URL, price, public name" },
  { id: "earnings", title: "Earnings", helper: "Where USDC lands" },
  { id: "verify", title: "Ownership", helper: "File or response header" },
  { id: "request", title: "First request", helper: "Paywall check and SDK call" },
];

export default function PublishPage() {
  const [step, setStep] = useState<Step>("api");
  const [wallet, setWallet] = useState<string | null>(null);
  const [reg, setReg] = useState<RegisterOk | null>(null);
  const [input, setInput] = useState<RegisterInput | null>(null);
  const [draft, setDraft] = useState<RegisterDraft>(EMPTY_REGISTER_DRAFT);
  const [pending, setPending] = useState<PendingReg[]>([]);
  const [hideResume, setHideResume] = useState(false);

  useEffect(() => setPending(listPending()), []);

  const idx = STATIONS.findIndex((s) => s.id === step);
  const resumable = !hideResume && step === "api" ? pending[pending.length - 1] : undefined;
  const origin = useMemo(() => (input ? safeOrigin(input.target_url) : ""), [input]);

  function patchDraft(patch: Partial<RegisterDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function resume(p: PendingReg) {
    setWallet(p.publisher_wallet);
    setInput({
      slug: p.slug,
      target_url: p.target_url,
      price_usdc: p.price_usdc,
      publisher_wallet: p.publisher_wallet,
    });
    setReg({
      slug: p.slug,
      verified: false,
      verification_token: p.verification_token,
      next_steps: {},
    });
    setStep("verify");
  }

  function discard(slug: string) {
    removePending(slug);
    setPending(listPending());
    setHideResume(true);
  }

  function resetToStart() {
    setReg(null);
    setInput(null);
    setWallet(null);
    setDraft(EMPTY_REGISTER_DRAFT);
    setHideResume(false);
    setPending(listPending());
    setStep("api");
  }

  return (
    <main className="publish-page">
      <header className="flow-hero">
        <div>
          <p className="page-kicker">Publish a paid API</p>
          <h1>Start with the endpoint. Finish with a paid request.</h1>
          <p>
            Stent turns one HTTPS endpoint into a paid URL. Your server stays unchanged; the
            product walks you through the exact first success path.
          </p>
        </div>
        <div className="flow-network">
          <span className="dot" />
          Payments settle on {NETWORK_LABEL}
        </div>
      </header>

      <section className="flow-layout" aria-label="Publish flow">
        <aside className="flow-sidebar">
          <ol className="flow-steps" aria-label="Progress">
            {STATIONS.map((station, index) => (
              <li
                key={station.id}
                className={index < idx ? "done" : index === idx ? "active" : ""}
                aria-current={index === idx ? "step" : undefined}
              >
                <span className="flow-step-index mono">{String(index + 1).padStart(2, "0")}</span>
                <span>
                  <strong>{station.title}</strong>
                  <small>{station.helper}</small>
                </span>
              </li>
            ))}
          </ol>
        </aside>

        <section className="flow-main">
          {resumable ? (
            <div className="flow-card">
              <p className="page-kicker">Resume setup</p>
              <h2>An endpoint is waiting for verification.</h2>
              <p className="lede">
                You already registered <span className="mono">{resumable.slug}</span>. Finish
                verification to get the paid URL and first request instructions.
              </p>
              <div className="action-row">
                <button className="btn btn-primary" onClick={() => resume(resumable)}>
                  Resume verification
                </button>
                <button className="btn btn-quiet" onClick={() => discard(resumable.slug)}>
                  Start a different API
                </button>
              </div>
            </div>
          ) : (
            <>
              {step === "api" && (
                <ApiStep
                  draft={draft}
                  onDraft={patchDraft}
                  onContinue={() => setStep("earnings")}
                />
              )}

              {step === "earnings" && (
                <EarningsStep
                  draft={draft}
                  wallet={wallet}
                  onWallet={setWallet}
                  onBack={() => setStep("api")}
                  onRegistered={(registered, registeredInput) => {
                    setReg(registered);
                    setInput(registeredInput);
                    savePending({
                      slug: registered.slug,
                      verification_token: registered.verification_token,
                      target_url: registeredInput.target_url,
                      price_usdc: registeredInput.price_usdc,
                      publisher_wallet: registeredInput.publisher_wallet,
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
                    setStep("request");
                  }}
                />
              )}

              {step === "request" && reg && input && (
                <FirstPaidRequestStep
                  slug={reg.slug}
                  price={input.price_usdc}
                  wallet={input.publisher_wallet}
                  onReset={resetToStart}
                />
              )}
            </>
          )}
        </section>
      </section>
    </main>
  );
}

function safeOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}
