/**
 * URL ownership verification (anti-squatting). A publisher proves control of the
 * upstream by serving their Stent account token at `{origin}/stent-verification.txt`.
 * An endpoint must pass this check (verified = true) before the proxy serves it.
 *
 * `fetchImpl` is injectable so the comparison logic is unit-testable without a
 * live server.
 */
export interface VerifyResult {
  verified: boolean;
  /** Why it failed (when not verified). */
  reason?: string;
  /** The token actually found at the URL (trimmed), when fetched. */
  found?: string;
}

const VERIFICATION_PATH = "/stent-verification.txt";

export async function verifyOwnership(
  targetUrl: string,
  expectedToken: string,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<VerifyResult> {
  const expected = expectedToken.trim();
  if (!expected) return { verified: false, reason: "no_expected_token" };

  let origin: string;
  try {
    origin = new URL(targetUrl).origin;
  } catch {
    return { verified: false, reason: "invalid_target_url" };
  }

  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 5000);
  try {
    const res = await doFetch(`${origin}${VERIFICATION_PATH}`, { signal: controller.signal });
    if (!res.ok) return { verified: false, reason: `fetch_status_${res.status}` };
    const found = (await res.text()).trim();
    return found === expected
      ? { verified: true, found }
      : { verified: false, reason: "token_mismatch", found };
  } catch {
    return { verified: false, reason: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}
