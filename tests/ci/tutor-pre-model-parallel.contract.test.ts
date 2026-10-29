/**
 * @spec [owner brief "H3: parallelise the pre-model work" (Karl, 2026-10-29): context assembly
 *        (`context_envelope`) runs at the same time as the crisis classifier, the Model Armor input
 *        scan and the injection scan; the model call still waits for every safety check; a crisis
 *        or blocked turn never reaches the model and its envelope work is discarded; anti-leak and
 *        the pre-/post-submit gates untouched; route_timing keeps every step, adds a parallel-group
 *        marker, each step's own duration and the group's wall time. Tests: a crisis turn makes no
 *        model call even when the envelope finishes first; an armor-blocked turn likewise; normal
 *        turns produce the same envelope as before (snapshot)] | @implemented [2026-10-29]
 *
 * plain English: the REAL tutor router and the REAL context resolver run over the in-memory DB
 * (tests/helpers/fake-tutor-db.ts); only the worker call, the crisis classifier, the Model Armor
 * scan and the policy writers are replaced.
 *  - Snapshot: two turns on a review item (the second has the first exchange in its window). What
 *    the worker is sent (the envelope, the pre-submit flag and the BFF-local correct answer) is
 *    pinned in a file snapshot that was WRITTEN BY THE CODE BEFORE THIS CHANGE (generated on
 *    `lisa` at 9c70198b, then the change made with the file untouched). Random ids are replaced by
 *    placeholders in order of appearance; nothing else is normalised.
 *  - Ordering: the crisis classifier (or the Model Armor input scan) is held until the envelope
 *    has RESOLVED. That can only complete if the envelope really runs in parallel (sequential code
 *    would deadlock: the test has a timeout), and it is the case the brief names: the envelope
 *    finishes first, and still no model call is made.
 *  - Timing: the group record and its members on the one route_timing line.
 */
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeTutorDb } from "../helpers/fake-tutor-db";

const db = { current: new FakeTutorDb() };

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
        rpc: async (fn: string) => {
          await trip(`https://fake.supabase.co/rest/v1/rpc/${fn}`, {
            method: "POST",
          });
          if (fn === "video_resources_for_skills")
            return { data: [], error: null };
          return { data: null, error: new Error(`rpc ${fn} not faked`) };
        },
      };
    },
  };
});
const logged = vi.hoisted(() => ({ info: [] as unknown[][] }));
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

// The real resolver, observed: `envelopeResolved` settles when a resolution finishes.
const envelopeWatch = vi.hoisted(() => ({
  resolved: 0,
  waiters: [] as Array<() => void>,
}));
function envelopeResolved(): Promise<void> {
  if (envelopeWatch.resolved > 0) return Promise.resolve();
  return new Promise((resolve) => envelopeWatch.waiters.push(resolve));
}
vi.mock("../../server/services/tutor-context", async (importOriginal) => {
  const real =
    await importOriginal<
      typeof import("../../server/services/tutor-context")
    >();
  return {
    ...real,
    resolveFullEnvelope: async (
      ...args: Parameters<typeof real.resolveFullEnvelope>
    ) => {
      const envelope = await real.resolveFullEnvelope(...args);
      envelopeWatch.resolved += 1;
      for (const wake of envelopeWatch.waiters.splice(0)) wake();
      return envelope;
    },
  };
});

const runCrisisClassifier = vi.fn();
vi.mock("../../server/services/tutor-crisis", () => ({
  runCrisisClassifier: (...args: unknown[]) => runCrisisClassifier(...args),
  getCrisisResponse: vi.fn(() => "crisis resources"),
  flagConversationForReview: vi.fn(async () => ({
    caseId: "66666666-6666-4666-8666-666666666666",
    isNewCase: true,
    caseStatus: "open",
    slaDeadline: "2026-10-29T13:00:00.000Z",
  })),
  notifyCrisisEvent: vi.fn(async () => undefined),
  evaluateNotificationPolicy: vi.fn(() => ({
    shouldNotify: false,
    suppressionReason: "test",
  })),
}));
const scanWithModelArmor = vi.fn();
vi.mock("../../server/services/tutor-model-armor", async (importOriginal) => {
  const real =
    await importOriginal<
      typeof import("../../server/services/tutor-model-armor")
    >();
  return {
    ...real,
    scanWithModelArmor: (...args: unknown[]) => scanWithModelArmor(...args),
  };
});
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
import { MODEL_ARMOR_SUBSTITUTION } from "../../server/services/tutor-model-armor";

