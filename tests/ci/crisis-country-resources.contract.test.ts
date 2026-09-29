/**
 * @spec [Doc-03_V3 §4.6 ("selects the appropriate regional resource based on
 *        billing address country"), §12.3, INV-03-08; closure plan W3-3]
 * @implemented 2026-09-25
 *
 * plain English: a student in crisis is given resources that work where they
 * are. The country is the billing country the Stripe grant path records on the
 * profile (`profiles.country_code`); a student whose country is unknown still
 * gets the named no-number response (owner ruling 2026-09-25), and that case
 * is logged at WARN — the one place a student id belongs in a crisis log. The
 * crisis content never does.
 *
 * The route test drives the REAL tutor router over the in-memory DB with the
 * REAL resource tables and resolver; only the classifier's verdict and the
 * review-case write are stubbed.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
vi.mock("../../server/services/entitlement-service", () => ({
  EntitlementService: {
    isEntitlementActiveForProfile: vi.fn(async () => true),
  },
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

const runCrisisClassifier = vi.fn();
vi.mock("../../server/services/tutor-crisis", async () => {
  // The REAL resources — this file is about which ones a student gets.
  const real = await import("../../server/services/crisis-resources");
  return {
    runCrisisClassifier: (...args: unknown[]) => runCrisisClassifier(...args),
    getCrisisResponse: real.getCrisisResponse,
    flagConversationForReview: vi.fn(async () => ({
      caseId: "66666666-6666-4666-8666-666666666666",
      isNewCase: true,
      caseStatus: "open",
      slaDeadline: "2026-09-27T00:00:00.000Z",
    })),
    notifyCrisisEvent: vi.fn(async () => undefined),
    evaluateNotificationPolicy: vi.fn(() => ({
      shouldNotify: false,
      suppressionReason: "test",
    })),
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
import { logger } from "../../server/logger";
import {
  UNKNOWN_COUNTRY_CRISIS_RESPONSE,
  UNKNOWN_COUNTRY_SAFEGUARDING_RESPONSE,
  getCrisisResponse,
  resolveCrisisCountry,
} from "../../server/services/crisis-resources";

const STUDENT_ID = "55555555-5555-4555-8555-555555555555";
const STUDENT_MESSAGE = "zqx-crisis-marker i do not want to be here anymore";

/**
 * One number unique to each country's configured resources, per lane. Taken
 * from the table as shipped; verifying the numbers themselves is the owner's
 * (out of scope for W3-3). What this pins is that each country gets ITS OWN.
 */
const SEVEN: ReadonlyArray<{
  code: string;
  crisis: string;
  safeguarding: string;
}> = [
  { code: "US", crisis: "988", safeguarding: "1-800-422-4453" },
  { code: "CA", crisis: "988", safeguarding: "1-800-668-6868" },
  { code: "GB", crisis: "0800 1111", safeguarding: "0800 1111" },
  { code: "AU", crisis: "1800 55 1800", safeguarding: "1800 55 1800" },
  { code: "NZ", crisis: "0800 376 633", safeguarding: "0800 376 633" },
  { code: "IE", crisis: "1800 66 66 66", safeguarding: "1800 66 66 66" },
  { code: "SG", crisis: "1767", safeguarding: "1800-777-0000" },
];

describe("W3-3 — every one of the seven resolves to its own resources", () => {
  for (const c of SEVEN) {
    it(`${c.code}: resolves to itself, crisis and safeguarding both`, () => {
      const r = resolveCrisisCountry(c.code);
      expect(r).toEqual({ country: c.code, defaulted: false });
      expect(getCrisisResponse(r.country, "crisis")).toContain(c.crisis);
      expect(getCrisisResponse(r.country, "safeguarding")).toContain(
        c.safeguarding,
      );
    });
  }

  it("each of the seven has its own safeguarding response", () => {
    const texts = SEVEN.map((c) => getCrisisResponse(c.code, "safeguarding"));
    expect(new Set(texts).size).toBe(SEVEN.length);
  });

  it("outside the US, no country is handed the US safeguarding line", () => {
    const us = getCrisisResponse("US", "safeguarding");
    for (const c of SEVEN.filter((x) => x.code !== "US")) {
      expect(getCrisisResponse(c.code, "safeguarding")).not.toBe(us);
    }
  });

  it("Doc 03's `UK` and Stripe's ISO `GB` are the same country", () => {
    expect(getCrisisResponse("UK", "crisis")).toBe(
      getCrisisResponse("GB", "crisis"),
    );
    expect(resolveCrisisCountry("uk ").defaulted).toBe(false);
  });

  it("unknown → no country, flagged as defaulted, with the reason", () => {
    expect(resolveCrisisCountry(null)).toEqual({
      country: null,
      defaulted: true,
      reason: "no_country",
    });
    expect(resolveCrisisCountry("")).toMatchObject({
      defaulted: true,
      reason: "no_country",
    });
    expect(resolveCrisisCountry("FR")).toEqual({
      country: null,
      defaulted: true,
      reason: "unsupported_country",
    });
  });

  it("the unknown-country response names NO number, in either lane — only local emergency services and a trusted adult", () => {
    for (const unknown of [null, "FR", "XX"]) {
      const crisis = getCrisisResponse(unknown, "crisis");
      const safeguarding = getCrisisResponse(unknown, "safeguarding");
      expect(crisis).toBe(UNKNOWN_COUNTRY_CRISIS_RESPONSE);
      expect(safeguarding).toBe(UNKNOWN_COUNTRY_SAFEGUARDING_RESPONSE);
      for (const text of [crisis, safeguarding]) {
        expect(text).not.toMatch(/\d/);
        expect(text).toContain("local emergency number");
        expect(text).toContain("trusted adult");
      }
    }
    // Lane shapes hold for the fallback too.
    expect(UNKNOWN_COUNTRY_CRISIS_RESPONSE).not.toContain(
      "What you've shared matters",
    );
    expect(UNKNOWN_COUNTRY_SAFEGUARDING_RESPONSE).not.toContain(
      "Real people, anytime",
    );
  });
});

