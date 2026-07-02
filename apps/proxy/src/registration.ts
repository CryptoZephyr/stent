/**
 * Minimal publisher registration API — lets a real publisher onboard an endpoint
 * with NO SQL access. Mounted under the reserved `/_api` prefix (valid payment
 * slugs cannot start with `_`, so there is no collision with the `/:slug`
 * payment routes).
 *
 * Flow:
 *   POST /_api/endpoints                 → create an UNVERIFIED endpoint, get a token
 *   POST /_api/endpoints/:slug/verify    → prove ownership (fetch token file), go live
 *   GET  /_api/endpoints                 → public directory (active + verified)
 *   GET  /_api/endpoints/:slug           → status (poll verification; no token leak)
 *
 * Security at this layer (the registration boundary):
 *  - TLS-only target URLs (Security Rule #5) enforced here, not just in the DB.
 *  - An endpoint is created `verified = false`; the proxy never serves it until
 *    ownership is proven, so open registration cannot squat or serve traffic.
 *  - Per-IP registration rate limit; hard input validation.
 */
import express, { Router } from "express";
import { isAddress, verifyMessage } from "viem";
import { randomBytes } from "node:crypto";
import { supabase } from "./supabaseClient";
import { verifyOwnership } from "./verification";
import { rateLimiter } from "./rateLimiter";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
const RESERVED_SLUGS = new Set(["healthz", "_api", "stent-verification"]);
const ALLOW_INSECURE = process.env.STENT_ALLOW_INSECURE_TARGETS === "true";
const REGISTER_RPM = Number(process.env.REGISTER_RPM ?? 20);
const CORS_ORIGIN = process.env.STENT_DASHBOARD_ORIGIN ?? "*";
const PATCH_SIGNATURE_TTL_MS = 5 * 60 * 1000;

export interface RegistrationInput {
  slug?: unknown;
  target_url?: unknown;
  price_usdc?: unknown;
  publisher_wallet?: unknown;
  description?: unknown;
  rate_limit_rpm?: unknown;
  agent_limit_rpm?: unknown;
}

export interface ValidatedRegistration {
  slug: string;
  target_url: string;
  price_usdc: string;
  publisher_wallet: string;
  description: string | null;
  rate_limit_rpm: number;
  agent_limit_rpm: number;
}

export interface PatchOwnershipInput {
  publisher_wallet?: unknown;
  active?: unknown;
  issued_at?: unknown;
  signature?: unknown;
}

function clampInt(v: unknown, def: number, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

/** Pure validation — unit-testable, no I/O. */
export function validateRegistration(
  body: RegistrationInput,
  opts: { allowInsecure?: boolean } = {}
): { ok: true; value: ValidatedRegistration } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  const slug = String(body.slug ?? "").trim().toLowerCase();
  if (!SLUG_RE.test(slug)) errors.push("slug must match ^[a-z0-9][a-z0-9-]{1,39}$");
  else if (RESERVED_SLUGS.has(slug)) errors.push(`slug "${slug}" is reserved`);

  const target = String(body.target_url ?? "").trim();
  let parsed: URL | null = null;
  try {
    parsed = new URL(target);
  } catch {
    errors.push("target_url is not a valid URL");
  }
  if (parsed) {
    const isLoopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    if (parsed.protocol !== "https:" && !(opts.allowInsecure && isLoopback)) {
      errors.push("target_url must use https://");
    }
  }

  const price = String(body.price_usdc ?? "").trim();
  if (!/^\d+(\.\d{1,6})?$/.test(price) || Number(price) <= 0) {
    errors.push("price_usdc must be a positive decimal with at most 6 places");
  } else if (Number(price) > 1000) {
    errors.push("price_usdc exceeds the max of 1000");
  }

  const wallet = String(body.publisher_wallet ?? "").trim();
  if (!isAddress(wallet)) errors.push("publisher_wallet is not a valid EVM address");

  const description = body.description == null ? null : String(body.description).slice(0, 280);
  const rate_limit_rpm = clampInt(body.rate_limit_rpm, 100, 1, 100_000);
  const agent_limit_rpm = clampInt(body.agent_limit_rpm, 10, 1, 100_000);

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: { slug, target_url: target, price_usdc: price, publisher_wallet: wallet, description, rate_limit_rpm, agent_limit_rpm },
  };
}

