/**
 * The exam runtime's paid-feature denial, over HTTP, read back by the one client reader.
 *
 * @spec [Doc-04A_V2.2 §16.1 step 2, §16.2 (403 on no entitlement); Doc-01_V8 §26.1
 *        (`exam_full_length`); SCL-185 (UI-01, owner ruling 2026-09-29)] | @implemented [2026-09-29]
 *
 * plain English: drives the REAL exam router (`authorizeExamCaller` + `sendFailure`) with only
 * the entitlement answer and the SQL-backed service calls stubbed. Pins:
 *   - an unpaid student still gets 403 (status unchanged), and the body now carries
 *     `code: "entitlement_required"` and `details.feature: "exam_full_length"`;
 *   - a paid student gets 200 from the same route;
 *   - the session-ownership 403 keeps `code: "forbidden"`, and the shared reader does NOT
 *     classify it as a denial — the reason the reader keys on `code`, never on status.
 * The bodies handed to the reader are the route's real output, not literals.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readEntitlementDenial } from "../../packages/shared/src/entitlement-denial";
import {
  getEntitlementDenial,
  parseApiErrorFromResponse,
} from "../../client/src/lib/api-error";

const STUDENT = "11111111-1111-4111-8111-111111111111";
const SESSION = "5f0a6b1c-2d3e-4f50-8a9b-0c1d2e3f4a5b";

let entitled = false;
const canAccessFeature = vi.fn(async () => entitled);
const listExamForms = vi.fn();
const readExamSessionState = vi.fn();

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    rpc: () => {
      throw new Error("no database in this contract test");
    },
    from: () => {
      throw new Error("no database in this contract test");
    },
  },
}));

vi.mock("../../server/services/entitlement-service", () => ({
  EntitlementService: { canAccessFeature },
}));

vi.mock(
  "../../server/services/exam-runtime-service",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../server/services/exam-runtime-service")
      >();
    return { ...actual, listExamForms, readExamSessionState };
  },
);

const { default: examRuntimeRouter } =
  await import("../../server/routes/exam-runtime-routes");

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.requestId = "req-exam";
    req.user = {
      id: STUDENT,
      email: "s@example.test",
      display_name: null,
      role: "student",
      isAdmin: false,
      isGuardian: false,
      actor_id: STUDENT,
      profile_completed_at: "2026-09-01T00:00:00.000Z",
      is_under_13: false,
      guardian_consent: false,
    } as Express.Request["user"];
    next();
  });
  app.use("/api/tests", examRuntimeRouter);
  return app;
}

/** The client's path: a real fetch Response -> HttpApiError -> the one reader. */
async function clientRead(status: number, body: unknown) {
  const error = await parseApiErrorFromResponse(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
  return getEntitlementDenial(error);
}

beforeEach(() => {
  vi.clearAllMocks();
  entitled = false;
  listExamForms.mockResolvedValue({
    ok: true,
    status: 200,
    value: { forms: [] },
  });
  readExamSessionState.mockResolvedValue({
    ok: false,
    error: { status: 403, code: "forbidden", message: "Not your session." },
  });
});

describe("UI-01 exam — an unpaid student is refused with the denial contract", () => {
  it("GET /api/tests/forms answers 403 entitlement_required with details.feature exam_full_length", async () => {
    const res = await request(buildApp()).get("/api/tests/forms");

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: {
        code: "entitlement_required",
        message: "Full-length exams need an active subscription.",
        details: { feature: "exam_full_length" },
      },
      requestId: "req-exam",
    });
    expect(canAccessFeature).toHaveBeenCalledWith(STUDENT, "exam_full_length");
    expect(listExamForms).not.toHaveBeenCalled();

    // The real body, through the shared reader and the client's reader.
    expect(readEntitlementDenial(res.body)).toEqual({
      feature: "exam_full_length",
      message: "Full-length exams need an active subscription.",
    });
    expect(await clientRead(res.status, res.body)).toEqual({
      feature: "exam_full_length",
      message: "Full-length exams need an active subscription.",
    });
  });
});

describe("UI-01 exam — a paid student is served", () => {
  it("GET /api/tests/forms answers 200", async () => {
    entitled = true;

    const res = await request(buildApp()).get("/api/tests/forms");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ forms: [] });
    expect(readEntitlementDenial(res.body)).toBeNull();
  });
});

describe("UI-01 exam — a non-entitlement 403 is not a denial", () => {
  it("the session-ownership 403 keeps code forbidden and the reader returns null", async () => {
    entitled = true;

    const res = await request(buildApp()).get(
      `/api/tests/sessions/${SESSION}/state`,
    );

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("forbidden");
    expect(readEntitlementDenial(res.body)).toBeNull();
    expect(await clientRead(res.status, res.body)).toBeNull();
  });
});
