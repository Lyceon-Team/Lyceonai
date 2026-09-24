/**
 * @spec [closure plan W3-1; owner ruling 2026-09-24 (fail open)] | @implemented 2026-09-24
 *
 * plain English: pins Model Armor enforcement in the BFF.
 *
 *   scanner (tutor-model-armor.ts), real module, fetch stubbed:
 *     - input and output scans each block on a match, naming the filters
 *     - clean → INFO, blocked → WARN, skipped → ERROR (one line per scan)
 *     - unreachable / HTTP error / timeout / unconfigured → skipped, never throws
 *     - the endpoint is the us-central1 regional constant, whatever
 *       VERTEX_LOCATION says
 *     - no message text in any log payload
 *
 *   route (the REAL tutor router over tests/helpers/fake-tutor-db.ts):
 *     - input blocked → the worker is never called; the student gets the
 *       neutral substitution
 *     - output blocked → the reply is substituted (armorOutputBlocked is real)
 *     - Model Armor unreachable or timing out → the turn COMPLETES with the
 *       model's reply (fail open), and the skip is an ERROR
 *     - a crisis turn makes ZERO Model Armor calls and its response is
 *       unchanged
 *
 * Only fetch, the GCP credential resolver, the worker call and the crisis
 * classifier are replaced; the scanner, serializer and route are real.
 */
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeTutorDb } from "../helpers/fake-tutor-db";

const db = { current: new FakeTutorDb() };

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  get supabaseServer() {
    return db.current.client();
  },
}));
vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../server/lib/gcp-credentials", () => ({
  getGcpCredentials: () => ({ project_id: "replit-cop" }),
  getGcpAccessTokenResult: async () => ({ ok: true, token: "test-token" }),
}));
vi.mock("../../server/services/entitlement-service", () => ({
  EntitlementService: {
    isEntitlementActiveForProfile: vi.fn(async () => true),
  },
}));

const orchestrateTurn = vi.fn();
vi.mock("../../server/lib/tutor-orchestrator-client", () => ({
  orchestrateTurn: (...args: unknown[]) => orchestrateTurn(...args),
}));
vi.mock("../../server/services/tutor-context", () => ({
  resolveFullEnvelope: vi.fn(async () => ({
    recent_messages: [],
    memory_summaries: [],
    student_learning_context: { mastery_snapshot: null },
    resolved_scope: {
      source_session_id: null,
      source_session_item_id: null,
      source_question_row_id: null,
      source_question_canonical_id: null,
    },
  })),
}));
vi.mock("../../server/services/tutor-memory", () => ({
  getRecentMessages: vi.fn(async () => []),
}));

const runCrisisClassifier = vi.fn();
vi.mock("../../server/services/tutor-crisis", () => ({
  runCrisisClassifier: (...args: unknown[]) => runCrisisClassifier(...args),
  getCrisisResponse: vi.fn(() => "crisis resources"),
  flagConversationForReview: vi.fn(async () => ({
    caseId: "66666666-6666-4666-8666-666666666666",
    isNewCase: true,
    caseStatus: "open",
    slaDeadline: "2026-09-26T00:00:00.000Z",
  })),
  notifyCrisisEvent: vi.fn(async () => undefined),
  evaluateNotificationPolicy: vi.fn(() => ({
    shouldNotify: false,
    suppressionReason: "test",
  })),
}));
vi.mock("../../server/services/tutor-policy-logger", () => ({
  logContextResolution: vi.fn(async () => undefined),
  logTurnMetrics: vi.fn(async () => undefined),
}));
vi.mock("../../server/services/tutor-runtime-writer", () => ({
  persistInstructionAssignment: vi.fn(async () => ({
    ok: true,
    assignmentId: "assignment-1",
  })),
}));
vi.mock("../../server/services/cloud-tasks-enqueue", () => ({
  enqueueCloudTask: vi.fn(async () => undefined),
}));

