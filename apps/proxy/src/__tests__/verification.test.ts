import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  verifyOwnership,
  isBlockedIp,
  assertPublicHost,
  createPinnedLookup,
  type LookupFn,
} from "../verification";

function fakeFetch(status: number, body: string): typeof fetch {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  })) as unknown as typeof fetch;
}

// Make the SSRF guard deterministic in tests: resolve every host to a public IP
// unless a test overrides it.
const publicLookup: LookupFn = async () => [{ address: "93.184.216.34", family: 4 }];
const lookupTo = (...addrs: string[]): LookupFn => async () =>
  addrs.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
type TestHandler = (req: IncomingMessage, res: ServerResponse) => void;

describe("verifyOwnership (token comparison — public hosts)", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("verifies when the served token matches (whitespace-insensitive)", async () => {
    const r = await verifyOwnership("https://api.example.com/data", "tok-123", {
      fetchImpl: fakeFetch(200, "  tok-123\n"),
      lookupImpl: publicLookup,
    });
    expect(r).toMatchObject({ verified: true, reason: "verification_successful", found: "tok-123" });
  });

  it("rejects on token mismatch", async () => {
    const r = await verifyOwnership("https://api.example.com/data", "tok-123", {
      fetchImpl: fakeFetch(200, "different"),
      lookupImpl: publicLookup,
    });
    expect(r).toMatchObject({ verified: false, reason: "token_mismatch" });
  });

  it("rejects when the file is missing", async () => {
    const r = await verifyOwnership("https://api.example.com", "tok-123", {
      fetchImpl: fakeFetch(404, "Not Found"),
      lookupImpl: publicLookup,
    });
    expect(r).toMatchObject({ verified: false, reason: "http_404", httpStatus: 404 });
  });

  it("reports 5xx responses precisely", async () => {
    const r = await verifyOwnership("https://api.example.com", "tok-123", {
      fetchImpl: fakeFetch(500, "Internal Server Error"),
      lookupImpl: publicLookup,
    });
    expect(r).toMatchObject({ verified: false, reason: "http_5xx", httpStatus: 500 });
  });

  it("reports fetch connection failures without saying DNS/unreachable", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const r = await verifyOwnership("https://down.example.com", "tok-123", {
      fetchImpl,
      lookupImpl: publicLookup,
    });
    expect(r).toMatchObject({ verified: false, reason: "connection_failed" });
  });

  it("reports TLS handshake failures precisely", async () => {
    const fetchImpl = vi.fn(async () => {
      const err = new Error("certificate has expired") as NodeJS.ErrnoException;
      err.code = "CERT_HAS_EXPIRED";
      throw err;
    }) as unknown as typeof fetch;
    const r = await verifyOwnership("https://tls.example.com", "tok-123", {
      fetchImpl,
      lookupImpl: publicLookup,
    });
    expect(r).toMatchObject({ verified: false, reason: "tls_failure" });
  });

  it("reports DNS lookup failures precisely", async () => {
    const lookup: LookupFn = async () => {
      throw new Error("ENOTFOUND");
    };
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const r = await verifyOwnership("https://missing.example.com", "tok-123", {
      fetchImpl,
      lookupImpl: lookup,
    });
    expect(r).toMatchObject({ verified: false, reason: "dns_lookup_failed" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects an empty verification file", async () => {
    const r = await verifyOwnership("https://api.example.com/data", "tok-123", {
      fetchImpl: fakeFetch(200, " \n\t"),
      lookupImpl: publicLookup,
    });
    expect(r).toMatchObject({ verified: false, reason: "empty_verification_file" });
  });

  it("rejects an empty expected token outright (no fetch)", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const r = await verifyOwnership("https://api.example.com", "   ", { fetchImpl });
    expect(r).toMatchObject({ verified: false, reason: "no_expected_token" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("verifyOwnership production request path", () => {
  let server: Server | undefined;

  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((err) => (err ? reject(err) : resolve()));
      });
      server = undefined;
    }
  });

  async function listen(handler: TestHandler): Promise<{ origin: string; lookup: LookupFn }> {
    server = createServer(handler);
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server did not bind to a TCP port");
    return {
      origin: `http://127.0.0.1:${address.port}`,
      lookup: async () => [{ address: "127.0.0.1", family: 4 }],
    };
  }

  it("verifies by reading /stent-verification.txt from a reachable server", async () => {
    const { origin, lookup } = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("  tok-123\n");
    });
    const r = await verifyOwnership(origin, "tok-123", {
      lookupImpl: lookup,
      allowInsecureLoopback: true,
    });
    expect(r).toMatchObject({
      verified: true,
      reason: "verification_successful",
      verificationUrl: `${origin}/stent-verification.txt`,
      httpStatus: 200,
      found: "tok-123",
    });
  });

  it("follows redirect responses to the verification token", async () => {
    const { origin, lookup } = await listen((req, res) => {
      if (req.url === "/stent-verification.txt") {
        res.writeHead(302, { location: "/verification-target.txt" });
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("tok-redirect");
    });
    const r = await verifyOwnership(origin, "tok-redirect", {
      lookupImpl: lookup,
      allowInsecureLoopback: true,
    });
    expect(r).toMatchObject({ verified: true, reason: "verification_successful", httpStatus: 200 });
  });

  it("reports redirect loops precisely", async () => {
    const { origin, lookup } = await listen((_req, res) => {
      res.writeHead(302, { location: "/stent-verification.txt" });
      res.end();
    });
    const r = await verifyOwnership(origin, "tok-123", {
      lookupImpl: lookup,
      allowInsecureLoopback: true,
    });
    expect(r).toMatchObject({ verified: false, reason: "redirect_loop" });
  });

  it("reports connection timeouts precisely", async () => {
    const { origin, lookup } = await listen((_req, _res) => {
      // Hold the socket open beyond the verifier timeout.
    });
    const r = await verifyOwnership(origin, "tok-123", {
      lookupImpl: lookup,
      allowInsecureLoopback: true,
      timeoutMs: 30,
    });
    expect(r).toMatchObject({ verified: false, reason: "connection_timeout" });
  });

});

