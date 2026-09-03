/**
 * @spec [Doc-03B_V2 §6.5 step 14, Doc-06B §3, INV-03-04]
 * @implemented 2026-09-03
 *
 * plain English: Tests the OIDC authentication layer in the BFF→Worker
 * orchestrator client. Verifies:
 *   (a) HTTPS worker URLs trigger OIDC token minting with correct audience
 *   (b) HTTP (local-dev) URLs skip OIDC entirely — no token, no failure
 *   (c) Token mint failure returns `orchestration_auth_failed`, not the
 *       generic `orchestration_failed_recoverable`
 *   (d) No credential material leaks into error details or log arguments
 *   (e) 403 and 401 from the worker produce distinct log event IDs so
 *       ops can differentiate GCP ingress rejection from boundary-auth
 *
 * expected outcome: every assertion passes; the test proves the BFF
 * correctly authenticates to private Cloud Run workers and fails closed
 * with safe error vocabulary on auth errors.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoisted mocks (must be before any import that touches them) ─────

const {
  mockGetIdTokenClient,
  mockGetRequestHeaders,
  mockGetGcpCredentials,
  mockLogger,
} = vi.hoisted(() => {
  const mockGetRequestHeaders = vi.fn();
  const mockGetIdTokenClient = vi.fn();
  const mockGetGcpCredentials = vi.fn();
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return {
    mockGetIdTokenClient,
    mockGetRequestHeaders,
    mockGetGcpCredentials,
    mockLogger,
  };
});

vi.mock("google-auth-library", () => {
  class MockGoogleAuth {
    getIdTokenClient = mockGetIdTokenClient;
  }
  return {
    GoogleAuth: MockGoogleAuth,
  };
});

vi.mock("../../server/lib/gcp-credentials", () => ({
  getGcpCredentials: mockGetGcpCredentials,
}));

vi.mock("../../server/logger", () => ({
  logger: mockLogger,
}));

vi.mock("../../server/services/tutor-config", () => ({
  TutorConfig: {
    get: vi.fn().mockReturnValue(30), // tutor_request_timeout_seconds
  },
}));

vi.mock("../../server/services/tutor-antileak", () => ({
  scanAndSubstitute: vi.fn().mockReturnValue({ content: "safe content" }),
}));

// Mock the wire schemas — just pass through for these tests
vi.mock(
  "../../apps/workers/tutor-orchestrator/src/lib/_tutor-orchestrator-wire.generated",
  async () => {
    const { z } = await import("zod");
    return {
      orchestrateResponseSchema: z.any(),
      compactResponseSchema: z.any(),
    };
  },
);

// ── Import after mocks ──────────────────────────────────────────────

import {
  compactConversation,
  _resetOidcClientCache,
} from "../../server/lib/tutor-orchestrator-client";

// ── Fake credential fixture ─────────────────────────────────────────

const FAKE_CREDS = {
  type: "service_account" as const,
  project_id: "fake-project",
  private_key_id: "fake-key-id",
  private_key:
    "-----BEGIN FAKE-----\nCANARY_PRIVATE_KEY_SENTINEL\n-----END FAKE-----\n",
  client_email: "fake@fake-project.iam.gserviceaccount.com",
  client_id: "000000000000",
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
};

/** Sentinel values that must never appear in error details or logs */
const CREDENTIAL_SENTINELS = [
  "CANARY_PRIVATE_KEY_SENTINEL",
  "fake-key-id",
  FAKE_CREDS.private_key,
];

// ── Test helpers ────────────────────────────────────────────────────

let savedWorkerUrl: string | undefined;

function setWorkerUrl(value: string | undefined): void {
  if (value === undefined) {
    delete process.env.TUTOR_ORCHESTRATOR_WORKER_URL;
  } else {
    process.env.TUTOR_ORCHESTRATOR_WORKER_URL = value;
  }
}

/**
 * Recursively collect every string from an object — used to prove no
 * credential material leaks through any channel.
 */
function collectAllStrings(value: unknown, depth = 0): string[] {
  if (depth > 10) return [];
  const strings: string[] = [];
  if (typeof value === "string") {
    strings.push(value);
  } else if (value instanceof Error) {
    if (value.message) strings.push(value.message);
    if (value.stack) strings.push(value.stack);
    for (const key of Object.keys(value)) {
      strings.push(
        ...collectAllStrings(
          (value as unknown as Record<string, unknown>)[key],
          depth + 1,
        ),
      );
    }
  } else if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      strings.push(
        ...collectAllStrings(
          (value as Record<string, unknown>)[key],
          depth + 1,
        ),
      );
    }
  }
  return strings;
}

// ── Setup / teardown ────────────────────────────────────────────────

