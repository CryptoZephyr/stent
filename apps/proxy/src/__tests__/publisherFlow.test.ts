import express from "express";
import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRegistrationRouter } from "../registration";

type EndpointRow = {
  slug: string;
  target_url: string;
  price_usdc: string;
  publisher_wallet: string;
  description: string | null;
  rate_limit_rpm: number;
  agent_limit_rpm: number;
  verification_token: string;
  verified: boolean;
  active: boolean;
  created_at: string;
  sample_response: string | null;
};

const db = vi.hoisted(() => {
  process.env.STENT_ALLOW_INSECURE_TARGETS = "true";
  const rows = new Map<string, EndpointRow>();
  const matches = (row: EndpointRow, filters: Record<string, unknown>) =>
    Object.entries(filters).every(([key, value]) => row[key as keyof EndpointRow] === value);

  return {
    rows,
    supabase: {
      from: () => {
        const filters: Record<string, unknown> = {};
        let operation: "select" | "update" | null = null;
        let updatePayload: Partial<EndpointRow> = {};

        // Applies the pending update to every row matching the accumulated
        // filters and returns the affected rows. Idempotent to call once;
        // both the implicit await path (no .select()) and the explicit
        // .select() path route through this.
        const applyUpdate = () => {
          const affected: EndpointRow[] = [];
          for (const row of rows.values()) {
            if (matches(row, filters)) {
              Object.assign(row, updatePayload);
              affected.push(row);
            }
          }
          return affected;
        };

        const builder = {
          insert: async (row: EndpointRow) => {
            if (rows.has(row.slug)) return { error: { message: "duplicate key value violates unique constraint" } };
            rows.set(row.slug, { ...row, created_at: "2026-07-02T00:00:00.000Z" });
            return { error: null };
          },
          select: () => {
            if (operation === "update") {
              // Terminal call for update().eq()...select() chains: apply now
              // and resolve with the affected rows (Supabase's own shape).
              const affected = applyUpdate();
              return Promise.resolve({ data: affected, error: null });
            }
            operation = "select";
            return builder;
          },
          update: (patch: Partial<EndpointRow>) => {
            operation = "update";
            updatePayload = patch;
            return builder;
          },
          eq: (column: string, value: unknown) => {
            filters[column] = value;
            return builder;
          },
          maybeSingle: async () => ({
            data: Array.from(rows.values()).find((row) => matches(row, filters)) ?? null,
            error: null,
          }),
          order: async () => ({
            data: Array.from(rows.values()).filter((row) => matches(row, filters)),
            error: null,
          }),
          // Makes `await builder` work for call sites that end the chain on
          // .eq() directly (no .select()), e.g. verify/patch updates.
          then: (resolve: (v: { error: null }) => void) => {
            if (operation === "update") applyUpdate();
            resolve({ error: null });
          },
        };
        return builder;
      },
    },
  };
});

vi.mock("../supabaseClient", () => ({ supabase: db.supabase }));

