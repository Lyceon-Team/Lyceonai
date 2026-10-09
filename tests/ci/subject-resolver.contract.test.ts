/**
 * @spec [Doc 05B §10.3 path-layer authorization (404-not-403) + RB-05B-V1-05; Doc 01 V8
 *   §35/§38.1; owner rulings 2026-08-26 R3/R5/R6 and 2026-08-27 OQ1/OQ5]
 * | @implemented [2026-08-27]
 *
 * plain English: the resolver is the chokepoint, so these cases are the contract for every
 * subject-scoped route that will ever exist. The DERIVATION is proved separately, against real
 * `guardian_links` rows, by scripts/ci/guardian-view-decision-gate.sql — this file proves what
 * the HTTP layer does with each decision the database returns.
 *
 * WHY THE RPC IS MOCKED HERE AND NOT THE LINK TABLE. Mocking the link layer is exactly how
 * unrunnable guardian code passed for ten weeks: every existing guardian test stubbed away the
 * `guardian_links` access, so nothing ever noticed that the columns it named do not exist. The
 * split is deliberate — the SQL gate owns "what does the gate decide", this file owns "what
 * status does each decision produce", and neither can pass vacuously for the other's reason.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const auditInsert = vi.fn();

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (table: string) => ({
      insert: (row: unknown) => auditInsert(table, row),
    }),
  },
}));

vi.mock("../../server/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const STUDENT = "11111111-1111-4111-8111-111111111111";
const GUARDIAN = "22222222-2222-4222-8222-222222222222";
const STRANGER = "33333333-3333-4333-8333-333333333333";

type Req = express.Request & {
  user?: { id: string; role: string };
  requestId?: string;
};

async function callAs(
  principalId: string,
  studentId: string,
  role = "guardian",
): Promise<{ status: number; body: Record<string, unknown>; subject: unknown }> {
  const { resolveSubject } = await import(
    "../../server/middleware/subject-resolver"
  );
  const app = express();
  app.use((req, _res, next) => {
    const r = req as Req;
    r.user = { id: principalId, role };
    r.requestId = "req-subject";
    next();
  });
  let seen: unknown = undefined;
  app.get(
    "/api/students/:studentId/probe",
    resolveSubject,
    (req: express.Request, res: express.Response) => {
      seen = req.subject;
      res.json({ ok: true, subject: req.subject });
    },
  );
  const res = await request(app).get(`/api/students/${studentId}/probe`);
  return { status: res.status, body: res.body, subject: seen };
}

describe("subject resolver — principal to subject, one chokepoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auditInsert.mockResolvedValue({ error: null });
  });

  it("SELF — the student reads their own data with no link lookup and NO audit row", async () => {
    const out = await callAs(STUDENT, STUDENT, "student");
    expect(out.status).toBe(200);
    expect(out.subject).toEqual({ studentId: STUDENT, via: "self" });
    // The derivation is never consulted for self: there is nothing to derive.
    expect(rpc).not.toHaveBeenCalled();
    // MUTATION: audit self-reads too -> this reds. Recording every student reading their
    // own dashboard buries the guardian accesses that matter (owner ruling OQ5).
    expect(auditInsert).not.toHaveBeenCalled();
  });

  it("GUARDIAN ALLOW — 200, via='guardian', and the access IS recorded", async () => {
    rpc.mockResolvedValue({ data: "allow", error: null });
    const out = await callAs(GUARDIAN, STUDENT);
    expect(out.status).toBe(200);
    expect(out.subject).toEqual({ studentId: STUDENT, via: "guardian" });
    expect(rpc).toHaveBeenCalledWith("guardian_view_decision", {
      p_guardian_id: GUARDIAN,
      p_student_id: STUDENT,
    });
    expect(auditInsert).toHaveBeenCalledTimes(1);
    const [table, row] = auditInsert.mock.calls[0]!;
    expect(table).toBe("audit_logs");
    expect(row).toMatchObject({
      actor_profile_id: GUARDIAN,
      target_profile_id: STUDENT,
      action: "guardian_subject_access",
    });
  });

  it("NOT LINKED — 404, never 403 (Doc 05B §10.3: a 403 confirms the student exists)", async () => {
    rpc.mockResolvedValue({ data: "not_linked", error: null });
    const out = await callAs(STRANGER, STUDENT);
    // MUTATION: return 403 here -> this reds. That was the live behaviour
    // (`NO_LINKED_STUDENT`), and it is an enumeration oracle.
    expect(out.status).toBe(404);
    expect(out.subject).toBeUndefined();
  });

  it("UNENTITLED — 402, the ruled deviation from 404-globally", async () => {
    rpc.mockResolvedValue({ data: "student_unentitled", error: null });
    const out = await callAs(GUARDIAN, STUDENT);
    // MUTATION: fold this into 404 -> this reds. Reaching it requires already being linked,
    // so it discloses nothing; collapsing it silently deletes the paywall path
    // (owner ruling 2026-08-27, OQ1).
    expect(out.status).toBe(402);
    expect(out.body.code).toBe("PAYMENT_REQUIRED");
  });

  it("a DENIED access is audited too — a refused read is what a log exists to reconstruct", async () => {
    rpc.mockResolvedValue({ data: "not_linked", error: null });
    await callAs(STRANGER, STUDENT);
    expect(auditInsert).toHaveBeenCalledTimes(1);
    expect(auditInsert.mock.calls[0]![1]).toMatchObject({
      context: expect.objectContaining({ decision: "not_linked" }),
    });
  });

  it("NON-ENUMERABLE — an unrelated student and a nonexistent one are byte-identical", async () => {
    rpc.mockResolvedValue({ data: "not_linked", error: null });
    const real = await callAs(STRANGER, STUDENT);
    const fake = await callAs(STRANGER, "44444444-4444-4444-8444-444444444444");
    // MUTATION: give either branch its own message -> this reds, and the enumeration channel
    // that returning 404 was meant to close is open again.
    expect(real.status).toBe(fake.status);
    expect(real.body).toEqual(fake.body);
  });

  it("FAILS CLOSED when the derivation RPC errors", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom", code: "XX000" } });
    const out = await callAs(GUARDIAN, STUDENT);
    expect(out.status).toBe(404);
    expect(out.subject).toBeUndefined();
  });

  it("FAILS CLOSED on a decision value this build does not recognise", async () => {
    // A future CASE arm in the SQL that nobody wired here must deny, not pass through.
    rpc.mockResolvedValue({ data: "some_new_arm", error: null });
    const out = await callAs(GUARDIAN, STUDENT);
    expect(out.status).toBe(404);
  });

  it("AN UNRECORDED ACCESS DOES NOT HAPPEN — audit write failure is a 500, not a served read", async () => {
    rpc.mockResolvedValue({ data: "allow", error: null });
    auditInsert.mockResolvedValue({ error: { message: "audit down", code: "XX000" } });
    const out = await callAs(GUARDIAN, STUDENT);
    // MUTATION: log-and-proceed instead -> this reds. Months later nobody can tell
    // "no guardian read this child's data" from "the write failed". See owner question 1.
    expect(out.status).toBe(500);
    expect(out.subject).toBeUndefined();
  });

  it("400 for a malformed studentId — it can name no row, so it leaks nothing", async () => {
    const out = await callAs(GUARDIAN, "not-a-uuid");
    expect(out.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("401 when unauthenticated", async () => {
    const { resolveSubject } = await import(
      "../../server/middleware/subject-resolver"
    );
    const app = express();
    app.get("/api/students/:studentId/probe", resolveSubject, (_req, res) =>
      res.json({ ok: true }),
    );
    const res = await request(app).get(`/api/students/${STUDENT}/probe`);
    expect(res.status).toBe(401);
  });

  it("THE SUBJECT CARRIES NO ROLE — a handler cannot learn who is calling", async () => {
    rpc.mockResolvedValue({ data: "allow", error: null });
    const out = await callAs(GUARDIAN, STUDENT);
    // `via` exists for the audit record, not for behaviour. Anything role-shaped beyond it
    // would be a handler's licence to branch — which the chokepoint gate also forbids
    // statically (scripts/ci/subject-resolver-chokepoint-gate.mjs, R2).
    expect(Object.keys(out.subject as object).sort()).toEqual(["studentId", "via"]);
  });
});