import tutorRuntimeRouter from "../../server/routes/tutor-runtime";
import { logger } from "../../server/logger";
import { TutorConfig } from "../../server/services/tutor-config";
import {
  MODEL_ARMOR_ENDPOINT,
  MODEL_ARMOR_SUBSTITUTION,
  MODEL_ARMOR_TIMEOUT_MS,
  scanWithModelArmor,
} from "../../server/services/tutor-model-armor";
import { serializeTutorOutput } from "../../server/services/tutor-output-serializer";
import {
  flagConversationForReview,
  notifyCrisisEvent,
} from "../../server/services/tutor-crisis";

// ── Fixtures ────────────────────────────────────────────────────────────

const STUDENT_ID = "55555555-5555-4555-8555-555555555555";
// Distinctive strings: if either ever appears in a log payload, it leaked.
const STUDENT_TEXT = "zqx-student-secret-7731 how do I factor this";
const MODEL_TEXT = "zqx-model-secret-4410 Let's factor it together.";

function sanitizeBody(
  match: boolean,
  opts: { invocationResult?: string } = {},
): Record<string, unknown> {
  return {
    sanitizationResult: {
      filterMatchState: match ? "MATCH_FOUND" : "NO_MATCH_FOUND",
      invocationResult: opts.invocationResult ?? "SUCCESS",
      filterResults: {
        rai: {
          raiFilterResult: {
            executionState: "EXECUTION_SUCCESS",
            matchState: match ? "MATCH_FOUND" : "NO_MATCH_FOUND",
            raiFilterTypeResults: {
              dangerous: {
                confidenceLevel: "MEDIUM_AND_ABOVE",
                matchState: match ? "MATCH_FOUND" : "NO_MATCH_FOUND",
              },
              harassment: { matchState: "NO_MATCH_FOUND" },
            },
          },
        },
        pi_and_jailbreak: {
          piAndJailbreakFilterResult: {
            executionState: "EXECUTION_SUCCESS",
            matchState: match ? "MATCH_FOUND" : "NO_MATCH_FOUND",
          },
        },
        malicious_uris: {
          maliciousUriFilterResult: {
            executionState: "EXECUTION_SUCCESS",
            matchState: "NO_MATCH_FOUND",
          },
        },
      },
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Routes each Model Armor call by method; records every URL fetched. */
type Behaviour = Response | Error | "hang";
const fetchMock = vi.fn();
function armor(input: Behaviour, output: Behaviour): void {
  fetchMock.mockImplementation(
    (url: string, init?: { signal?: AbortSignal }) => {
      const b = url.endsWith(":sanitizeUserPrompt") ? input : output;
      if (b === "hang") {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const e = new Error("aborted");
            e.name = "AbortError";
            reject(e);
          });
        });
      }
      if (b instanceof Error) return Promise.reject(b);
      return Promise.resolve(b.clone());
    },
  );
}
function armorUrls(): string[] {
  return fetchMock.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.startsWith("https://modelarmor."));
}

/** Every argument of every logger call, as one string. */
function allLogText(): string {
  const calls = [
    ...vi.mocked(logger.info).mock.calls,
    ...vi.mocked(logger.warn).mock.calls,
    ...vi.mocked(logger.error).mock.calls,
    ...vi.mocked(logger.debug).mock.calls,
  ];
  return JSON.stringify(calls);
}

function armorLogs(level: "info" | "warn" | "error"): unknown[][] {
  return vi
    .mocked(logger[level])
    .mock.calls.filter((c) => c[0] === "TUTOR_MODEL_ARMOR");
}

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: { id: string; role: string } }).user = {
      id: STUDENT_ID,
      role: "student",
    };
    next();
  });
  app.use("/api/tutor", tutorRuntimeRouter);
  return app;
}

function seedConversation(): string {
  const row = db.current.seed("tutor_conversations", {
    student_id: STUDENT_ID,
    entry_mode: "general",
    source_surface: "dashboard",
    surface: "standalone",
    source_session_id: null,
    source_session_item_id: null,
    source_question_row_id: null,
    source_question_canonical_id: null,
    status: "active",
    crisis_flagged: false,
    deleted_at: null,
    updated_at: "2026-09-24T00:00:00.000Z",
    closed_at: null,
    title: "already titled",
    crisis_paused_at: null,
    ended_at: null,
  });
  return row.id as string;
}