describe("createPinnedLookup", () => {
  it("returns array results for Railway-style hosts when Node asks lookup({ all: true })", async () => {
    const lookup = createPinnedLookup({ address: "69.46.46.104", family: 4 });
    const addresses = await new Promise<{ address: string; family: number }[]>((resolve, reject) => {
      lookup(
        "stent-production.up.railway.app",
        { all: true },
        (err: NodeJS.ErrnoException | null, result: { address: string; family: number }[]) => {
          if (err) reject(err);
          else resolve(result);
        }
      );
    });
    expect(addresses).toEqual([{ address: "69.46.46.104", family: 4 }]);
  });
});

describe("isBlockedIp (SSRF address classification)", () => {
  const blocked = [
    "127.0.0.1", // loopback
    "10.0.0.1",
    "10.255.255.255", // RFC1918
    "172.16.0.1",
    "172.31.255.255", // RFC1918
    "192.168.1.1", // RFC1918
    "169.254.1.1", // link-local
    "169.254.169.254", // cloud metadata
    "100.64.0.1",
    "100.100.100.200", // CGNAT / metadata
    "0.0.0.0",
    "224.0.0.1", // multicast
    "::1", // loopback v6
    "::", // unspecified
    "fe80::1", // link-local v6
    "fc00::1",
    "fd12:3456:789a::1", // ULA v6
    "::ffff:127.0.0.1", // IPv4-mapped loopback
    "::ffff:10.0.0.1", // IPv4-mapped RFC1918
  ];
  const allowed = [
    "8.8.8.8",
    "1.1.1.1",
    "93.184.216.34",
    "172.15.255.255", // just below 172.16/12
    "172.32.0.1", // just above 172.16/12
    "100.63.255.255", // just below CGNAT
    "100.128.0.0", // just above CGNAT
    "2606:2800:220:1:248:1893:25c8:1946",
    "::ffff:8.8.8.8",
  ];

  for (const ip of blocked) it(`blocks ${ip}`, () => expect(isBlockedIp(ip)).toBe(true));
  for (const ip of allowed) it(`allows ${ip}`, () => expect(isBlockedIp(ip)).toBe(false));
  it("fails closed on garbage", () => expect(isBlockedIp("not-an-ip")).toBe(true));
});

describe("assertPublicHost", () => {
  it("blocks localhost by name without resolving", async () => {
    const lookup = vi.fn() as unknown as LookupFn;
    expect(await assertPublicHost("localhost", lookup)).toMatchObject({ ok: false, reason: "blocked_target" });
    expect(await assertPublicHost("api.localhost", lookup)).toMatchObject({ ok: false });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("blocks private IP literals, allows public ones", async () => {
    expect(await assertPublicHost("127.0.0.1")).toMatchObject({ ok: false, reason: "blocked_target" });
    expect(await assertPublicHost("169.254.169.254")).toMatchObject({ ok: false });
    expect(await assertPublicHost("8.8.8.8")).toEqual({ ok: true });
  });

  it("blocks a domain that resolves to a private address", async () => {
    expect(await assertPublicHost("evil.example.com", lookupTo("10.0.0.5"))).toMatchObject({
      ok: false,
      reason: "blocked_target",
    });
  });

  it("blocks if ANY resolved address is private (rebind defense)", async () => {
    expect(
      await assertPublicHost("mixed.example.com", lookupTo("93.184.216.34", "127.0.0.1"))
    ).toMatchObject({ ok: false, reason: "blocked_target" });
  });

  it("allows a domain that resolves to a public address", async () => {
    expect(await assertPublicHost("api.example.com", lookupTo("93.184.216.34"))).toEqual({ ok: true });
  });

  it("reports unresolvable when DNS fails", async () => {
    const lookup: LookupFn = async () => {
      throw new Error("ENOTFOUND");
    };
    expect(await assertPublicHost("nope.invalid", lookup)).toMatchObject({ ok: false, reason: "unresolvable" });
  });
});

describe("verifyOwnership SSRF guard", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("blocks a private target BEFORE any fetch", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const r = await verifyOwnership("https://internal.example.com/x", "tok", {
      fetchImpl,
      lookupImpl: lookupTo("10.1.2.3"),
    });
    expect(r).toMatchObject({ verified: false, reason: "blocked_target" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("blocks a metadata-IP target before fetch", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const r = await verifyOwnership("https://169.254.169.254/latest/meta-data", "tok", { fetchImpl });
    expect(r).toMatchObject({ verified: false, reason: "blocked_target" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("still verifies a legitimate public endpoint (behavior unchanged)", async () => {
    const r = await verifyOwnership("https://api.publisher.com/data", "secret-token", {
      fetchImpl: fakeFetch(200, "secret-token"),
      lookupImpl: lookupTo("93.184.216.34"),
    });
    expect(r).toMatchObject({ verified: true });
  });
});
