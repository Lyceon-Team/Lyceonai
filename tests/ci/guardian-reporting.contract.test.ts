import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
// The wire codes come from the contract module, not from string literals here: the first draft
// of the Q7 accept case asserted "WRONG_ACCEPTOR" and got a 500, because the real constant is
// "GUARDIAN_LINK_WRONG_ACCEPTOR". A test that spells the contract itself can disagree with it.
import { GUARDIAN_LINK_ERROR } from "../../packages/shared/src/guardian-link-schema";

const accountMocks = {
  revokeGuardianLink: vi.fn(),
  isGuardianLinkedToStudent: vi.fn(),
  getAllGuardianStudentLinks: vi.fn(),
  ensureAccountForUser: vi.fn(),
  // Step 6 (Q7). Both readers answer party-hood, which is what decides 404-versus-409.
  // NOTE for whoever adds the next export to `server/lib/account.ts`: this object REPLACES the
  // module, so a function missing from it is `undefined` at the call site and the route answers
  // 500. That is how the two revoke cases below failed when `getAnyGuardianLinkForPair` landed —
  // loudly, because they assert exact status codes. A case asserting only "not 200" would have
  // gone green on the 500 and hidden the gap.
  getGuardianLinkById: vi.fn(),
  getAnyGuardianLinkForPair: vi.fn(),
};

/** The shape `getAnyGuardianLinkForPair` returns; only the fields these routes read. */
function linkRow(over: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    guardian_profile_id: "guardian-1",
    student_profile_id: "student-1",
    status: "active",
    ...over,
  };
}

const kpiMocks = {
  buildStudentKpiViewFromCanonical: vi.fn(),
  buildStudentFullLengthReportView: vi.fn(),
  projectGuardianFullLengthReportView: vi.fn(),
};
const calendarMocks = {
  buildCalendarMonthView: vi.fn(),
};
const weaknessViewMocks = {
  buildWeaknessSkillsView: vi.fn(async () => ({
    ok: true,
    count: 0,
    skills: [],
  })),
};

const systemEventInserts: Record<string, unknown>[] = [];
const guardianAuditInserts: Record<string, unknown>[] = [];
let profileSelectError: { message: string } | null = null;

class FakeSelectBuilder {
  private readonly rows: any[];
  private readonly error: any;

  constructor(rows: any[], error: any = null) {
    this.rows = rows;
    this.error = error;
  }

  eq(): this {
    return this;
  }

  in(): this {
    return this;
  }

  gte(): this {
    return this;
  }

  lte(): this {
    return this;
  }

  order(): this {
    return this;
  }

  limit(count: number): this {
    if (count < this.rows.length) {
      this.rows.length = count;
    }
    return this;
  }

  async single() {
    if (this.error) {
      return { data: null, error: this.error };
    }
    const row = this.rows[0] ?? null;
    if (!row) {
      return {
        data: null,
        error: { code: "PGRST116", message: "No rows found" },
      };
    }
    return { data: row, error: null };
  }

