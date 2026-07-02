import { describe, it, expect, vi, beforeEach } from "vitest";
import { createServer } from "../server";
import type { EndpointConfig } from "../supabaseClient";
import type { ProxyRequest } from "../requestContext";

const endpoint: EndpointConfig = {
  slug: "paid",
  publisher_wallet: "0x38D5f89A6f91139d5BeBCEf01E1aaaaAca90D0f1",
  price_usdc: "0.001",
  target_url: "https://api.example.com/data",
  description: null,
  rate_limit_rpm: 100,
  agent_limit_rpm: 10,
  verified: true,
  active: true,
};

let abortReason = "agent_rate_limited";
let shouldSucceed = false;

vi.mock("../endpointCache", () => ({
  endpointCache: {
    get: (slug: string) => (slug === "paid" ? endpoint : undefined),
  },
}));

vi.mock("../registration", () => ({
  createRegistrationRouter: () => {
    const express = require("express") as typeof import("express");
    return express.Router();
  },
}));

vi.mock("../gateway", () => ({
  getPaymentHandler: () => (req: ProxyRequest, res: import("express").Response, next: import("express").NextFunction) => {
    if (shouldSucceed) {
      req.stentUpstream = {
        status: 200,
        contentType: "application/json",
        body: Buffer.from('{"ok":true}'),
      };
      next();
      return;
    }
    if (abortReason.startsWith("upstream_status_")) {
      req.stentUpstream = {
        status: 404,
        contentType: "text/plain",
        body: Buffer.from("origin missing"),
      };
    }
    res.status(402).json({ error: "Payment settlement aborted", reason: abortReason });
  },
}));

async function requestFrom(app: ReturnType<typeof createServer>, path: string, headers: Record<string, string> = {}) {
  const server = app.listen(0);
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("listen_failed");
    const res = await fetch(`http://127.0.0.1:${address.port}${path}`, { headers });
    return {
      status: res.status,
      retryAfter: res.headers.get("retry-after"),
      contentType: res.headers.get("content-type"),
      text: await res.text(),
    };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function request(path: string, headers: Record<string, string> = {}) {
  return requestFrom(createServer(), path, headers);
}

describe("server payment response handling", () => {
  beforeEach(() => {
    abortReason = "agent_rate_limited";
    shouldSucceed = false;
    process.env.IP_FLOOD_RPM = "600";
  });

  it("rewrites SDK settlement abort 402s to the documented 429 with Retry-After", async () => {
    abortReason = "agent_rate_limited";
    const res = await request("/paid");
    expect(res.status).toBe(429);
    expect(res.retryAfter).toBe("60");
    expect(JSON.parse(res.text)).toEqual({ error: "agent_rate_limited" });
  });

  it("relays the upstream status/body for upstream non-2xx settlement aborts", async () => {
    abortReason = "upstream_status_404";
    const res = await request("/paid");
    expect(res.status).toBe(404);
    expect(res.contentType).toMatch(/text\/plain/);
    expect(res.text).toBe("origin missing");
  });

  it("does not let client-supplied X-Forwarded-For rotate past the per-IP flood guard", async () => {
    process.env.IP_FLOOD_RPM = "1";
    shouldSucceed = true;
    const app = createServer();
    const first = await requestFrom(app, "/paid", {
      "x-forwarded-for": "1.1.1.1, 203.0.113.9",
    });
    const second = await requestFrom(app, "/paid", {
      "x-forwarded-for": "2.2.2.2, 203.0.113.9",
    });
    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(JSON.parse(second.text)).toMatchObject({ error: "ip_rate_limited" });
  });
});