export function buildPatchOwnershipMessage(input: {
  slug: string;
  publisher_wallet: string;
  active: boolean;
  issued_at: string;
}): string {
  return [
    "Stent endpoint update",
    `slug: ${input.slug}`,
    `publisher_wallet: ${input.publisher_wallet.toLowerCase()}`,
    `active: ${input.active ? "true" : "false"}`,
    `issued_at: ${input.issued_at}`,
  ].join("\n");
}

export async function verifyPatchOwnership(
  slug: string,
  ownerWallet: string,
  body: PatchOwnershipInput,
  opts: { now?: number } = {}
): Promise<
  | { ok: true; publisher_wallet: string; active: boolean }
  | { ok: false; status: number; error: string }
> {
  const publisher_wallet = String(body.publisher_wallet ?? "").trim();
  if (!publisher_wallet || !isAddress(publisher_wallet)) {
    return { ok: false, status: 400, error: "publisher_wallet required" };
  }
  if (publisher_wallet.toLowerCase() !== ownerWallet.toLowerCase()) {
    return { ok: false, status: 403, error: "wallet_mismatch" };
  }
  if (typeof body.active !== "boolean") {
    return { ok: false, status: 400, error: "active (boolean) required" };
  }
  const issued_at = String(body.issued_at ?? "").trim();
  const issuedMs = Date.parse(issued_at);
  const now = opts.now ?? Date.now();
  if (!issued_at || !Number.isFinite(issuedMs) || Math.abs(now - issuedMs) > PATCH_SIGNATURE_TTL_MS) {
    return { ok: false, status: 401, error: "signature_expired" };
  }
  const signature = String(body.signature ?? "").trim();
  if (!/^0x[a-fA-F0-9]+$/.test(signature)) {
    return { ok: false, status: 401, error: "signature_required" };
  }
  const message = buildPatchOwnershipMessage({
    slug,
    publisher_wallet,
    active: body.active,
    issued_at,
  });
  const valid = await verifyMessage({
    address: publisher_wallet as `0x${string}`,
    message,
    signature: signature as `0x${string}`,
  }).catch(() => false);
  if (!valid) return { ok: false, status: 403, error: "invalid_signature" };
  return { ok: true, publisher_wallet, active: body.active };
}