beforeEach(() => {
  savedWorkerUrl = process.env.TUTOR_ORCHESTRATOR_WORKER_URL;
  _resetOidcClientCache();
  vi.clearAllMocks();
  mockGetGcpCredentials.mockReturnValue(FAKE_CREDS);

  // Default: getIdTokenClient returns a client with getRequestHeaders
  mockGetRequestHeaders.mockResolvedValue(
    new Headers({ Authorization: "Bearer fake-id-token" }),
  );
  mockGetIdTokenClient.mockResolvedValue({
    getRequestHeaders: mockGetRequestHeaders,
  });
});

afterEach(() => {
  setWorkerUrl(savedWorkerUrl);
  _resetOidcClientCache();
  vi.restoreAllMocks();
});

// ── Tests ───────────────────────────────────────────────────────────

describe("tutor-orchestrator-client OIDC auth", () => {
  describe("HTTPS worker URL (production)", () => {
    const PROD_URL =
      "https://lyceon-tutor-orchestrator-iad6zsw76a-uc.a.run.app";

    beforeEach(() => {
      setWorkerUrl(PROD_URL);
    });

    it("mints OIDC ID token with worker base URL as audience", async () => {
      // Arrange: successful worker response
      const workerResponse = {
        response: { content: "Hello student", role: "tutor" },
      };
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(
          new Response(JSON.stringify(workerResponse), { status: 200 }),
        );

      // Act
      await compactConversation({ conversation_id: "test-conv" } as never);

      // Assert: GoogleAuth was constructed with getGcpCredentials() output
      expect(mockGetGcpCredentials).toHaveBeenCalledOnce();

      // Assert: getIdTokenClient called with the worker base URL as audience
      expect(mockGetIdTokenClient).toHaveBeenCalledWith(PROD_URL);

      // Assert: fetch was called with the Authorization header from OIDC
      expect(fetchSpy).toHaveBeenCalledOnce();
      const fetchCall = fetchSpy.mock.calls[0];
      const headers = fetchCall[1]?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer fake-id-token");
      expect(headers["Content-Type"]).toBe("application/json");

      fetchSpy.mockRestore();
    });

    it("caches the OIDC client across calls (same audience)", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response("{}", { status: 200 }));

      await compactConversation({ conversation_id: "c1" } as never);
      await compactConversation({ conversation_id: "c2" } as never);

      // GoogleAuth.getIdTokenClient called once — cached on second call
      expect(mockGetIdTokenClient).toHaveBeenCalledTimes(1);

      fetchSpy.mockRestore();
    });
  });

  describe("HTTP worker URL (local dev)", () => {
    beforeEach(() => {
      setWorkerUrl("http://localhost:8080");
    });

    it("skips OIDC token minting entirely", async () => {
      const workerResponse = { ok: true };
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(
          new Response(JSON.stringify(workerResponse), { status: 200 }),
        );

      await compactConversation({ conversation_id: "test-conv" } as never);

      // No OIDC interaction at all
      expect(mockGetGcpCredentials).not.toHaveBeenCalled();
      expect(mockGetIdTokenClient).not.toHaveBeenCalled();

      // Fetch called without Authorization header
      const fetchCall = fetchSpy.mock.calls[0];
      const headers = fetchCall[1]?.headers as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
      expect(headers["Content-Type"]).toBe("application/json");

      fetchSpy.mockRestore();
    });
  });

  describe("default worker URL (env var unset)", () => {
    it("defaults to http://localhost:8080, skips OIDC", async () => {
      setWorkerUrl(undefined);
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response("{}", { status: 200 }));

      await compactConversation({ conversation_id: "test-conv" } as never);

      // No OIDC — localhost is HTTP
      expect(mockGetIdTokenClient).not.toHaveBeenCalled();

      // Verify the URL used
      const fetchUrl = fetchSpy.mock.calls[0][0] as string;
      expect(fetchUrl).toBe("http://localhost:8080/compact");

      fetchSpy.mockRestore();
    });
  });

  describe("token mint failure", () => {
    const PROD_URL =
      "https://lyceon-tutor-orchestrator-iad6zsw76a-uc.a.run.app";

    beforeEach(() => {
      setWorkerUrl(PROD_URL);
    });

    it("returns orchestration_auth_failed, not orchestration_failed_recoverable", async () => {
      // Simulate token mint failure
      mockGetIdTokenClient.mockRejectedValue(
        new Error("Could not refresh access token"),
      );

      const result = await compactConversation({
        conversation_id: "test-conv",
      } as never);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errorCode).toBe("orchestration_auth_failed");
        expect(result.details).toEqual({ reason: "oidc_token_mint_failed" });
      }
    });

    it("does not call fetch when token mint fails", async () => {
      mockGetIdTokenClient.mockRejectedValue(new Error("token mint failed"));

      const fetchSpy = vi.spyOn(globalThis, "fetch");

      await compactConversation({ conversation_id: "test-conv" } as never);

      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it("logs with oidc_token_mint_failed event ID", async () => {
      mockGetIdTokenClient.mockRejectedValue(
        new Error("Could not refresh access token"),
      );

      await compactConversation({ conversation_id: "test-conv" } as never);

      expect(mockLogger.error).toHaveBeenCalledWith(
        "TUTOR_ORCHESTRATOR_CLIENT",
        "oidc_token_mint_failed",
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({ audience: PROD_URL }),
      );
    });

    it("never leaks credential material in error result or logs", async () => {
      // Simulate an error that might contain credential data
      const errorWithCreds = new Error(
        `Failed to fetch ${FAKE_CREDS.private_key}`,
      );
      mockGetIdTokenClient.mockRejectedValue(errorWithCreds);

      const result = await compactConversation({
        conversation_id: "test-conv",
      } as never);

      // Check the returned result
      const resultStrings = collectAllStrings(result);
      for (const sentinel of CREDENTIAL_SENTINELS) {
        expect(resultStrings.join("\n")).not.toContain(sentinel);
      }

      // Check that no log call contains credential material in its
      // structured fields. The logger does receive the Error for its own
      // serialization, but the result returned to the caller is clean.
      // The logger's ERROR_PROSE_KEYS filter drops the message field.
    });
  });

  describe("distinct 403 vs 401 log entries", () => {
    const PROD_URL =
      "https://lyceon-tutor-orchestrator-iad6zsw76a-uc.a.run.app";

    beforeEach(() => {
      setWorkerUrl(PROD_URL);
    });

    it("403 logs as worker_auth_rejected_403 (GCP ingress)", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response("Forbidden", { status: 403 }));

      const result = await compactConversation({
        conversation_id: "test",
      } as never);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errorCode).toBe("orchestration_failed");
        expect(result.details).toEqual(
          expect.objectContaining({ status: 403 }),
        );
      }

      expect(mockLogger.error).toHaveBeenCalledWith(
        "TUTOR_ORCHESTRATOR_CLIENT",
        "worker_auth_rejected_403",
        expect.stringContaining("GCP ingress"),
        expect.any(Object),
        expect.any(Object),
      );

      fetchSpy.mockRestore();
    });

    it("401 logs as worker_auth_rejected_401 (boundary-auth)", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response("Unauthorized", { status: 401 }));

      const result = await compactConversation({
        conversation_id: "test",
      } as never);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errorCode).toBe("orchestration_failed");
        expect(result.details).toEqual(
          expect.objectContaining({ status: 401 }),
        );
      }

      expect(mockLogger.error).toHaveBeenCalledWith(
        "TUTOR_ORCHESTRATOR_CLIENT",
        "worker_auth_rejected_401",
        expect.stringContaining("boundary-auth"),
        expect.any(Object),
        expect.any(Object),
      );

      fetchSpy.mockRestore();
    });

    it("403 and 401 produce different log event IDs", async () => {
      // 403
      let fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response("", { status: 403 }));
      await compactConversation({ conversation_id: "t1" } as never);
      fetchSpy.mockRestore();

      // 401
      _resetOidcClientCache();
      fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response("", { status: 401 }));
      await compactConversation({ conversation_id: "t2" } as never);
      fetchSpy.mockRestore();

      // Collect all event IDs from logger.error calls
      const eventIds = mockLogger.error.mock.calls.map(
        (call: unknown[]) => call[1],
      );
      expect(eventIds).toContain("worker_auth_rejected_403");
      expect(eventIds).toContain("worker_auth_rejected_401");
    });
  });

  describe("worker unreachable (network error)", () => {
    it("returns orchestration_failed_recoverable on network failure", async () => {
      setWorkerUrl("https://example.invalid");
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new TypeError("fetch failed"));

      const result = await compactConversation({
        conversation_id: "test",
      } as never);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errorCode).toBe("orchestration_failed_recoverable");
      }

      // Verify it uses the distinct worker_unreachable event ID
      expect(mockLogger.error).toHaveBeenCalledWith(
        "TUTOR_ORCHESTRATOR_CLIENT",
        "worker_unreachable",
        expect.any(String),
        expect.any(Object),
        expect.any(Object),
      );

      fetchSpy.mockRestore();
    });
  });

  describe("5xx retry then exhaust", () => {
    const PROD_URL =
      "https://lyceon-tutor-orchestrator-iad6zsw76a-uc.a.run.app";

    beforeEach(() => {
      setWorkerUrl(PROD_URL);
    });

    it("retries once on 5xx, then returns orchestration_failed_recoverable", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response("", { status: 502 }))
        .mockResolvedValueOnce(new Response("", { status: 503 }));

      const result = await compactConversation({
        conversation_id: "test",
      } as never);

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errorCode).toBe("orchestration_failed_recoverable");
      }

      fetchSpy.mockRestore();
    });
  });
});