  async maybeSingle() {
    if (this.error) {
      return { data: null, error: this.error };
    }
    return { data: this.rows[0] ?? null, error: null };
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?:
      | ((value: {
          data: any[];
          error: any;
        }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve({
      data: this.error ? null : this.rows,
      error: this.error,
    }).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

const seed = {
  profiles: [
    {
      id: "student-1",
      role: "student",
      email: "student1@example.com",
      display_name: "Student One",
      created_at: "2026-03-01T00:00:00.000Z",
    },
  ],
  student_study_profile: [
    {
      user_id: "student-1",
      timezone: "America/Chicago",
    },
  ],
  student_study_plan_days: [
    {
      user_id: "student-1",
      day_date: "2026-03-01",
      planned_minutes: 45,
      completed_minutes: 30,
      status: "in_progress",
      focus: [{ section: "M", weight: 1 }],
      tasks: [{ type: "practice" }],
      is_user_override: true,
      plan_version: 3,
    },
  ],
  student_question_attempts: [
    {
      user_id: "student-1",
      attempted_at: "2026-03-01T15:00:00.000Z",
      is_correct: true,
      time_spent_ms: 120000,
      event_type: null,
    },
  ],
};

vi.mock("../../server/middleware/supabase-auth", async () => {
  const actual = await vi.importActual<
    typeof import("../../server/middleware/supabase-auth")
  >("../../server/middleware/supabase-auth");
  return {
    ...actual,
    getSupabaseAdmin: vi.fn(() => ({})),
    requireSupabaseAuth: (req: any, _res: any, next: any) => {
      req.requestId ??= "req-guardian-reporting";
      next();
    },
  };
});

vi.mock("../../server/middleware/guardian-entitlement", () => ({
  requireGuardianEntitlement: (req: any, res: any, next: any) => {
    if (req.headers["x-entitled"] === "false") {
      return res
        .status(402)
        .json({ error: "Subscription required", code: "PAYMENT_REQUIRED" });
    }
    next();
  },
}));

vi.mock("../../server/middleware/csrf-double-submit", () => ({
  doubleCsrfProtection: (_req: any, _res: any, next: any) => next(),
  generateToken: () => "test-csrf-token",
}));

vi.mock("../../server/lib/durable-rate-limiter", () => ({
  createDurableRateLimiter: () => (_req: any, _res: any, next: any) => next(),
}));

const kpiAccessMocks = {
  resolveHistoricalTrendsAccess: vi.fn(async () => false),
};
vi.mock("../../server/services/kpi-access", async () => {
  const actual = await vi.importActual<
    typeof import("../../server/services/kpi-access")
  >("../../server/services/kpi-access");
  return { ...actual, ...kpiAccessMocks };
});

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    from: (table: string) => {
      if (table === "system_event_logs") {
        return {
          insert: async (payload: any) => {
            if (Array.isArray(payload)) {
              systemEventInserts.push(...payload);
            } else {
              systemEventInserts.push(payload);
            }
            return { error: null };
          },
        };
      }

      // WS-GL Phase B: the guardian-link audit trail moved from `guardian_link_audit` —
      // a table that does not exist in production — to `audit_logs`, which does. Owner
      // ruling 2026-08-24. This capture follows the writer; the assertions below follow
      // the new row shape.
      if (table === "audit_logs") {
        return {
          insert: async (payload: any) => {
            if (Array.isArray(payload)) {
              guardianAuditInserts.push(...payload);
            } else if (payload) {
              guardianAuditInserts.push(payload);
            }
            return { error: null };
          },
        };
      }

      const rows = (seed as Record<string, any[]>)[table] ?? [];
      const selectError =
        table === "student_study_profile" ? profileSelectError : null;
      return {
        select: () => new FakeSelectBuilder([...rows], selectError),
        insert: async () => ({ error: null }),
      };
    },
  },
}));

vi.mock("../../server/lib/account", () => accountMocks);
vi.mock("../../server/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock("../../apps/api/src/services/fullLengthExam", () => ({
  getExamReport: vi.fn(),
}));
vi.mock("../../apps/api/src/services/weakness-view", () => ({
  buildWeaknessSkillsView: weaknessViewMocks.buildWeaknessSkillsView,
}));

import { masteryLevelLabelsFixture } from "../utils/mastery-levels-fixture";

const masteryReadMocks = {
  fetchDomainMasteryRows: vi.fn(async () => []),
};
vi.mock("../../apps/api/src/services/mastery-read", async () => {
  const actual = await vi.importActual<
    typeof import("../../apps/api/src/services/mastery-read")
  >("../../apps/api/src/services/mastery-read");
  return {
    // buildDomainLevelView is the pure builder under test here — use the real one so
    // the case proves the route's own shaping rather than a stub's.
    buildDomainLevelView: actual.buildDomainLevelView,
    buildSkillLevelView: actual.buildSkillLevelView,
    fetchDomainMasteryRows: masteryReadMocks.fetchDomainMasteryRows,
    fetchSkillMasteryRows: vi.fn(async () => []),
    fetchWeakestSkills: vi.fn(async () => []),
  };
});

vi.mock("../../apps/api/src/services/mastery-levels-read", () => ({
  loadMasteryLevels: vi.fn(async () => masteryLevelLabelsFixture()),
  resetMasteryLevelsCache: vi.fn(),
}));

vi.mock("../../apps/api/src/services/calendar-month-view", () => ({
  buildCalendarMonthView: calendarMocks.buildCalendarMonthView,
}));
vi.mock("../../server/services/canonical-runtime-views", async () => {
  const actual = await vi.importActual<
    typeof import("../../server/services/canonical-runtime-views")
  >("../../server/services/canonical-runtime-views");
  // Only the IO-bearing builders are stubbed; everything else stays real. `actual` is
  // still imported so that a future stub can be layered over the real module rather than
  // replacing it wholesale.
  void actual;
  return { ...kpiMocks };
});

