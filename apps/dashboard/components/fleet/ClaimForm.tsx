"use client";

import { useState } from "react";

export function ClaimForm({
  initialName = "",
  initialDescription = "",
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initialName?: string;
  initialDescription?: string;
  submitLabel: string;
  onSubmit: (name: string, description: string) => Promise<void>;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    const n = name.trim();
    if (n.length < 1 || n.length > 60) {
      setErr("Name must be 1–60 characters.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await onSubmit(n, description.trim());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field-group">
      <div className="field">
        <label className="label" htmlFor="agent-name">
          Agent name <span className="req">*</span>
        </label>
        <input
          id="agent-name"
          className="input"
          placeholder="Research Agent"
          value={name}
          maxLength={60}
          onChange={(e) => {
            setName(e.target.value);
            setErr(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
      </div>
      <div className="field">
        <label className="label" htmlFor="agent-description">Description</label>
        <textarea
          id="agent-description"
          className="textarea"
          placeholder="What does this agent do?"
          value={description}
          maxLength={280}
          onChange={(e) => setDescription(e.target.value)}
        />
        <p className="hint">Optional — shown on the public leaderboard.</p>
      </div>
      {err && <div className="notice err">{err}</div>}
      <div className="btn-row">
        <button className="btn btn-primary" onClick={submit} disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </button>
        {onCancel && (
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
