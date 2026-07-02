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
        const builder = {
          insert: async (row: EndpointRow) => {
            if (rows.has(row.slug)) return { error: { message: "duplicate key value violates unique constraint" } };
            rows.set(row.slug, { ...row, created_at: "2026-07-02T00:00:00.000Z" });
            return { error: null };
          },
          select: () => {
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
            if (operation === "update") {
              for (const row of rows.values()) {
                if (matches(row, filters)) Object.assign(row, updatePayload);
              }
              return Promise.resolve({ error: null });
            }
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