function workerReply(content: string): unknown {
  return {
    ok: true,
    value: {
      response: {
        content,
        content_kind: "message",
        suggested_action: { type: "none", label: null },
        ui_hints: {
          show_accept_decline: false,
          allow_freeform_reply: true,
          suggested_chip: null,
        },
      },
      question_links: [],
      instruction_exposures: [],
      orchestration_meta: {
        model_name: "gemini-3.5-flash",
        prompt_version: "v1",
        cache_used: false,
        compaction_recommended: false,
      },
      learner_observation: null,
    },
  };
}

let turnCounter = 0;
async function sendTurn(convId: string): Promise<request.Response> {
  turnCounter += 1;
  const suffix = String(turnCounter).padStart(12, "0");
  return request(makeApp())
    .post("/api/tutor/messages")
    .send({
      conversation_id: convId,
      message: STUDENT_TEXT,
      client_turn_id: `bbbbbbbb-bbbb-4bbb-8bbb-${suffix}`,
    });
}

const realGet = TutorConfig.get.bind(TutorConfig);

beforeEach(() => {
  db.current = new FakeTutorDb();
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  // The two template IDs as production's tutor_context_runtime_config holds
  // them (W4-3 cache_loaded, 2026-09-24).
  vi.spyOn(TutorConfig, "get").mockImplementation(((key: string) => {
    if (key === "model_armor_input_template_id") return "lyceon-lisa-input-v1";
    if (key === "model_armor_output_template_id")
      return "lyceon-lisa-output-v1";
    return realGet(key as Parameters<typeof realGet>[0]);
  }) as typeof TutorConfig.get);
  process.env.VERTEX_LOCATION = "global";
  runCrisisClassifier.mockResolvedValue({ crisis: false, forceReview: false });
  orchestrateTurn.mockResolvedValue(workerReply(MODEL_TEXT));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── Scanner ──────────────────────────────────────────────────────────────

describe("scanWithModelArmor", () => {
  it("input scan: a match blocks, names the filters and the template, WARN", async () => {
    armor(jsonResponse(sanitizeBody(true)), jsonResponse(sanitizeBody(false)));
    const v = await scanWithModelArmor("input", STUDENT_TEXT, "conv-1");
    expect(v).toMatchObject({
      kind: "blocked",
      templateId: "lyceon-lisa-input-v1",
      matchedFilters: ["rai:dangerous", "pi_and_jailbreak"],
    });
    expect(armorLogs("warn")).toEqual([
      [
        "TUTOR_MODEL_ARMOR",
        "model_armor_scan_blocked",
        expect.any(String),
        expect.objectContaining({
          scan_point: "input",
          verdict: "blocked",
          matched_filters: ["rai:dangerous", "pi_and_jailbreak"],
          template_id: "lyceon-lisa-input-v1",
        }),
      ],
    ]);
    // The request carried the text as a user prompt.
    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(init.body)).toEqual({
      userPromptData: { text: STUDENT_TEXT },
    });
  });

  it("output scan: a match blocks against the output template", async () => {
    armor(jsonResponse(sanitizeBody(false)), jsonResponse(sanitizeBody(true)));
    const v = await scanWithModelArmor("output", MODEL_TEXT, "conv-1");
    expect(v).toMatchObject({
      kind: "blocked",
      templateId: "lyceon-lisa-output-v1",
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(url).toMatch(/lyceon-lisa-output-v1:sanitizeModelResponse$/);
    expect(JSON.parse(init.body)).toEqual({
      modelResponseData: { text: MODEL_TEXT },
    });
  });

  it("clean → INFO with scan point and verdict, nothing at WARN/ERROR", async () => {
    armor(jsonResponse(sanitizeBody(false)), jsonResponse(sanitizeBody(false)));
    const v = await scanWithModelArmor("input", STUDENT_TEXT, "conv-1");
    expect(v.kind).toBe("clean");
    expect(armorLogs("info")).toEqual([
      [
        "TUTOR_MODEL_ARMOR",
        "model_armor_scan_clean",
        expect.any(String),
        expect.objectContaining({ scan_point: "input", verdict: "clean" }),
      ],
    ]);
    expect(armorLogs("warn")).toHaveLength(0);
    expect(armorLogs("error")).toHaveLength(0);
  });

  it("the endpoint is the us-central1 regional constant, not VERTEX_LOCATION", async () => {
    process.env.VERTEX_LOCATION = "global";
    armor(jsonResponse(sanitizeBody(false)), jsonResponse(sanitizeBody(false)));
    await scanWithModelArmor("input", STUDENT_TEXT, "conv-1");
    await scanWithModelArmor("output", MODEL_TEXT, "conv-1");
    expect(MODEL_ARMOR_ENDPOINT).toBe(
      "https://modelarmor.us-central1.rep.googleapis.com",
    );
    expect(armorUrls()).toEqual([
      "https://modelarmor.us-central1.rep.googleapis.com/v1/projects/replit-cop/locations/us-central1/templates/lyceon-lisa-input-v1:sanitizeUserPrompt",
      "https://modelarmor.us-central1.rep.googleapis.com/v1/projects/replit-cop/locations/us-central1/templates/lyceon-lisa-output-v1:sanitizeModelResponse",
    ]);
    expect(armorUrls().join(" ")).not.toContain("global");
  });

  it.each([
    ["unreachable", new TypeError("fetch failed"), "unreachable"],
    ["HTTP 503", jsonResponse({ error: {} }, 503), "http_error"],
    ["HTTP 403 (missing modelarmor.user)", jsonResponse({}, 403), "http_error"],
    [
      "a body that is not a SanitizationResult",
      jsonResponse({ x: 1 }),
      "invalid_response",
    ],
    [
      "a PARTIAL invocation with no match",
      jsonResponse(sanitizeBody(false, { invocationResult: "PARTIAL" })),
      "invocation_incomplete",
    ],
  ] as const)(
    "%s → skipped at ERROR with the reason, never throws",
    async (_label, behaviour, reason) => {
      armor(behaviour, behaviour);
      const v = await scanWithModelArmor("input", STUDENT_TEXT, "conv-1");
      expect(v).toMatchObject({ kind: "skipped", reason });
      expect(armorLogs("error")).toEqual([
        [
          "TUTOR_MODEL_ARMOR",
          "model_armor_scan_skipped",
          expect.any(String),
          undefined,
          expect.objectContaining({
            scan_point: "input",
            verdict: "skipped",
            reason,
          }),
        ],
      ]);
    },
  );

  it(`a hung call is cut off at ${MODEL_ARMOR_TIMEOUT_MS} ms → skipped 'timeout' at ERROR`, async () => {
    vi.useFakeTimers();
    armor("hang", "hang");
    const pending = scanWithModelArmor("input", STUDENT_TEXT, "conv-1");
    await vi.advanceTimersByTimeAsync(MODEL_ARMOR_TIMEOUT_MS + 1);
    const v = await pending;
    expect(v).toMatchObject({ kind: "skipped", reason: "timeout" });
    expect(armorLogs("error")[0]?.[4]).toMatchObject({
      reason: "timeout",
      timeout_ms: MODEL_ARMOR_TIMEOUT_MS,
    });
  });

  it("an unconfigured template ID → skipped at ERROR, no network call", async () => {
    vi.mocked(TutorConfig.get).mockImplementation(((key: string) =>
      key.startsWith("model_armor_")
        ? null
        : realGet(
            key as Parameters<typeof realGet>[0],
          )) as typeof TutorConfig.get);
    const v = await scanWithModelArmor("output", MODEL_TEXT, "conv-1");
    expect(v).toMatchObject({
      kind: "skipped",
      reason: "template_unconfigured",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("no log payload contains the scanned text, in any outcome", async () => {
    const outcomes: Array<[Behaviour, Behaviour]> = [
      [jsonResponse(sanitizeBody(false)), jsonResponse(sanitizeBody(false))],
      [jsonResponse(sanitizeBody(true)), jsonResponse(sanitizeBody(true))],
      [new TypeError(`fetch failed for ${STUDENT_TEXT}`), new TypeError("x")],
      [
        jsonResponse({ echoed: STUDENT_TEXT }),
        jsonResponse({ echoed: MODEL_TEXT }),
      ],
      [
        jsonResponse({ error: { message: STUDENT_TEXT } }, 400),
        jsonResponse({}, 500),
      ],
    ];
    for (const [i, o] of outcomes) {
      armor(i, o);
      await scanWithModelArmor("input", STUDENT_TEXT, "conv-1");
      await scanWithModelArmor("output", MODEL_TEXT, "conv-1");
    }
    expect(armorLogs("info").length).toBeGreaterThan(0);
    expect(armorLogs("warn").length).toBeGreaterThan(0);
    expect(armorLogs("error").length).toBeGreaterThan(0);
    const logged = allLogText();
    expect(logged).not.toContain("zqx-student-secret-7731");
    expect(logged).not.toContain("zqx-model-secret-4410");
  });
});

// ── Serializer ───────────────────────────────────────────────────────────

describe("the block copy", () => {
  it("is the owner-approved wording (2026-09-24), with no implied accusation", () => {
    expect(MODEL_ARMOR_SUBSTITUTION).toBe(
      "Let's keep this on your SAT prep. What would you like to work on next?",
    );
    expect(MODEL_ARMOR_SUBSTITUTION).not.toMatch(/can't help|cannot help/i);
  });
});

describe("serializeTutorOutput acts on armorOutputBlocked", () => {
  const base = {
    conversationId: "conv-1",
    studentId: STUDENT_ID,
    isPreSubmit: false,
    correctAnswer: null,
    correctAnswerResolutionFailed: false,
    questionCanonicalId: null,
  };

  it("true → the neutral substitution, blocked, and the flag is set", async () => {
    const out = await serializeTutorOutput(MODEL_TEXT, {
      ...base,
      armorOutputBlocked: true,
    });
    expect(out.content).toBe(MODEL_ARMOR_SUBSTITUTION);
    expect(out.blocked).toBe(true);
    expect(out.scanResults.modelArmorOutputBlocked).toBe(true);
  });

  it("false or absent → the text passes (no other scan class fires)", async () => {
    for (const ctx of [base, { ...base, armorOutputBlocked: false }]) {
      const out = await serializeTutorOutput(MODEL_TEXT, ctx);
      expect(out.content).toBe(MODEL_TEXT);
      expect(out.blocked).toBe(false);
      expect(out.scanResults.modelArmorOutputBlocked).toBe(false);
    }
  });
});

// ── Route ────────────────────────────────────────────────────────────────

describe("POST /api/tutor/messages with Model Armor", () => {
  it("clean at both points → the model's reply, one INFO per scan point", async () => {
    armor(jsonResponse(sanitizeBody(false)), jsonResponse(sanitizeBody(false)));
    const res = await sendTurn(seedConversation());
    expect(res.status).toBe(200);
    expect(res.body.data.response.content).toBe(MODEL_TEXT);
    expect(armorUrls()).toHaveLength(2);
    expect(
      armorLogs("info").map((c) => (c[3] as { scan_point: string }).scan_point),
    ).toEqual(["input", "output"]);
    expect(allLogText()).not.toContain("zqx-student-secret-7731");
    expect(allLogText()).not.toContain("zqx-model-secret-4410");
  });

  it("input blocked → the worker is never called; the student gets the substitution", async () => {
    armor(jsonResponse(sanitizeBody(true)), jsonResponse(sanitizeBody(false)));
    const convId = seedConversation();
    const res = await sendTurn(convId);
    expect(res.status).toBe(200);
    expect(orchestrateTurn).not.toHaveBeenCalled();
    expect(res.body.data.response.content).toBe(MODEL_ARMOR_SUBSTITUTION);
    // No output scan of server-authored copy.
    expect(armorUrls()).toHaveLength(1);
    const tutorRow = db.current
      .rows("tutor_messages")
      .find((r) => r.conversation_id === convId && r.role === "tutor");
    expect(tutorRow?.message).toBe(MODEL_ARMOR_SUBSTITUTION);
  });

  it("output blocked → the model's reply is replaced, in the response and in storage", async () => {
    armor(jsonResponse(sanitizeBody(false)), jsonResponse(sanitizeBody(true)));
    const convId = seedConversation();
    const res = await sendTurn(convId);
    expect(res.status).toBe(200);
    expect(orchestrateTurn).toHaveBeenCalledTimes(1);
    expect(res.body.data.response.content).toBe(MODEL_ARMOR_SUBSTITUTION);
    const tutorRow = db.current
      .rows("tutor_messages")
      .find((r) => r.conversation_id === convId && r.role === "tutor");
    expect(tutorRow?.message).toBe(MODEL_ARMOR_SUBSTITUTION);
    expect(JSON.stringify(db.current.rows("tutor_messages"))).not.toContain(
      "zqx-model-secret-4410",
    );
  });

  it("FAIL OPEN: Model Armor unreachable → the turn completes with the model's reply, ERROR at both points", async () => {
    armor(new TypeError("fetch failed"), new TypeError("fetch failed"));
    const res = await sendTurn(seedConversation());
    expect(res.status).toBe(200);
    expect(orchestrateTurn).toHaveBeenCalledTimes(1);
    expect(res.body.data.response.content).toBe(MODEL_TEXT);
    expect(
      armorLogs("error").map((c) => [
        (c[4] as { scan_point: string }).scan_point,
        (c[4] as { reason: string }).reason,
      ]),
    ).toEqual([
      ["input", "unreachable"],
      ["output", "unreachable"],
    ]);
  });

  it("FAIL OPEN: Model Armor hangs → cut off by the timeout, the turn completes, ERROR 'timeout'", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    armor("hang", "hang");
    const pending = sendTurn(seedConversation());
    await vi.advanceTimersByTimeAsync(MODEL_ARMOR_TIMEOUT_MS * 2 + 50);
    const res = await pending;
    expect(res.status).toBe(200);
    expect(res.body.data.response.content).toBe(MODEL_TEXT);
    expect(
      armorLogs("error").map((c) => (c[4] as { reason: string }).reason),
    ).toEqual(["timeout", "timeout"]);
  });

  it("a crisis turn makes ZERO Model Armor calls and its response is unchanged — even if Model Armor would block", async () => {
    // Model Armor configured to block everything: if the crisis path reached
    // it, the crisis resources would be suppressed.
    armor(jsonResponse(sanitizeBody(true)), jsonResponse(sanitizeBody(true)));
    runCrisisClassifier.mockResolvedValue({
      crisis: true,
      source: "layer1_signature",
      category: "crisis",
      signatureId: null,
      modelConfidence: null,
      forceReview: true,
    });
    const res = await sendTurn(seedConversation());
    expect(res.status).toBe(200);
    expect(res.body.data.response.content).toBe("crisis resources");
    expect(res.body.data.response.crisis_category).toBe("crisis");
    expect(armorUrls()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(orchestrateTurn).not.toHaveBeenCalled();
  });
});

// ── W3-5: a `dangerous` input block opens a review case ──────────────────

/** A block that matched ONLY the named RAI type (or only pi_and_jailbreak). */
function blockOn(
  filter: "dangerous" | "harassment" | "pi_and_jailbreak",
): Response {
  const rai = filter !== "pi_and_jailbreak";
  return jsonResponse({
    sanitizationResult: {
      filterMatchState: "MATCH_FOUND",
      invocationResult: "SUCCESS",
      filterResults: {
        rai: {
          raiFilterResult: {
            matchState: rai ? "MATCH_FOUND" : "NO_MATCH_FOUND",
            raiFilterTypeResults: {
              [rai ? filter : "dangerous"]: {
                matchState: rai ? "MATCH_FOUND" : "NO_MATCH_FOUND",
              },
            },
          },
        },
        pi_and_jailbreak: {
          piAndJailbreakFilterResult: {
            matchState: rai ? "NO_MATCH_FOUND" : "MATCH_FOUND",
          },
        },
      },
    },
  });
}

describe("W3-5 — a `dangerous` input block reaches a human", () => {
  it("opens a review case with source model_armor_dangerous and alerts; the student still gets the neutral copy, not crisis resources", async () => {
    armor(blockOn("dangerous"), jsonResponse(sanitizeBody(false)));
    const convId = seedConversation();
    const res = await sendTurn(convId);

    expect(res.status).toBe(200);
    expect(res.body.data.response.content).toBe(MODEL_ARMOR_SUBSTITUTION);
    expect(res.body.data.response.crisis_category).toBeUndefined();
    expect(res.body.data.crisis_paused).toBeFalsy();
    expect(orchestrateTurn).not.toHaveBeenCalled();

    expect(flagConversationForReview).toHaveBeenCalledWith(
      convId,
      STUDENT_ID,
      "model_armor_dangerous",
      null,
      null,
    );
    expect(notifyCrisisEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: "66666666-6666-4666-8666-666666666666",
        conversationId: convId,
        source: "model_armor_dangerous",
      }),
    );
    // Flagged, never paused: the student can keep tutoring.
    const row = db.current
      .rows("tutor_conversations")
      .find((r) => r.id === convId);
    expect(row?.crisis_paused_at).toBeNull();
  });

  it.each(["harassment", "pi_and_jailbreak"] as const)(
    "a block on %s alone opens no case",
    async (filter) => {
      armor(blockOn(filter), jsonResponse(sanitizeBody(false)));
      const res = await sendTurn(seedConversation());
      expect(res.body.data.response.content).toBe(MODEL_ARMOR_SUBSTITUTION);
      expect(flagConversationForReview).not.toHaveBeenCalled();
      expect(notifyCrisisEvent).not.toHaveBeenCalled();
    },
  );

  it("an OUTPUT block on dangerous opens no case (the ruling covers the student's input)", async () => {
    armor(jsonResponse(sanitizeBody(false)), blockOn("dangerous"));
    const res = await sendTurn(seedConversation());
    expect(res.body.data.response.content).toBe(MODEL_ARMOR_SUBSTITUTION);
    expect(flagConversationForReview).not.toHaveBeenCalled();
  });

  it("an active case already open → no second alert, a WARN instead", async () => {
    vi.mocked(flagConversationForReview).mockResolvedValueOnce({
      caseId: "77777777-7777-4777-8777-777777777777",
      isNewCase: false,
      caseStatus: "in_review",
      slaDeadline: "2026-09-26T00:00:00.000Z",
    });
    armor(blockOn("dangerous"), jsonResponse(sanitizeBody(false)));
    const res = await sendTurn(seedConversation());
    expect(res.status).toBe(200);
    expect(notifyCrisisEvent).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "TUTOR_RUNTIME",
      "model_armor_crisis_case_exists",
      expect.any(String),
      expect.objectContaining({ caseStatus: "in_review" }),
    );
  });

  it("a failed flag (e.g. migration not applied) → ERROR, and the block copy is still delivered", async () => {
    vi.mocked(flagConversationForReview).mockRejectedValueOnce(
      new Error("crisis flag write failed: check_violation"),
    );
    armor(blockOn("dangerous"), jsonResponse(sanitizeBody(false)));
    const res = await sendTurn(seedConversation());
    expect(res.status).toBe(200);
    expect(res.body.data.response.content).toBe(MODEL_ARMOR_SUBSTITUTION);
    expect(logger.error).toHaveBeenCalledWith(
      "TUTOR_RUNTIME",
      "model_armor_crisis_flag_failed",
      expect.any(String),
      expect.any(Error),
      expect.objectContaining({ conversationId: expect.any(String) }),
    );
    expect(allLogText()).not.toContain("zqx-student-secret-7731");
  });
});
