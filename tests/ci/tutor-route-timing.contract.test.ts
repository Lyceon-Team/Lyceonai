/**
 * @spec [owner rulings on #1277 (Karl, 2026-10-21), ruling 6: "H1 approved. Add the existing step
 *        timer to the tutor reply path: observability only, fixed literal step names, NEVER log
 *        prompts, responses or student content; no behaviour change. Tests + plant.";
 *        server/lib/step-timer.ts; Coding Standards §12.1 (never log tutor prompts or responses)]
 *       | @implemented [2026-10-21]
 *
 * plain English: the REAL tutor router runs over the in-memory DB (only the worker call, the
 * crisis classifier and the policy writers are replaced, as in tutor-display-letters). One LISA
 * turn must produce exactly ONE `route_timing` line, for route `tutor.message`, listing the reply
 * path's steps by their literal names in the order they ran. Presence first (the line exists, has
 * its steps, and the turn really carried a message, a reply and a question), then absence: the
 * line has only the timing fields, each step only `{step, ms, at_ms}`, and nothing the turn
 * touched — the student's message, LISA's reply, the question's stem or id, the student, the
 * conversation — appears anywhere in it. The reply itself is still served (no behaviour change).
 */
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeTutorDb } from "../helpers/fake-tutor-db";

const db = { current: new FakeTutorDb() };

