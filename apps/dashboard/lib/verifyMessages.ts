/**
 * Centralized, plain-language translation of verification outcomes.
 *
 * The proxy returns a terse `reason` code (or a network error). This maps each
 * to a clear title + guidance the publisher can act on, plus a small `detail`
 * string for debugging. Keep this the single source of truth for verify copy.
 */
export interface VerifyResultLike {
  verified: boolean;
  reason?: string;
  status: number;
  error?: string;
}

export interface VerifyMessage {
  title: string;
  guidance: string;
  /** Raw code shown small for support/debugging. */
  detail: string;
}

export function verifyMessage(r: VerifyResultLike, ctx: { fileUrl: string }): VerifyMessage {
  const { fileUrl } = ctx;

  // Network / CORS failure surfaced by the API client.
  if (r.error) {
    return { title: "Couldn't reach Stent", guidance: r.error, detail: "network_error" };
  }

  // Prefer the server's reason; fall back to HTTP status for route-level errors.
  const reason =
    r.reason ?? (r.status === 404 ? "not_found" : r.status >= 500 ? "server_error" : "unknown");

  switch (reason) {
    case "token_mismatch":
      return {
        title: "The file didn't contain the right token",
        guidance:
          "We reached your file but the contents didn't match. It must return only the token — no quotes, no HTML, no extra spaces or lines.",
        detail: reason,
      };
    case "dns_lookup_failed":
      return {
        title: "DNS lookup failed",
        guidance: `We couldn't resolve the hostname for ${fileUrl}. Check that the domain is public and its DNS records are live, then check again.`,
        detail: reason,
      };
    case "connection_timeout":
      return {
        title: "Connection timed out",
        guidance: `We resolved your server but it did not respond before the timeout. Check that ${fileUrl} is reachable from the public internet, then check again.`,
        detail: reason,
      };
    case "tls_failure":
      return {
        title: "TLS failed",
        guidance: `We reached your server but couldn't complete the HTTPS handshake. Check the certificate for ${fileUrl}, then check again.`,
        detail: reason,
      };
    case "redirect_loop":
      return {
        title: "Redirect loop",
        guidance: `The verification file redirected too many times. Make ${fileUrl} return the token directly, or redirect once to a public HTTPS URL that does.`,
        detail: reason,
      };
    case "connection_failed":
      return {
        title: "Connection failed",
        guidance: `We resolved your server but couldn't connect to ${fileUrl}. Check that the server is running and reachable from the public internet, then check again.`,
        detail: reason,
      };
    case "http_404":
      return {
        title: "No file found there",
        guidance: `We fetched ${fileUrl} but got HTTP 404. Make sure the file exists at your domain root and returns 200.`,
        detail: reason,
      };
    case "http_5xx":
      return {
        title: "Your server returned an error",
        guidance: `We fetched ${fileUrl} but your server returned a 5xx error. Fix the route and check again.`,
        detail: reason,
      };
    case "empty_verification_file":
      return {
        title: "The file was empty",
        guidance: `We reached ${fileUrl}, but it didn't contain a token. It must return only the token shown above.`,
        detail: reason,
      };
    case "verification_successful":
      return {
        title: "Verification successful",
        guidance: "Your verification file matched.",
        detail: reason,
      };
    case "blocked_target":
      return {
        title: "That address isn't public",
        guidance:
          "Your endpoint URL resolves to a private or internal address (localhost, a LAN IP, or a cloud-metadata address). Stent only verifies endpoints reachable on the public internet — re-register with a public https URL.",
        detail: reason,
      };
    case "invalid_target_url":
      return {
        title: "That URL looks invalid",
        guidance:
          "We couldn't parse your endpoint URL. Re-register with a full https URL, like https://api.yoursite.com/data.",
        detail: reason,
      };
    case "no_expected_token":
      return {
        title: "No token on file",
        guidance:
          "We don't have a verification token for this endpoint anymore. Register it again to get a fresh one.",
        detail: reason,
      };
    case "not_found":
      return {
        title: "Endpoint not found",
        guidance: "We couldn't find that endpoint id — it may have been removed. Register it again.",
        detail: "not_found",
      };
    case "server_error":
      return {
        title: "Something went wrong on our side",
        guidance: "Stent hit an error while verifying. Wait a moment and check again.",
        detail: `http_${r.status}`,
      };
    default:
      if (reason.startsWith("http_")) {
        const code = reason.replace("http_", "");
        return {
          title: "No file found there",
          guidance: `We fetched ${fileUrl} but got HTTP ${code}. Make sure the file exists at your domain root and returns 200.`,
          detail: reason,
        };
      }
      return {
        title: "Not verified yet",
        guidance: `We didn't find the token at ${fileUrl}. Add the file, then check again.`,
        detail: reason,
      };
  }
}
