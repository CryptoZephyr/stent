import { PROXY_URL } from "./config";

export interface RegisterInput {
  slug: string;
  target_url: string;
  price_usdc: string;
  publisher_wallet: string;
  description?: string;
}

export interface RegisterOk {
  slug: string;
  verified: boolean;
  verification_token: string;
  next_steps: Record<string, string>;
}

/**
 * In-progress register form fields, lifted to the page so they survive a trip
 * back to the Connect step (e.g. "change" the payout address) without losing
 * anything the publisher already typed.
 */
export interface RegisterDraft {
  url: string;
  slug: string;
  slugTouched: boolean;
  price: string;
  desc: string;
}

export const EMPTY_REGISTER_DRAFT: RegisterDraft = {
  url: "",
  slug: "",
  slugTouched: false,
  price: "0.001",
  desc: "",
};

export interface EndpointStatus {
  slug: string;
  price_usdc: string;
  description: string | null;
  publisher_wallet: string;
  verified: boolean;
  active: boolean;
  created_at: string;
  sample_response: string | null;
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; details?: string[]; status: number };

const base = `${PROXY_URL}/_api/endpoints`;

/** Friendly message for a network/CORS failure (the proxy unreachable). */
const NET_ERR =
  "Couldn't reach the Stent proxy. Check your connection and try again.";

export async function registerEndpoint(input: RegisterInput): Promise<ApiResult<RegisterOk>> {
  let res: Response;
  try {
    res = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    return { ok: false, error: NET_ERR, status: 0 };
  }
  const body = await res.json().catch(() => ({}));
  if (res.status === 201) return { ok: true, data: body as RegisterOk };
  if (res.status === 409) return { ok: false, error: "That endpoint id is taken — pick another.", status: 409 };
  if (res.status === 400)
    return { ok: false, error: "Check the highlighted fields.", details: body.details, status: 400 };
  if (res.status === 429) return { ok: false, error: "Too many attempts. Wait a minute and retry.", status: 429 };
  return { ok: false, error: "Something went wrong creating the endpoint.", status: res.status };
}

export async function verifyEndpoint(
  slug: string
): Promise<{ verified: boolean; reason?: string; status: number; error?: string }> {
  let res: Response;
  try {
    res = await fetch(`${base}/${encodeURIComponent(slug)}/verify`, { method: "POST" });
  } catch {
    return { verified: false, status: 0, error: NET_ERR };
  }
  const body = await res.json().catch(() => ({}));
  return { verified: !!body.verified, reason: body.reason, status: res.status };
}

export async function getStatus(slug: string): Promise<ApiResult<EndpointStatus>> {
  let res: Response;
  try {
    res = await fetch(`${base}/${encodeURIComponent(slug)}`);
  } catch {
    return { ok: false, error: NET_ERR, status: 0 };
  }
  if (res.status === 404) return { ok: false, error: "No endpoint with that id yet.", status: 404 };
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: "Couldn't load that endpoint.", status: res.status };
  return { ok: true, data: body as EndpointStatus };
}

/** Public marketplace directory: live, verified endpoints (safe columns only). */
export interface EndpointSummary {
  slug: string;
  price_usdc: string;
  description: string | null;
  publisher_wallet: string;
  created_at: string;
}

/** Must match the proxy's registration.ts `buildPatchOwnershipMessage` exactly. */
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

export async function setEndpointActive(
  slug: string,
  input: { publisher_wallet: string; active: boolean; issued_at: string; signature: string }
): Promise<ApiResult<{ slug: string; active: boolean }>> {
  let res: Response;
  try {
    res = await fetch(`${base}/${encodeURIComponent(slug)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    return { ok: false, error: NET_ERR, status: 0 };
  }
  const body = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true, data: body as { slug: string; active: boolean } };
  if (res.status === 403)
    return { ok: false, error: "Wrong wallet — only the endpoint's payout address can change this.", status: 403 };
  if (res.status === 401) return { ok: false, error: "Signature expired — try again.", status: 401 };
  if (res.status === 404) return { ok: false, error: "Endpoint not found.", status: 404 };
  if (res.status === 429) return { ok: false, error: "Too many attempts. Wait a minute and retry.", status: 429 };
  return { ok: false, error: "Couldn't update the endpoint.", status: res.status };
}

export async function listEndpoints(): Promise<ApiResult<EndpointSummary[]>> {
  let res: Response;
  try {
    res = await fetch(base);
  } catch {
    return { ok: false, error: NET_ERR, status: 0 };
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: "Couldn't load the marketplace.", status: res.status };
  return { ok: true, data: (body.endpoints ?? []) as EndpointSummary[] };
}