describe("publisher ownership verification flow", () => {
  let api: Server | undefined;
  let origin: Server | undefined;

  beforeEach(() => {
    db.rows.clear();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await closeServer(api);
    await closeServer(origin);
    api = undefined;
    origin = undefined;
    vi.restoreAllMocks();
  });

  it("registers, verifies the generated token, and publishes the endpoint in the marketplace", async () => {
    let servedToken = "";
    const sampleData = JSON.stringify({ block: 12345, gasPrice: "20.24" });
    origin = createServer((req, res) => {
      if (req.url === "/stent-verification.txt" && servedToken) {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end(servedToken);
        return;
      }
      if (req.url === "/arc-stats") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(sampleData);
        return;
      }
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    });
    const originUrl = await listen(origin);

    const app = express();
    app.use("/_api", createRegistrationRouter());
    api = createServer(app);
    const apiUrl = await listen(api);

    const registerRes = await fetch(`${apiUrl}/_api/endpoints`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        slug: "flow-test",
        target_url: `${originUrl}/arc-stats`,
        price_usdc: "0.001",
        publisher_wallet: "0x38D5f89A6f91139d5BeBCEf01E1aaaaAca90D0f1",
        description: "Flow test",
      }),
    });
    expect(registerRes.status).toBe(201);
    const registered = (await registerRes.json()) as { verification_token: string };
    expect(registered.verification_token).toMatch(/^stent-verify-[a-f0-9]{32}$/);

    servedToken = registered.verification_token;
    const verifyRes = await fetch(`${apiUrl}/_api/endpoints/flow-test/verify`, { method: "POST" });
    expect(verifyRes.status).toBe(200);
    await expect(verifyRes.json()).resolves.toMatchObject({ slug: "flow-test", verified: true });

    const statusRes = await fetch(`${apiUrl}/_api/endpoints/flow-test`);
    expect(statusRes.status).toBe(200);
    await expect(statusRes.json()).resolves.toMatchObject({
      slug: "flow-test",
      sample_response: sampleData,
    });

    const marketplaceRes = await fetch(`${apiUrl}/_api/endpoints`);
    expect(marketplaceRes.status).toBe(200);
    await expect(marketplaceRes.json()).resolves.toMatchObject({
      endpoints: [expect.objectContaining({ slug: "flow-test", verified: true, active: true })],
    });
  });

  it("reissues an UNVERIFIED slug on re-registration (orphaned-token recovery)", async () => {
    const app = express();
    app.use("/_api", createRegistrationRouter());
    api = createServer(app);
    const apiUrl = await listen(api);

    const original = {
      slug: "orphan-test",
      target_url: "http://localhost:8787/arc-stats",
      price_usdc: "0.001",
      publisher_wallet: "0x38D5f89A6f91139d5BeBCEf01E1aaaaAca90D0f1",
      description: "Original registration",
    };
    const firstRes = await fetch(`${apiUrl}/_api/endpoints`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(original),
    });
    expect(firstRes.status).toBe(201);
    const first = (await firstRes.json()) as { verification_token: string; reissued: boolean };
    expect(first.reissued).toBe(false);

    // Simulate the original registrant losing their token: a different wallet
    // (or the same one, doesn't matter — nobody has proven ownership yet)
    // re-registers the same slug with different details.
    const replacement = {
      slug: "orphan-test",
      target_url: "http://localhost:8787/usdc-volume",
      price_usdc: "0.0007",
      publisher_wallet: "0x000000000000000000000000000000000000dEaD",
      description: "Replacement registration",
    };
    const secondRes = await fetch(`${apiUrl}/_api/endpoints`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(replacement),
    });
    expect(secondRes.status).toBe(201);
    const second = (await secondRes.json()) as { verification_token: string; reissued: boolean; verified: boolean };
    expect(second.reissued).toBe(true);
    expect(second.verified).toBe(false);
    expect(second.verification_token).toMatch(/^stent-verify-[a-f0-9]{32}$/);
    expect(second.verification_token).not.toBe(first.verification_token);

    const stored = db.rows.get("orphan-test");
    expect(stored).toMatchObject({
      target_url: replacement.target_url,
      price_usdc: replacement.price_usdc,
      publisher_wallet: replacement.publisher_wallet,
      description: replacement.description,
      verified: false,
      active: true,
      verification_token: second.verification_token,
    });

    // The old token no longer matches — any in-flight verify using it is
    // honestly rejected as a mismatch, not silently accepted.
    expect(stored?.verification_token).not.toBe(first.verification_token);
  });

  it("refuses to reissue a VERIFIED slug (still 409, row untouched)", async () => {
    const app = express();
    app.use("/_api", createRegistrationRouter());
    api = createServer(app);
    const apiUrl = await listen(api);

    db.rows.set("locked-test", {
      slug: "locked-test",
      target_url: "https://api.example.com/data",
      price_usdc: "0.002",
      publisher_wallet: "0x38D5f89A6f91139d5BeBCEf01E1aaaaAca90D0f1",
      description: "Live endpoint",
      rate_limit_rpm: 100,
      agent_limit_rpm: 10,
      verification_token: "stent-verify-original-token",
      verified: true,
      active: true,
      created_at: "2026-07-02T00:00:00.000Z",
      sample_response: null,
    });

    const res = await fetch(`${apiUrl}/_api/endpoints`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        slug: "locked-test",
        target_url: "https://attacker.example.com/hijack",
        price_usdc: "0.5",
        publisher_wallet: "0x000000000000000000000000000000000000dEaD",
        description: "Attempted hijack",
      }),
    });
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: "slug_taken" });

    const stored = db.rows.get("locked-test");
    expect(stored).toMatchObject({
      target_url: "https://api.example.com/data",
      price_usdc: "0.002",
      publisher_wallet: "0x38D5f89A6f91139d5BeBCEf01E1aaaaAca90D0f1",
      verified: true,
      verification_token: "stent-verify-original-token",
    });
  });

  it("validates re-registration input the same as fresh registration (TLS rule still applies)", async () => {
    const app = express();
    app.use("/_api", createRegistrationRouter());
    api = createServer(app);
    const apiUrl = await listen(api);

    const original = {
      slug: "revalidate-test",
      target_url: "http://localhost:8787/arc-stats",
      price_usdc: "0.001",
      publisher_wallet: "0x38D5f89A6f91139d5BeBCEf01E1aaaaAca90D0f1",
      description: "Original",
    };
    const firstRes = await fetch(`${apiUrl}/_api/endpoints`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(original),
    });
    expect(firstRes.status).toBe(201);

    // Non-loopback http:// must still be rejected on re-registration, exactly
    // like fresh registration (Security Rule #5, TLS-only).
    const badRes = await fetch(`${apiUrl}/_api/endpoints`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...original, target_url: "http://api.example.com/insecure" }),
    });
    expect(badRes.status).toBe(400);
    await expect(badRes.json()).resolves.toMatchObject({ error: "invalid_registration" });

    // Row must be untouched by the rejected attempt.
    const stored = db.rows.get("revalidate-test");
    expect(stored).toMatchObject({ target_url: original.target_url, verified: false });
  });
});

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("server did not bind to TCP");
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function closeServer(server: Server | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server?.listening) {
      resolve();
      return;
    }
    server.close((err) => (err ? reject(err) : resolve()));
  });
}