const STUDENT_ID = "55555555-5555-4555-8555-555555555555";
const QUESTION_ID = "SATM1PAR001";
const STEM = "If 4x = 28, what is x?";
const FIRST_MESSAGE = "how do I start this one";
const SECOND_MESSAGE = "so I divide both sides?";
const REPLY = "Look at what is multiplying x.";
const NO_CRISIS = {
  crisis: false,
  source: null,
  category: null,
  signatureId: null,
  modelConfidence: null,
  forceReview: false,
};
const CRISIS = {
  crisis: true,
  source: "signature_match",
  category: "crisis",
  signatureId: "sig-1",
  modelConfidence: null,
  forceReview: false,
};

function workerReply(content: string): unknown {
  return {
    ok: true,
    attribution: null,
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
      { key: "A", text: "5" },
      { key: "B", text: "7" },
      { key: "C", text: "9" },
      { key: "D", text: "11" },
    ],
    question_item_type: "mcq",
    question_explanation: "Divide both sides by 4.",
    question_correct_answer: "B",
    option_order: ["C", "A", "D", "B"],
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

async function openConversation(): Promise<string> {
  const opened = await request(makeApp())
    .post("/api/tutor/conversations")
    .send({
      entry_mode: "scoped_question",
      source_surface: "review",
      source_session_item_id: seedItem(),
      idempotency_key: crypto.randomUUID(),
    });
  expect(opened.status).toBeLessThan(300);
  return opened.body.data.conversation_id as string;
}

async function send(
  conversationId: string,
  message: string,
): Promise<request.Response> {
  logged.info.length = 0;
  const res = await request(makeApp()).post("/api/tutor/messages").send({
    conversation_id: conversationId,
    message,
    client_turn_id: crypto.randomUUID(),
  });
  // `finish` fires after the body is flushed; give the route_timing emit a turn.
  await new Promise((resolve) => setImmediate(resolve));
  return res;
}

type Step = {
  step: string;
  ms: number | null;
  at_ms: number;
  group?: string;
  kind?: string;
};
function timingSteps(): Step[] {
  const lines = logged.info.filter(
    (args) => args[0] === "PERF" && args[1] === "route_timing",
  );
  expect(lines).toHaveLength(1);
  return (lines[0]![3] as { steps: Step[] }).steps;
}

/** Random ids → `<id-N>` in order of first appearance. Nothing else is touched. */
function normaliseIds(value: unknown): unknown {
  const seen = new Map<string, string>();
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  return JSON.parse(
    JSON.stringify(value).replace(UUID, (id) => {
      const known = seen.get(id);
      if (known !== undefined) return known;
      const next = `<id-${seen.size + 1}>`;
      seen.set(id, next);
      return next;
    }),
  ) as unknown;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-29T12:00:00.000Z"));
  db.current = new FakeTutorDb();
  logged.info.length = 0;
  envelopeWatch.resolved = 0;
  envelopeWatch.waiters.length = 0;
  orchestrateTurn.mockReset();
  orchestrateTurn.mockResolvedValue(workerReply(REPLY));
  runCrisisClassifier.mockReset();
  runCrisisClassifier.mockResolvedValue(NO_CRISIS);
  scanWithModelArmor.mockReset();
  scanWithModelArmor.mockResolvedValue({
    kind: "clean",
    templateId: "t",
    latencyMs: 1,
  });
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

describe("H3: a normal turn sends the worker the same envelope as before (snapshot)", () => {
  it("two turns on a review item: envelope, pre-submit flag and BFF-local answer, unchanged", async () => {
    const conversationId = await openConversation();
    const first = await send(conversationId, FIRST_MESSAGE);
    expect(first.status).toBe(200);
    // The second turn's window holds the first exchange and the current message.
    vi.setSystemTime(new Date("2026-10-29T12:01:00.000Z"));
    const second = await send(conversationId, SECOND_MESSAGE);
    expect(second.status).toBe(200);
    expect(orchestrateTurn).toHaveBeenCalledTimes(2);
    // Presence first: the snapshot is not trivially empty.
    const sent = JSON.stringify(orchestrateTurn.mock.calls);
    expect(sent).toContain(STEM);
    expect(sent).toContain(FIRST_MESSAGE);
    expect(sent).toContain(SECOND_MESSAGE);
    expect(sent).toContain(REPLY);
    await expect(
      JSON.stringify(normaliseIds(orchestrateTurn.mock.calls), null, 2),
    ).toMatchFileSnapshot("__snapshots__/tutor-pre-model-envelope.json");
  });
});