const APP_IDENTITIES = {
  guardian: { id: "guardian-1", email: "guardian@example.com" },
  student: { id: "student-9", email: "student9@example.com" },
  // R5: an admin is now an ORDINARY caller here. Added so the removal of the three
  // route-level `if (!isAdmin)` skips has something that can observe it.
  admin: { id: "admin-1", email: "admin@example.com" },
} as const;

function buildApp(role: keyof typeof APP_IDENTITIES = "guardian") {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.user = { ...APP_IDENTITIES[role], role };
    next();
  });
  return app;
}

// SUMMARY AND WEAKNESS CASES MOVED WITH THEIR ROUTES (PR 2).
// `/guardian/students/:id/summary` and `/guardian/weaknesses/:id` are deleted: both were
// guardian-only paths to a resource that also had a student twin, and every such twin in this
// vertical produced a privilege divergence. The same resources are now
// `/api/students/:studentId/kpi/overall` and `/mastery/domains`, ONE route each, asserted on
// BOTH `via` values in tests/ci/student-resources.contract.test.ts. What remains in this file
// is the exam and linking surface, which Doc 04C keeps as separate guardian routes by design.
describe("Guardian reporting runtime contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    systemEventInserts.length = 0;
    guardianAuditInserts.length = 0;
    profileSelectError = null;
    accountMocks.isGuardianLinkedToStudent.mockResolvedValue(true);
    accountMocks.getAllGuardianStudentLinks.mockResolvedValue([
      // WS-GL Phase B: the real column is `student_profile_id`; `linked_at` does not
      // exist on this table (`created_at` does).
      {
        student_profile_id: "student-1",
        status: "active",
        created_at: "2026-03-01T00:00:00.000Z",
      },
    ]);

    kpiMocks.buildStudentKpiViewFromCanonical.mockResolvedValue({
      modelVersion: "kpi-v1",
      timezone: "America/Chicago",
      week: {
        questionsSolved: 30,
        accuracy: 80,
        explanations: {},
      },
      recency: {
        window: 30,
        totalAttempts: 200,
        accuracy: 78,
        explanations: {},
      },
      metrics: [
        {
          id: "week_questions",
          label: "Questions Solved (7d)",
          kind: "diagnostic",
          unit: "count",
          value: 30,
          explanation: {
            ruleId: "RULE_WEEK_QUESTIONS",
            whatThisMeans: "wq",
            whyThisChanged: "up",
            whatToDoNext: "keep going",
          },
        },
        {
          id: "week_accuracy",
          label: "Accuracy (7d)",
          kind: "diagnostic",
          unit: "percent",
          value: 80,
          explanation: {
            ruleId: "RULE_WEEK_ACCURACY",
            whatThisMeans: "wa",
            whyThisChanged: "up",
            whatToDoNext: "keep going",
          },
        },
        {
          id: "current_streak",
          label: "Current Streak (days)",
          kind: "diagnostic",
          unit: "count",
          value: 3,
          explanation: {
            ruleId: "RULE_CURRENT_STREAK",
            whatThisMeans: "cs",
            whyThisChanged: "active today",
            whatToDoNext: "protect the streak",
          },
        },
        {
          id: "recency_accuracy",
          label: "Accuracy (30d)",
          kind: "diagnostic",
          unit: "percent",
          value: 78,
          explanation: {
            ruleId: "RULE_RECENCY_ACCURACY",
            whatThisMeans: "ra",
            whyThisChanged: "flat",
            whatToDoNext: "maintain",
          },
        },
      ],
      gating: {
        historicalTrends: {
          allowed: true,
          requiredPlan: "paid",
          reason: "allowed",
        },
      },
      measurementModel: {
        official: [],
        weighted: [],
        diagnostic: [
          "week_questions",
          "week_accuracy",
          "current_streak",
          "recency_accuracy",
        ],
      },
    });
    kpiMocks.buildStudentFullLengthReportView.mockImplementation(
      (report: any) => report,
    );
    kpiMocks.projectGuardianFullLengthReportView.mockImplementation(
      (view: any) => view,
    );
    weaknessViewMocks.buildWeaknessSkillsView.mockResolvedValue({
      ok: true,
      count: 0,
      skills: [],
    });
    calendarMocks.buildCalendarMonthView.mockResolvedValue({
      days: [
        {
          day_date: "2026-03-01",
          planned_minutes: 45,
          completed_minutes: 30,
          status: "in_progress",
          attempt_count: 1,
          accuracy: 100,
          avg_seconds_per_question: 120,
          focus: [{ section: "M" }],
          tasks: [{ type: "practice" }],
          plan_version: 3,
          is_user_override: true,
        },
      ],
      streak: { current: 2, longest: 4 },
    });
  });

  it("returns linked students list and emits guardian_dashboard_viewed", async () => {
    const router = (await import("../../server/routes/guardian-routes"))
      .default;
    const app = buildApp("guardian");
    app.use("/api/guardian", router);

    const response = await request(app).get("/api/guardian/students");

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.students)).toBe(true);
    expect(response.body.students).toHaveLength(1);
    expect(response.body.students[0]).toMatchObject({
      id: "student-1",
      display_name: "Student One",
    });

    const dashboardViewed = systemEventInserts.find(
      (row) => row.event_type === "guardian_dashboard_viewed",
    );
    expect(dashboardViewed).toBeDefined();
    expect(dashboardViewed).toMatchObject({
      user_id: "guardian-1",
      details: expect.objectContaining({
        linked_student_count: 1,
      }),
    });
  });

  it("fails closed when guardian link source lookup fails for students list", async () => {
    accountMocks.getAllGuardianStudentLinks.mockRejectedValueOnce(
      new Error("guardian_links_source_failed"),
    );
    const router = (await import("../../server/routes/guardian-routes"))
      .default;
    const app = buildApp("guardian");
    app.use("/api/guardian", router);

    const response = await request(app).get("/api/guardian/students");

    expect(response.status).toBe(500);
    expect(response.body.error).toBe("Internal server error");
    const dashboardViewed = systemEventInserts.find(
      (row) => row.event_type === "guardian_dashboard_viewed",
    );
    expect(dashboardViewed).toBeUndefined();
  });

  /**
   * MUTATIONS STAGED FOR THE THREE REVOKE-AUDIT ASSERTIONS, and the assertion each one reds.
   * Run 2026-08-28; baseline 8/8 green before and after every restore.
   *
   *   M1. In the supabase mock below, change `if (table === "audit_logs")` to `if (false)`.
   *       → reds `expect(...).toMatchObject(...)` in the INSTRUMENT case. 1 of 8.
   *       Proves the capture is real, so "no revoke row" below means absence, not blindness.
   *
   *   M2. In `guardian-routes.ts`, add an `auditGuardianLink({action:"guardian_link_revoked"})`
   *       call on the successful unlink path.
   *       → reds the `expect(unlinkSuccess).toBeUndefined()` in the last case. 1 of 8.
   *       This is the regression the case exists for: a duplicate, best-effort row beside the
   *       transactional one.
   *
   *   M3. In the same handler, pass `studentId` instead of `guardianId` as the third argument
   *       to `revokeGuardianLink`.
   *       → reds `expect(accountMocks.revokeGuardianLink).toHaveBeenCalledWith(...)` in that
   *       same case, one assertion ABOVE M2's. 1 of 8. Two mutations, two assertion layers,
   *       so neither case is carrying the other.
   */
  /**
   * INSTRUMENT CONTROL for the two cases below.
   *
   * Both of them assert that NO `guardian_link_revoked` row reaches `audit_logs` from this
   * layer. After adoption-plan step 4 that is true because the revoke audit row is written
   * inside `revoke_guardian_link_audited`, in the same transaction as the status change, and
   * `guardian-routes.ts` no longer calls `auditGuardianLink` for a transition at all.
   *
   * An assertion that a capture array does not contain something is worthless if the capture
   * is broken — "no row" and "no instrument" are indistinguishable. Everything else in this
   * file that used `guardianAuditInserts` was one of those two revoke cases, so nothing else
   * proves the capture still works. This does, directly: call the writer once and see the row.
   * If the `audit_logs` branch of the supabase mock is ever removed, this reds first and names
   * why the negative assertions stopped meaning anything.
   */
  it("INSTRUMENT: the audit_logs capture still records a row when the writer runs", async () => {
    const { auditGuardianLink } =
      await import("../../server/services/guardian-link-audit");
    await auditGuardianLink({
      action: "guardian_link_denied",
      actorProfileId: "guardian-1",
      targetProfileId: "student-1",
      changes: { reason: "instrument_control" },
    });

    expect(
      guardianAuditInserts.find(
        (row: any) => row.action === "guardian_link_denied",
      ),
      "the audit_logs capture is broken — the negative assertions below prove nothing",
    ).toMatchObject({
      actor_profile_id: "guardian-1",
      target_profile_id: "student-1",
    });
  });

  it("fails closed on unlink conflict when link is no longer active, and writes no revoke audit row", async () => {
    accountMocks.isGuardianLinkedToStudent.mockResolvedValue(true);
    // A party with an ACTIVE link, so the route reaches `revokeGuardianLink` and the domain
    // conflict below is what produces the 409 — not the route's own party check.
    accountMocks.getAnyGuardianLinkForPair.mockResolvedValue(linkRow());
    const conflict = new Error("Guardian link is not active") as Error & {
      code?: string;
    };
    conflict.code = "LINK_NOT_ACTIVE";
    accountMocks.revokeGuardianLink.mockRejectedValueOnce(conflict);
    const router = (await import("../../server/routes/guardian-routes"))
      .default;
    const app = buildApp("guardian");
    app.use("/api/guardian", router);

    const response = await request(app).delete("/api/guardian/link/student-1");

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("LINK_NOT_ACTIVE");
    // The transition never happened, so no revoke row exists anywhere — the database wrote
    // none because the transaction raised, and the route writes none by design.
    const unlinkSuccess = guardianAuditInserts.find(
      (row: any) => row.action === "guardian_link_revoked",
    );
    expect(unlinkSuccess).toBeUndefined();
  });

  /**
   * REWRITTEN at adoption-plan step 4, and the direction of the change is the point.
   *
   * This case used to assert that a `guardian_link_revoked` row appeared in `audit_logs`
   * after a successful unlink. It asserted the OPPOSITE of what it now asserts, and both
   * readings were correct at their own time:
   *
   *   BEFORE — `guardian-routes.ts` called `auditGuardianLink` after `revokeGuardianLink`
   *   returned. Two writes, two PostgREST requests, therefore two transactions. A revoke
   *   that succeeded and an audit row that did not write were an ordinary outcome, and the
   *   trail silently lost rows.
   *
   *   AFTER — `revoke_guardian_link_audited` writes the status change and its audit row in
   *   ONE transaction (migration 20260828000000). The route's own call is gone. If it came
   *   back, every revoke would produce TWO rows: the transactional one and a best-effort
   *   duplicate. That is what the negative assertion below catches, and it is a real
   *   regression rather than a formality — re-adding the call is the most natural way for
   *   someone to "restore" this test's old assertion.
   *
   * The audit row itself is proven where it is now written: `guardian-link-student-side
   * .pg.ci.test.ts` reads it back out of a real `audit_logs` table, and its FAIL-CLOSED pair
   * proves the row and the status change stand or fall together. A mocked account layer
   * cannot see a write that happens inside the function it replaced, and pretending otherwise
   * is how the assertion would go vacuous instead of moving.
   */
  it("keeps valid unlink transition behavior and leaves the revoke audit row to the transaction", async () => {
    accountMocks.isGuardianLinkedToStudent.mockResolvedValue(true);
    accountMocks.getAnyGuardianLinkForPair.mockResolvedValue(linkRow());
    // `revokeGuardianLink` returns the revoked row now (§36.3 needs `revoked_at`,
    // `revoked_by_profile_id` and `revocation_reason` to be observable).
    accountMocks.revokeGuardianLink.mockResolvedValueOnce({
      id: "11111111-1111-1111-1111-111111111111",
      guardian_profile_id: "guardian-1",
      student_profile_id: "student-1",
      status: "revoked",
    });
    accountMocks.getAllGuardianStudentLinks.mockResolvedValueOnce([]);
    const router = (await import("../../server/routes/guardian-routes"))
      .default;
    const app = buildApp("guardian");
    app.use("/api/guardian", router);

    const response = await request(app).delete("/api/guardian/link/student-1");

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.students).toEqual([]);

    // §36.3 — the revoker is RECORDED, not assumed. The route's remaining responsibility is
    // to name the acting guardian as the revoker; the row that carries it is written by the
    // transaction. Asserting the arguments is what keeps this case from proving only that a
    // mock resolved.
    expect(accountMocks.revokeGuardianLink).toHaveBeenCalledWith(
      "guardian-1",
      "student-1",
      "guardian-1",
      undefined,
    );

    // No second, best-effort revoke row from this layer. See the docblock.
    const unlinkSuccess = guardianAuditInserts.find(
      (row: any) => row.action === "guardian_link_revoked",
    );
    expect(
      unlinkSuccess,
      "the route wrote its own guardian_link_revoked row — the transaction already wrote one, so this revoke is now double-audited",
    ).toBeUndefined();
  });

  /**
   * @spec [owner ruling 2026-08-27 Q7 — "404 if the caller is not a party to the link at all.
   *        Keep the informative response if they are... Use 409 rather than 403, since it's a
   *        state conflict rather than an authorization failure."] | @implemented [2026-08-28]
   *
   * STEP 6 — THE TWO 403s, SPLIT ON PARTY-HOOD.
   *
   * Both guardian-side link routes answered 403 to two callers who deserve different answers:
   *   - a guardian NAMED on the link, whose link is revoked or is waiting on the other side.
   *     They already know the link exists. An informative answer leaks nothing.
   *   - a guardian named on NOTHING, who guessed a student id or a link id. A 403 tells them
   *     the resource is real, which is the enumeration primitive we have been removing.
   * The first now gets 409 — a state conflict, not an authorization failure — and the second
   * gets the resolver's 404 body verbatim.
   *
   * WHY THE 404 BODY IS IMPORTED RATHER THAN WRITTEN HERE: two "not found" shapes would let a
   * caller distinguish the surfaces and undo the point. The assertion below pins the shared
   * body, so a divergent 404 fails even though the status matches.
   *
   * MUTATIONS OBSERVED RED (run 2026-08-28, baseline 15/15 green; each reds exactly one case):
   *   1. revoke: drop the `!existing` branch (treat a non-party as a party).
   *      → reds "404s a guardian who is not a party".
   *   2. revoke: change `existing.status !== "active"` to `false`.
   *      → reds "409s a guardian whose link is already revoked".
   *   3. accept: drop the `existing.guardian_profile_id !== guardianId` half of the guard.
   *      → reds "404s a guardian who is not named on the link".
   *   4. accept: answer 403 instead of 409 on WRONG_ACCEPTOR.
   *      → reds "409s the guardian when the link awaits the student".
   */
  describe("Q7 — party-hood decides 404 versus 409 on the guardian link routes", () => {
    const NOT_FOUND_BODY = {
      error: "Not found",
      message: "No such student, or you do not have access to them",
    };

    it("revoke: 404s a guardian who is not a party to any link with the student", async () => {
      accountMocks.getAnyGuardianLinkForPair.mockResolvedValue(null);
      const router = (await import("../../server/routes/guardian-routes"))
        .default;
      const app = buildApp("guardian");
      app.use("/api/guardian", router);

      const response = await request(app).delete(
        "/api/guardian/link/student-stranger",
      );

      expect(response.status).toBe(404);
      expect(response.body).toMatchObject(NOT_FOUND_BODY);
      // The transition must not even be attempted for a non-party.
      expect(accountMocks.revokeGuardianLink).not.toHaveBeenCalled();
    });

    // SCL-080 deleted the guardian-side acceptance route: there is no acceptance step, so
    // there is no acceptor to be wrong about. The two REVOKE cases above still hold — §36.3
    // survives — and Q7's 404-versus-409 rule is still proved by them.

    it("revoke: 409s a guardian whose link with the student is already revoked", async () => {
      accountMocks.getAnyGuardianLinkForPair.mockResolvedValue(
        linkRow({ status: "revoked" }),
      );
      const router = (await import("../../server/routes/guardian-routes"))
        .default;
      const app = buildApp("guardian");
      app.use("/api/guardian", router);

      const response = await request(app).delete(
        "/api/guardian/link/student-1",
      );

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe(GUARDIAN_LINK_ERROR.NOT_ACTIVE);
      expect(accountMocks.revokeGuardianLink).not.toHaveBeenCalled();
    });


  });
});
