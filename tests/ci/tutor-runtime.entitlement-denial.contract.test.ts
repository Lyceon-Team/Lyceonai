/**
 * The tutor's paid-feature denial, over HTTP, read back by the one client reader.
 *
 * @spec [Doc-03B_V2 §5.9 + CR-03B-21 (403 `entitlement_required`), §17 (per-request
 *        entitlement re-check); Doc-01_V8 §26.1 (`tutor_access`); SCL-185 (UI-01, owner
 *        ruling 2026-09-29)] | @implemented [2026-09-29]
 *
 * plain English: drives the REAL `server/routes/tutor-runtime.ts` router (supertest) over the
 * in-memory tutor DB, with only the entitlement predicate stubbed. Pins that an unpaid student
 * still gets 403 `entitlement_required` (status and code unchanged, and the predicate is still
 * `isEntitlementActiveForProfile` — UI-01 does not move the tutor to `canAccessFeature`), and
 * that the body now names `details.feature: "tutor_access"`. A paid student gets 200 from the
 * same route. The body handed to the readers is the route's real output.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeTutorDb } from "../helpers/fake-tutor-db";
import { readEntitlementDenial } from "../../packages/shared/src/entitlement-denial";
import {
  getEntitlementDenial,
  parseApiErrorFromResponse,
} from "../../client/src/lib/api-error";

const db = { current: new FakeTutorDb() };
let entitled = false;
const isEntitlementActiveForProfile = vi.fn(async () => entitled);

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  get supabaseServer() {
    return db.current.client();
  },
}));

vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../server/services/entitlement-service", () => ({
  EntitlementService: { isEntitlementActiveForProfile },
}));

vi.mock("../../server/lib/tutor-orchestrator-client", () => ({
  orchestrateTurn: vi.fn(),
}));

vi.mock("../../server/services/tutor-context", () => ({
  resolveFullEnvelope: vi.fn(),
}));

vi.mock("../../server/services/tutor-memory", () => ({
  getRecentMessages: vi.fn(async () => []),
}));

vi.mock("../../server/services/tutor-crisis", () => ({
  runCrisisClassifier: vi.fn(),
  getCrisisResponse: vi.fn(() => "crisis resources"),
  flagConversationForReview: vi.fn(),
  notifyCrisisEvent: vi.fn(),
  evaluateNotificationPolicy: vi.fn(() => ({
    shouldNotify: false,
    suppressionReason: null,
  })),
}));

vi.mock("../../server/services/tutor-policy-logger", () => ({
  logContextResolution: vi.fn(async () => undefined),
  logTurnMetrics: vi.fn(async () => undefined),
}));

vi.mock("../../server/services/tutor-runtime-writer", () => ({
  persistInstructionAssignment: vi.fn(),
}));

vi.mock("../../server/services/cloud-tasks-enqueue", () => ({
  enqueueCloudTask: vi.fn(async () => undefined),
}));

const { default: tutorRuntimeRouter } =
  await import("../../server/routes/tutor-runtime");

const STUDENT_ID = "11111111-1111-4111-8111-111111111111";

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      id: STUDENT_ID,
      email: "s@example.test",
      display_name: null,
      role: "student",
      isAdmin: false,
      isGuardian: false,
      actor_id: STUDENT_ID,
    } as Express.Request["user"];
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
    updated_at: "2026-09-23T10:00:00.000Z",
    closed_at: null,
    title: "New session",
    crisis_paused_at: null,
    ended_at: null,
  });
  return row.id as string;
}

beforeEach(() => {
  db.current = new FakeTutorDb();
  entitled = false;
  isEntitlementActiveForProfile.mockClear();
});

describe("UI-01 tutor — an unpaid student is refused with the denial contract", () => {
  it("GET /api/tutor/conversations/:id answers 403 entitlement_required with details.feature tutor_access", async () => {
    const id = seedConversation();

    const res = await request(makeApp()).get(`/api/tutor/conversations/${id}`);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: {
        message: "An active entitlement is required to use the tutor.",
        code: "entitlement_required",
        details: { feature: "tutor_access" },
      },
    });
    // UI-01 keeps the tutor's own predicate (owner ruling 2026-09-29).
    expect(isEntitlementActiveForProfile).toHaveBeenCalledWith(STUDENT_ID);

    expect(readEntitlementDenial(res.body)).toEqual({
      feature: "tutor_access",
      message: "An active entitlement is required to use the tutor.",
    });
    const clientError = await parseApiErrorFromResponse(
      new Response(JSON.stringify(res.body), {
        status: res.status,
        headers: { "content-type": "application/json" },
      }),
    );
    expect(getEntitlementDenial(clientError)).toEqual({
      feature: "tutor_access",
      message: "An active entitlement is required to use the tutor.",
    });
  });
});

describe("UI-01 tutor — a paid student is served", () => {
  it("GET /api/tutor/conversations/:id answers 200", async () => {
    entitled = true;
    const id = seedConversation();

    const res = await request(makeApp()).get(`/api/tutor/conversations/${id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.conversation.conversation_id).toBe(id);
    expect(readEntitlementDenial(res.body)).toBeNull();
  });
});
