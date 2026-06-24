import { describe, it, expect, vi } from "vitest";
import { verifyOwnership } from "../verification";

function fakeFetch(status: number, body: string): typeof fetch {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  })) as unknown as typeof fetch;
}

describe("verifyOwnership", () => {
  it("verifies when the served token matches (whitespace-insensitive)", async () => {
    const r = await verifyOwnership("https://api.example.com/data", "tok-123", {
      fetchImpl: fakeFetch(200, "  tok-123\n"),
    });
    expect(r).toMatchObject({ verified: true, found: "tok-123" });
  });

  it("rejects on token mismatch", async () => {
    const r = await verifyOwnership("https://api.example.com/data", "tok-123", {
      fetchImpl: fakeFetch(200, "different"),
    });
    expect(r).toMatchObject({ verified: false, reason: "token_mismatch" });
  });

  it("rejects when the file is missing (non-2xx)", async () => {
    const r = await verifyOwnership("https://api.example.com", "tok-123", {
      fetchImpl: fakeFetch(404, "Not Found"),
    });
    expect(r).toMatchObject({ verified: false, reason: "fetch_status_404" });
  });

  it("rejects when the origin is unreachable", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    const r = await verifyOwnership("https://down.example.com", "tok-123", { fetchImpl });
    expect(r).toMatchObject({ verified: false, reason: "unreachable" });
  });

  it("rejects an empty expected token outright (no fetch)", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const r = await verifyOwnership("https://api.example.com", "   ", { fetchImpl });
    expect(r).toMatchObject({ verified: false, reason: "no_expected_token" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
