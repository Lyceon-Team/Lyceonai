/**
 * @spec [owner brief "P2 Revised: Cut the Wait Without Streaming" (Karl, 2026-10-23) §2 H1 ("every
 *        model call ... No message content in logs")] | @implemented [2026-10-23]
 *
 * plain English: the two model calls of a reply turn, each through its real code with only the
 * Google SDK replaced.
 *  - The crisis classifier: `classifyCrisis` under a timed route records one `crisis_model` step
 *    per attempt — two when the first attempt fails and the retry succeeds — and the student's
 *    text never reaches the line.
 *  - The worker's `/turn` handler returns `orchestration_meta.timing`: the handler's own
 *    duration and one entry per Vertex attempt, numbers only (the reply's text is not in it).
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const logged = vi.hoisted(() => ({ info: [] as unknown[][] }));
vi.mock("../../server/logger", () => ({
  logger: {
    info: vi.fn((...args: unknown[]) => {
      logged.info.push(args);
    }),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));
vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { value: "classifier_class" },
            error: null,
          }),
        }),
      }),
    }),
  },
}));
vi.mock("../../server/lib/gcp-credentials", () => ({
  getGcpCredentials: () => ({
    project_id: "test-project",
    client_email: "x@test-project.iam.gserviceaccount.com",
    private_key: "test",
  }),
}));

const generateContent = vi.hoisted(() => vi.fn());
vi.mock("@google/genai", async () => {
  const actual =
    await vi.importActual<typeof import("@google/genai")>("@google/genai");
  return {
    ...actual,
    GoogleGenAI: class {
      models = { generateContent };
    },
  };
});

import { timedRoute } from "../../server/lib/step-timer";
import { classifyCrisis } from "../../server/services/tutor-crisis";
import { orchestrateRouter } from "../../apps/workers/tutor-orchestrator/src/routes/orchestrate";
import { orchestrateResponseSchema } from "../../shared/tutor-orchestrator-wire";
import { CASE_36 } from "./lisa-golden-set-fixtures";

const STUDENT_TEXT = "i keep getting the slope wrong and it is my secret worry";
const REPLY = "Rise over run: which change goes on top?";

beforeEach(() => {
  logged.info.length = 0;
  generateContent.mockReset();
  process.env.VERTEX_CLASSIFIER_CLASS_MODEL = "test-classifier";
  process.env.VERTEX_PROJECT_ID = "test-project";
  process.env.VERTEX_LOCATION = "global";
});

describe("crisis classifier: one crisis_model step per attempt", () => {
  it("first attempt fails, the retry succeeds → two steps, no text", async () => {
    generateContent
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce({ text: '{"isCrisis":false,"confidence":0.1}' });
    const app = express();
    app.post(
      "/turn",
      timedRoute("tutor.message", async (_req, res) => {
        const result = await classifyCrisis(STUDENT_TEXT);
        res.json({ isCrisis: result.isCrisis });
      }),
    );
    const res = await request(app).post("/turn").send({});
    expect(res.status).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));

    // Presence: the model really received the text, twice.
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(generateContent.mock.calls[0])).toContain(
      STUDENT_TEXT,
    );

    const lines = logged.info.filter(
      (a) => a[0] === "PERF" && a[1] === "route_timing",
    );
    expect(lines).toHaveLength(1);
    const data = lines[0]![3] as {
      steps: Array<{ step: string; ms: number | null }>;
    };
    expect(
      data.steps.filter((s) => s.step === "crisis_model").map((s) => s.step),
    ).toEqual(["crisis_model", "crisis_model"]);
    for (const s of data.steps) expect(typeof s.ms).toBe("number");
    expect(JSON.stringify(data)).not.toContain(STUDENT_TEXT);
  });
});

describe("worker /turn: timings on the wire, numbers only", () => {
  it("the handler's duration and one entry per Vertex attempt", async () => {
    generateContent.mockResolvedValue({
      candidates: [
        { finishReason: "STOP", content: { parts: [{ text: REPLY }] } },
      ],
      text: REPLY,
    });
    const app = express();
    app.use(express.json());
    app.use("/orchestrate", orchestrateRouter);
    const res = await request(app)
      .post("/orchestrate/turn")
      .send(CASE_36.request);
    expect(res.status).toBe(200);

    const body = orchestrateResponseSchema.parse(res.body);
    expect(body.response.content).toBe(REPLY);
    const timing = body.orchestration_meta.timing;
    expect(timing).toBeDefined();
    expect(timing!.vertex_attempts).toHaveLength(1);
    expect(timing!.worker_ms).toBeGreaterThanOrEqual(
      timing!.vertex_attempts[0]!.ms,
    );
    expect(JSON.stringify(timing)).not.toContain(REPLY);
  });
});