export function createRegistrationRouter(): Router {
  const router = Router();
  router.use(express.json({ limit: "16kb" }));
  router.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // Register a new (unverified) endpoint.
  router.post("/endpoints", async (req, res) => {
    const ip = req.ip ?? "unknown";
    if (!rateLimiter.hit(`register:${ip}`, REGISTER_RPM).allowed) {
      res.status(429).json({ error: "rate_limited" });
      return;
    }
    const v = validateRegistration((req.body ?? {}) as RegistrationInput, { allowInsecure: ALLOW_INSECURE });
    if (!v.ok) {
      res.status(400).json({ error: "invalid_registration", details: v.errors });
      return;
    }
    const token = `stent-verify-${randomBytes(16).toString("hex")}`;
    const { error } = await supabase
      .from("endpoints")
      .insert({ ...v.value, verification_token: token, verified: false, active: true });
    if (error) {
      if (/duplicate key|unique/i.test(error.message)) {
        res.status(409).json({ error: "slug_taken" });
        return;
      }
      console.error("[register] insert failed:", error.message);
      res.status(500).json({ error: "insert_failed" });
      return;
    }
    const origin = new URL(v.value.target_url).origin;
    res.status(201).json({
      slug: v.value.slug,
      verified: false,
      verification_token: token,
      next_steps: {
        "1": `Serve this exact token as plain text at ${origin}/stent-verification.txt`,
        "2": `POST /_api/endpoints/${v.value.slug}/verify to verify ownership and go live`,
      },
    });
  });

  // Prove ownership → flip verified. The proxy cache picks it up via realtime.
  // Security: this endpoint can only VERIFY (false→true), never UN-VERIFY.
  // An already-verified endpoint returns 200 idempotently with no DB write.
  // A failed verification on an unverified endpoint returns 422 with no DB write.
  router.post("/endpoints/:slug/verify", async (req, res) => {
    const { data: ep, error } = await supabase
      .from("endpoints")
      .select("slug, target_url, verification_token, verified")
      .eq("slug", req.params.slug)
      .maybeSingle();
    if (error) {
      res.status(500).json({ error: "db_error" });
      return;
    }
    if (!ep || !ep.verification_token) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (ep.verified) {
      res.status(200).json({ slug: req.params.slug, verified: true, reason: "already_verified" });
      return;
    }
    const result = await verifyOwnership(ep.target_url, ep.verification_token, {
      allowInsecureLoopback: ALLOW_INSECURE,
    });
    if (!result.verified) {
      res.status(422).json({ slug: req.params.slug, verified: false, reason: result.reason });
      return;
    }
    const { error: upErr } = await supabase
      .from("endpoints")
      .update({ verified: true, sample_response: result.sampleBody ?? null })
      .eq("slug", req.params.slug);
    if (upErr) {
      res.status(500).json({ error: "update_failed" });
      return;
    }
    res.status(200).json({ slug: req.params.slug, verified: true });
  });

  // Public directory: only live, verified endpoints. No tokens leaked.
  router.get("/endpoints", async (_req, res) => {
    const { data, error } = await supabase
      .from("endpoints")
      .select("slug, price_usdc, description, publisher_wallet, created_at")
      .eq("active", true)
      .eq("verified", true)
      .order("created_at", { ascending: false });
    if (error) {
      res.status(500).json({ error: "db_error" });
      return;
    }
    res.json({ endpoints: data ?? [] });
  });

  // Deactivate or update an endpoint. Requires a fresh wallet signature over the
  // exact slug + active value; publisher_wallet is an identifier, not auth.
  router.patch("/endpoints/:slug", async (req, res) => {
    const ip = req.ip ?? "unknown";
    if (!rateLimiter.hit(`register:${ip}`, REGISTER_RPM).allowed) {
      res.status(429).json({ error: "rate_limited" });
      return;
    }
    const { data: ep, error: fetchErr } = await supabase
      .from("endpoints")
      .select("slug, publisher_wallet")
      .eq("slug", req.params.slug)
      .maybeSingle();
    if (fetchErr) {
      res.status(500).json({ error: "db_error" });
      return;
    }
    if (!ep) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const auth = await verifyPatchOwnership(
      req.params.slug,
      ep.publisher_wallet,
      (req.body ?? {}) as PatchOwnershipInput
    );
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error });
      return;
    }
    const { error: upErr } = await supabase
      .from("endpoints")
      .update({ active: auth.active })
      .eq("slug", req.params.slug);
    if (upErr) {
      res.status(500).json({ error: "update_failed" });
      return;
    }
    res.json({ slug: req.params.slug, active: auth.active });
  });

  // Status for a single slug (publisher polls verification). No token leak.
  router.get("/endpoints/:slug", async (req, res) => {
    const { data, error } = await supabase
      .from("endpoints")
      .select("slug, price_usdc, description, publisher_wallet, verified, active, created_at, sample_response")
      .eq("slug", req.params.slug)
      .maybeSingle();
    if (error) {
      res.status(500).json({ error: "db_error" });
      return;
    }
    if (!data) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json(data);
  });

  return router;
}