// H1 (P2 Revised §2, 2026-10-23): the real server client times each round trip through its fetch
// (`timedFetch`, apps/api/src/lib/supabase-server.ts). The in-memory DB has no fetch, so each
// query it serves makes one call through `timedFetch` to a no-op, as the real client would make
// one request: the route's `{ databaseTrips: true }` is what turns those into `db.*` steps.
vi.mock("../../apps/api/src/lib/supabase-server", async () => {
  const { timedFetch } = await import("../../server/lib/step-timer");
  const trip = timedFetch(async () => new Response("[]"));
  return {
    get supabaseServer() {
      const client = db.current.client();
      return {
        from: (table: string) => {
          void trip(`https://fake.supabase.co/rest/v1/${table}`, {
            method: "GET",
          });
          return client.from(table);
        },
      };
    },
  };
});
const logged = vi.hoisted(() => ({
  info: [] as unknown[][],
}));
vi.mock("../../server/logger", () => ({
  logger: {
    info: vi.fn((...args: unknown[]) => {
      logged.info.push(args);
    }),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
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
vi.mock("../../server/services/tutor-crisis", () => ({
  runCrisisClassifier: vi.fn(async () => ({
    crisis: false,
    forceReview: false,
  })),
  getCrisisResponse: vi.fn(),
  flagConversationForReview: vi.fn(),
  notifyCrisisEvent: vi.fn(),
  evaluateNotificationPolicy: vi.fn(),
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

const STUDENT_ID = "55555555-5555-4555-8555-555555555555";
const QUESTION_ID = "SATM1TIM001";
const STEM = "If 3x = 27, what is x?";
const STUDENT_MESSAGE = "my private question about dividing by three";
const REPLY = "Try undoing the multiplication on both sides first.";
const UUID_ANYWHERE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** The reply path's steps, in the order a normal (non-crisis, first-attempt) turn runs them. */
const REPLY_PATH_STEPS = [
  "entitlement",
  "injection_scan",
  "crisis_classifier",
  "pre_submit",
  "correct_answer",
  "recent_messages",
  "context_envelope",
  "armor_input",
  "video_retrieval",
  "model",
  "armor_output",
  "serialize",
  "tutor_message_insert",
];

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
        model_name: "test-model",
        prompt_version: "v1",
        cache_used: false,
        compaction_recommended: false,
      },
      learner_observation: null,
    },
  };
}

function seedItem(): string {
  const session = db.current.seed("review_sessions", {
    student_id: STUDENT_ID,
  });
  const item = db.current.seed("review_session_items", {
    session_id: session.id,
    student_id: STUDENT_ID,
    question_id: QUESTION_ID,
    status: "served",
    ordinal: 1,
    question_stem: STEM,
    question_passage: null,
    question_options: [
      { key: "A", text: "6" },
      { key: "B", text: "9" },
      { key: "C", text: "12" },
      { key: "D", text: "15" },
    ],
    question_item_type: "mcq",
    question_explanation: "Divide both sides by 3.",
    question_correct_answer: "B",
    option_order: ["A", "B", "C", "D"],
    option_token_map: { opt_a: "A", opt_b: "B", opt_c: "C", opt_d: "D" },
    selected_answer: null,
  });
  return item.id as string;
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

type TimingLine = { data: Record<string, unknown> };

/** The `route_timing` lines the logger received, as (component, event, message, data). */
function timingLines(): TimingLine[] {
  return logged.info
    .filter((args) => args[0] === "PERF" && args[1] === "route_timing")
    .map((args) => ({ data: args[3] as Record<string, unknown> }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-21T12:00:00.000Z"));
  db.current = new FakeTutorDb();
  logged.info.length = 0;
  orchestrateTurn.mockReset();
  orchestrateTurn.mockResolvedValue(workerReply(REPLY));
  db.current.seed("questions", {
    id: QUESTION_ID,
    correct_answer: "B",
    section: "M",
    domain: "Algebra",
    skill_codes: [],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

async function oneTurn(): Promise<{
  res: request.Response;
  conversationId: string;
}> {
  const opened = await request(makeApp())
    .post("/api/tutor/conversations")
    .send({
      entry_mode: "scoped_question",
      source_surface: "review",
      source_session_item_id: seedItem(),
      idempotency_key: crypto.randomUUID(),
    });
  expect(opened.status).toBeLessThan(300);
  const conversationId = opened.body.data.conversation_id as string;
  logged.info.length = 0;
  const res = await request(makeApp()).post("/api/tutor/messages").send({
    conversation_id: conversationId,
    message: STUDENT_MESSAGE,
    client_turn_id: crypto.randomUUID(),
  });
  // `finish` fires after the body is flushed; give the emit a turn.
  await new Promise((resolve) => setImmediate(resolve));
  return { res, conversationId };
}

describe("H1: LISA's reply path emits one content-free route_timing line (ruling 6, 2026-10-21)", () => {
  it("one turn: exactly one line for tutor.message, with the reply path's literal steps in order, and the reply still served", async () => {
    const { res } = await oneTurn();
    expect(res.status).toBe(200);
    // No behaviour change: the reply reaches the student as before.
    expect(JSON.stringify(res.body)).toContain(REPLY);
    expect(orchestrateTurn).toHaveBeenCalledTimes(1);

    const lines = timingLines();
    expect(lines).toHaveLength(1);
    const data = lines[0]!.data;
    expect(data.route).toBe("tutor.message");
    expect(data.status).toBe(200);
    const steps = data.steps as Array<{ step: string; ms: number | null }>;
    expect(
      steps.map((s) => s.step).filter((name) => !name.startsWith("db.")),
    ).toEqual(REPLY_PATH_STEPS);
    // H1: the route opted in, so its database round trips are steps too.
    expect(steps.some((s) => s.step === "db.read.tutor_conversations")).toBe(
      true,
    );
    for (const s of steps) expect(typeof s.ms).toBe("number");
  });

  it("the line carries no prompt, reply, question or identity: only timing fields and literal step names", async () => {
    const { res, conversationId } = await oneTurn();
    expect(res.status).toBe(200);
    // Presence: the turn really carried the content the line must not.
    const sentToModel = JSON.stringify(orchestrateTurn.mock.calls[0]);
    expect(sentToModel).toContain(STUDENT_MESSAGE);
    expect(sentToModel).toContain(STEM);

    const [line] = timingLines();
    expect(line).toBeDefined();
    expect(Object.keys(line!.data).sort()).toEqual(
      [
        "pre_handler_ms",
        "pre_steps",
        "route",
        "status",
        "step_count",
        "steps",
        "steps_dropped",
        "total_ms",
      ].sort(),
    );
    const steps = line!.data.steps as Array<Record<string, unknown>>;
    expect(steps.length).toBeGreaterThan(REPLY_PATH_STEPS.length);
    for (const step of steps) {
      expect(Object.keys(step).sort()).toEqual(["at_ms", "ms", "step"]);
      expect(step.step).toMatch(
        /^(?:[a-z_]+|db\.(?:read|insert|update|delete|rpc|auth|other)\.[a-z][a-z0-9_]*)$/,
      );
    }
    const serialised = JSON.stringify(line!.data);
    expect(serialised).not.toMatch(UUID_ANYWHERE);
    for (const value of [
      STUDENT_MESSAGE,
      REPLY,
      STEM,
      QUESTION_ID,
      STUDENT_ID,
      conversationId,
    ]) {
      expect(serialised).not.toContain(value);
    }
  });
});