// ── The route: a crisis turn from a student with a recorded country ────────

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
  return db.current.seed("tutor_conversations", {
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
    updated_at: "2026-09-25T00:00:00.000Z",
    closed_at: null,
    title: "New session",
    crisis_paused_at: null,
    ended_at: null,
  }).id as string;
}

async function crisisTurn(
  category: "crisis" | "safeguarding",
): Promise<string> {
  runCrisisClassifier.mockResolvedValue({
    crisis: true,
    source: "layer1_signature",
    category,
    signatureId: null,
    modelConfidence: null,
    forceReview: true,
  });
  const res = await request(makeApp()).post("/api/tutor/messages").send({
    conversation_id: seedConversation(),
    message: STUDENT_MESSAGE,
    client_turn_id: crypto.randomUUID(),
  });
  expect(res.status).toBe(200);
  return res.body.data.response.content as string;
}

function allLogText(): string {
  return JSON.stringify([
    ...vi.mocked(logger.info).mock.calls,
    ...vi.mocked(logger.warn).mock.calls,
    ...vi.mocked(logger.error).mock.calls,
    ...vi.mocked(logger.debug).mock.calls,
  ]);
}

function defaultedWarnings(): unknown[][] {
  return vi
    .mocked(logger.warn)
    .mock.calls.filter((c) => c[1] === "crisis_country_defaulted");
}

beforeEach(() => {
  db.current = new FakeTutorDb();
  runCrisisClassifier.mockReset();
  vi.mocked(logger.info).mockClear();
  vi.mocked(logger.warn).mockClear();
  vi.mocked(logger.error).mockClear();
  vi.mocked(logger.debug).mockClear();
});

describe("W3-3 — a crisis turn uses the student's recorded country", () => {
  for (const category of ["crisis", "safeguarding"] as const) {
    it(`country_code = 'SG' → Singapore ${category} resources, no default warning`, async () => {
      db.current.seed("profiles", { id: STUDENT_ID, country_code: "SG" });
      const content = await crisisTurn(category);

      expect(content).toBe(getCrisisResponse("SG", category));
      expect(content).toContain(
        category === "crisis" ? "1767" : "1800-777-0000",
      );
      expect(content).not.toContain("988");
      expect(defaultedWarnings()).toHaveLength(0);
    });
  }

  it("country_code = null → the no-number response, and a WARN naming the student", async () => {
    db.current.seed("profiles", { id: STUDENT_ID, country_code: null });
    const content = await crisisTurn("crisis");

    expect(content).toBe(UNKNOWN_COUNTRY_CRISIS_RESPONSE);
    expect(content).not.toContain("988");
    const warns = defaultedWarnings();
    expect(warns).toHaveLength(1);
    expect(warns[0][3]).toMatchObject({
      studentId: STUDENT_ID,
      reason: "no_country",
      category: "crisis",
    });
  });

  it("a country outside the seven → the no-number response, WARN says unsupported", async () => {
    db.current.seed("profiles", { id: STUDENT_ID, country_code: "FR" });
    const content = await crisisTurn("safeguarding");
    expect(content).toBe(UNKNOWN_COUNTRY_SAFEGUARDING_RESPONSE);
    expect(content).not.toContain("Childhelp");
    expect(defaultedWarnings()[0][3]).toMatchObject({
      reason: "unsupported_country",
    });
  });

  it("no crisis content in any log line — neither the student's words nor the response", async () => {
    db.current.seed("profiles", { id: STUDENT_ID, country_code: null });
    const content = await crisisTurn("crisis");
    const logs = allLogText();
    expect(logs).not.toContain("zqx-crisis-marker");
    expect(logs).not.toContain(STUDENT_MESSAGE);
    expect(logs).not.toContain(content);
  });
});
