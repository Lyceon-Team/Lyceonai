/**
 * @spec [SCL-202 ("HMAC-SHA256(server_secret, client_ip) ... the raw IP is never stored or
 *       logged"; item 2, Turnstile verified server-side); owner Step 0 decisions 2026-10-05
 *       (2: digest the IP in logs for /api/public/* only; 3: x-vercel-forwarded-for, then req.ip;
 *       8: Cloudflare's test keys until the real ones exist)] | @implemented [2026-10-05]
 *
 * plain English: unit proofs for the two primitives the public QOTD routes rest on —
 * server/lib/client-ip.ts and server/lib/turnstile.ts — and for the request logger's use of
 * loggableIp, so a raw IP from /api/public/* cannot reach a log line.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../server/logger";
import {
  PublicIpSecretMissingError,
  clientIp,
  loggableIp,
  subjectHmacHex,
} from "../../server/lib/client-ip";
import {
  TURNSTILE_SITEVERIFY_URL,
  TURNSTILE_TEST_SECRET_ALWAYS_PASSES,
  verifyTurnstile,
} from "../../server/lib/turnstile";

const SECRET = "unit-test-hmac-secret";

function req(over: {
  headers?: Record<string, string | string[]>;
  ip?: string;
  url?: string;
}) {
  return {
    headers: over.headers ?? {},
    ip: over.ip,
    socket: { remoteAddress: "10.0.0.9" },
    originalUrl: over.url ?? "/api/public/qotd/today",
  } as unknown as Parameters<typeof clientIp>[0];
}

let savedSecret: string | undefined;
beforeEach(() => {
  savedSecret = process.env.PUBLIC_RATE_LIMIT_HMAC_SECRET;
  process.env.PUBLIC_RATE_LIMIT_HMAC_SECRET = SECRET;
});
afterEach(() => {
  if (savedSecret === undefined)
    delete process.env.PUBLIC_RATE_LIMIT_HMAC_SECRET;
  else process.env.PUBLIC_RATE_LIMIT_HMAC_SECRET = savedSecret;
});

describe("clientIp", () => {
  it("prefers the first x-vercel-forwarded-for entry, then req.ip, then the socket", () => {
    expect(
      clientIp(
        req({
          headers: { "x-vercel-forwarded-for": "203.0.113.5, 10.1.1.1" },
          ip: "10.2.2.2",
        }),
      ),
    ).toBe("203.0.113.5");
    expect(clientIp(req({ ip: "198.51.100.1" }))).toBe("198.51.100.1");
    expect(clientIp(req({}))).toBe("10.0.0.9");
  });

  it("ignores x-forwarded-for, which a client can set (only Vercel's own header is trusted)", () => {
    expect(
      clientIp(
        req({ headers: { "x-forwarded-for": "1.2.3.4" }, ip: "198.51.100.1" }),
      ),
    ).toBe("198.51.100.1");
  });
});

describe("subjectHmacHex", () => {
  it("is HMAC-SHA256 keyed by the server secret: 64 hex, stable, and not the unkeyed hash", () => {
    const h = subjectHmacHex("203.0.113.5");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(
      createHmac("sha256", SECRET).update("203.0.113.5").digest("hex"),
    );
    expect(subjectHmacHex("203.0.113.6")).not.toBe(h);
  });

  it("throws when the secret is missing (the caller fails closed)", () => {
    delete process.env.PUBLIC_RATE_LIMIT_HMAC_SECRET;
    expect(() => subjectHmacHex("203.0.113.5")).toThrow(
      PublicIpSecretMissingError,
    );
  });
});

describe("loggableIp", () => {
  it("for /api/public/* logs an 8-hex prefix of the keyed HMAC, never the IP", () => {
    const ip = "203.0.113.5";
    const logged = loggableIp(
      req({ headers: { "x-vercel-forwarded-for": ip } }),
    );
    expect(logged).toBe(`hmac:${subjectHmacHex(ip).slice(0, 8)}`);
    expect(logged).not.toContain("203.0.113");
  });

  it("for /api/public/* logs nothing when the secret is missing", () => {
    delete process.env.PUBLIC_RATE_LIMIT_HMAC_SECRET;
    expect(
      loggableIp(req({ headers: { "x-vercel-forwarded-for": "203.0.113.5" } })),
    ).toBeUndefined();
  });

  it("other routes are unchanged (the narrow fix: owner decision 2)", () => {
    expect(loggableIp(req({ ip: "198.51.100.1", url: "/api/profile" }))).toBe(
      "198.51.100.1",
    );
  });

  it("the request logger and the final error handler log loggableIp, not req.ip", () => {
    for (const file of [
      "server/middleware/request-id.ts",
      "server/middleware/final-error-handler.ts",
    ]) {
      const src = readFileSync(file, "utf8");
      expect(src, file).toContain("loggableIp(req)");
      expect(src, file).not.toMatch(/\bip:\s*req\.ip\b/);
    }
  });
});

describe("verifyTurnstile", () => {
  function verifier(body: unknown, status = 200) {
    const calls: { url: string; body: URLSearchParams }[] = [];
    const impl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: new URLSearchParams(String(init?.body)) });
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
    return { impl, calls };
  }

  it("no token: reject without calling Cloudflare", async () => {
    const v = verifier({ success: true });
    expect(await verifyTurnstile(undefined, v.impl)).toEqual({
      outcome: "reject",
      codes: ["missing-input-response"],
    });
    expect(v.calls).toHaveLength(0);
  });

  it("success: pass; failure: reject with Cloudflare's codes", async () => {
    expect(
      (await verifyTurnstile("t", verifier({ success: true }).impl)).outcome,
    ).toBe("pass");
    expect(
      await verifyTurnstile(
        "t",
        verifier({ success: false, "error-codes": ["timeout-or-duplicate"] })
          .impl,
      ),
    ).toEqual({ outcome: "reject", codes: ["timeout-or-duplicate"] });
  });

  it("HTTP error, network error or an unparseable body is unavailable — never a pass", async () => {
    expect((await verifyTurnstile("t", verifier({}, 500).impl)).outcome).toBe(
      "unavailable",
    );
    expect(
      (await verifyTurnstile("t", verifier({ nope: 1 }).impl)).outcome,
    ).toBe("unavailable");
    const throwing = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect((await verifyTurnstile("t", throwing)).outcome).toBe("unavailable");
  });

  it("posts to siteverify with the configured secret, or (outside production only) Cloudflare's published test secret when unset", async () => {
    const a = verifier({ success: true });
    await verifyTurnstile("tok", a.impl, {
      TURNSTILE_SECRET_KEY: "configured-secret",
      NODE_ENV: "test",
    });
    expect(a.calls[0]?.url).toBe(TURNSTILE_SITEVERIFY_URL);
    expect(a.calls[0]?.body.get("secret")).toBe("configured-secret");
    expect(a.calls[0]?.body.get("response")).toBe("tok");
    expect(a.calls[0]?.body.has("remoteip")).toBe(false);

    // Outside production (a preview deployment, local dev, tests) the test secret stays available.
    for (const env of [
      { NODE_ENV: "test" },
      { NODE_ENV: "development" },
      { VERCEL_ENV: "preview", NODE_ENV: "production" },
    ]) {
      const b = verifier({ success: true });
      await verifyTurnstile("tok", b.impl, env);
      expect(b.calls[0]?.body.get("secret"), JSON.stringify(env)).toBe(
        TURNSTILE_TEST_SECRET_ALWAYS_PASSES,
      );
    }
  });

  /**
   * INV-10A-09 (Doc 10A draft, SEO launch hardening 2026-10-06): the always-pass test secret must
   * never verify a production submit. With no secret on the production deployment, every call is
   * unavailable (the route answers 503) before Cloudflare is asked anything, token or not, and an
   * error names the variable without any value.
   */
  it("production with no secret fails closed: unavailable, no siteverify call, an error naming the variable", async () => {
    const errors = vi.spyOn(logger, "error").mockImplementation(() => {});
    try {
      for (const env of [
        { VERCEL_ENV: "production" },
        { NODE_ENV: "production" },
        { VERCEL_ENV: "production", TURNSTILE_SECRET_KEY: "" },
      ]) {
        const v = verifier({ success: true });
        for (const token of ["tok", undefined]) {
          expect(
            await verifyTurnstile(token, v.impl, env),
            JSON.stringify(env),
          ).toEqual({
            outcome: "unavailable",
            reason: "secret_not_configured",
          });
        }
        expect(v.calls, JSON.stringify(env)).toHaveLength(0);
      }
      // Presence first: the error was logged, and it names the variable.
      expect(errors).toHaveBeenCalled();
      const logged = JSON.stringify(errors.mock.calls);
      expect(logged).toContain("TURNSTILE_SECRET_KEY");
      expect(logged).not.toContain(TURNSTILE_TEST_SECRET_ALWAYS_PASSES);

      // A configured secret in production verifies as normal.
      const ok = verifier({ success: true });
      expect(
        await verifyTurnstile("tok", ok.impl, {
          VERCEL_ENV: "production",
          TURNSTILE_SECRET_KEY: "real-secret",
        }),
      ).toEqual({ outcome: "pass" });
      expect(ok.calls[0]?.body.get("secret")).toBe("real-secret");
    } finally {
      errors.mockRestore();
    }
  });
});
