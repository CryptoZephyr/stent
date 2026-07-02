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
    case "unreachable":
      return {
        title: "Couldn't reach your server",
        guidance: `We couldn't connect to ${fileUrl}. Check the URL is public and your server is running, then check again.`,
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
      if (reason.startsWith("fetch_status_")) {
        const code = reason.replace("fetch_status_", "");
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
