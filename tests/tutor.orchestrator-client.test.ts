import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getIdTokenClientMock, getRequestHeadersMock, fetchMock } = vi.hoisted(() => ({
  getIdTokenClientMock: vi.fn(),
  getRequestHeadersMock: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock("google-auth-library", () => ({
  GoogleAuth: class {
    getIdTokenClient = getIdTokenClientMock;
  },
}));

function validOrchestratorResponse() {
  return {
    response: {
      content: "Tutor response",
      content_kind: "message",
      suggested_action: {
        type: "none",
        label: null,
      },
      ui_hints: {
        show_accept_decline: false,
        allow_freeform_reply: true,
        suggested_chip: null,
      },
    },
    question_links: [],
    instruction_exposures: [],
    orchestration_meta: {
      model_name: "vertex-test",
      cache_used: false,
      compaction_recommended: false,
    },
  };
}

describe("Tutor orchestrator client auth boundary", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.TUTOR_ORCHESTRATOR_URL = "http://127.0.0.1:8080";
    delete process.env.TUTOR_ORCHESTRATOR_AUTH_MODE;
    delete process.env.TUTOR_ORCHESTRATOR_AUDIENCE;
    getRequestHeadersMock.mockResolvedValue({ Authorization: "Bearer service-token" });
    getIdTokenClientMock.mockResolvedValue({
      getRequestHeaders: getRequestHeadersMock,
    });
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => validOrchestratorResponse(),
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses local unauth invocation by default", async () => {
    const { callTutorOrchestrator } = await import("../server/lib/tutor-orchestrator-client.ts");
    await callTutorOrchestrator({ ping: true });

    expect(getIdTokenClientMock).not.toHaveBeenCalled();
    const options = fetchMock.mock.calls[0]?.[1] as Record<string, unknown>;
    const headers = (options?.headers ?? {}) as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Authorization).toBeUndefined();
  });

  it("uses gcp id-token auth when configured", async () => {
    process.env.TUTOR_ORCHESTRATOR_AUTH_MODE = "gcp_id_token";
    process.env.TUTOR_ORCHESTRATOR_AUDIENCE = "https://orchestrator.internal";

    const { callTutorOrchestrator } = await import("../server/lib/tutor-orchestrator-client.ts");
    await callTutorOrchestrator({ ping: true });

    expect(getIdTokenClientMock).toHaveBeenCalledWith("https://orchestrator.internal");
    const options = fetchMock.mock.calls[0]?.[1] as Record<string, unknown>;
    const headers = (options?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer service-token");
  });

  it("fails explicitly when id-token auth header cannot be acquired", async () => {
    process.env.TUTOR_ORCHESTRATOR_AUTH_MODE = "gcp_id_token";
    getRequestHeadersMock.mockResolvedValue({});

    const { callTutorOrchestrator } = await import("../server/lib/tutor-orchestrator-client.ts");
    await expect(callTutorOrchestrator({ ping: true })).rejects.toThrow(
      "Failed to acquire service auth header for tutor orchestrator",
    );
  });
});
