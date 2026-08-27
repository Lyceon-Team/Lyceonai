/**
 * @spec [Doc 05B §10.3 single-route contract + RB-05B-V1-05, §10.4 empty-list semantics,
 *   §10.5 column projection, §10.7 no pagination; Doc 05C §10.2; Doc 05 Parent AC#19/#20;
 *   owner rulings 2026-08-26 R3/R6 and 2026-08-27 OQ1/OQ3/OQ4] | @implemented [2026-08-27]
 *
 * plain English: the contract for every subject-scoped resource. Each route is driven TWICE —
 * once as the student (`via='self'`), once as a linked guardian (`via='guardian'`) — because
 * one route serving two callers is the entire point, and a gate that only ever exercises one
 * of them proves nothing about the other.
 *
 * THE MOCK SEAM IS THE ROW LAYER, NOT THE SERVICE LAYER.
 *   The Supabase clients are faked and the REAL readers, REAL routes and REAL resolver run on
 *   top. Mocking the read services instead would test the doubles: the double would return
 *   clean DTOs and every anti-leak assertion would pass without the route stripping anything.
 *   That is not hypothetical — #644 shipped two guardian anti-leak cases that passed
 *   vacuously for exactly this reason, because the mock did the stripping.
 *
 *   So the fake rows carry the forbidden columns EXACTLY as the real tables do. A pass proves
 *   the routes strip them; the mutation it is built to catch is one character, `...row`
 *   instead of naming fields.
 *
 * WHAT THE PREVIOUS GATES COULD NOT SEE. `tests/ci/guardian.anti-leak.ci.test.ts` sets
 * `isGuardian: false` and has never once exercised a guardian path — the ninth instance in
 * this vertical of a check that looks like coverage and is not. Here the guardian path is
 * half of every case.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  RULE_4_COLUMNS,
  findRule4Keys,
} from "../../packages/shared/src/rule4-columns";
import { STUDENT_RESOURCE_PATHS } from "../../packages/shared/src/student-resources";

const STUDENT = "11111111-1111-4111-8111-111111111111";
const GUARDIAN = "22222222-2222-4222-8222-222222222222";
const OTHER_STUDENT = "44444444-4444-4444-8444-444444444444";

/** Every forbidden column, on every row, exactly as the real tables carry them. */
const POISON = Object.fromEntries(RULE_4_COLUMNS.map((k) => [k, "LEAKED"]));

const rows: Record<string, unknown[]> = {};
const decision = vi.fn();

function resetRows() {
  rows.student_domain_mastery = [
    { section: "M", domain: "Algebra", mastery_level: 2, computed_at: "2026-08-01", ...POISON },
  ];
  rows.student_skill_mastery = [
    {
      section: "M",
      domain: "Algebra",
      skill: "Linear Equations in One Variable",
      mastery_level: 1,
      computed_at: "2026-08-01",
      ...POISON,
    },
  ];
  rows.canonical_skill_catalog = [
    { section: "M", domain: "Algebra", skill: "Linear Equations in One Variable" },
  ];
  // ALL SIX rows. The loader validates that every level 0-4 plus `unmeasured` is present and
  // throws otherwise — correctly, since a missing label would render as a silent gap. A
  // three-row fixture 500s every mastery route, which is how these cases first failed.
  rows.mastery_levels = [
    { level_key: "unmeasured", level: null, display_name: "Not enough answers yet", sort_order: 0 },
    { level_key: "L0", level: 0, display_name: "Beginning", sort_order: 1 },
    { level_key: "L1", level: 1, display_name: "Developing", sort_order: 2 },
    { level_key: "L2", level: 2, display_name: "Approaching", sort_order: 3 },
    { level_key: "L3", level: 3, display_name: "Proficient", sort_order: 4 },
    { level_key: "L4", level: 4, display_name: "Advanced", sort_order: 5 },
  ];
  rows.student_section_kpi = [
    { section: "M", events_total: 40, accuracy_overall: 0.75, current_streak_days: 3, last_active_at: "2026-08-01", ...POISON },
  ];
  rows.student_domain_kpi = [
    { section: "M", domain: "Algebra", events_total: 20, accuracy_overall: 0.5, last_active_at: "2026-08-01", ...POISON },
  ];
  rows.student_overall_kpi = [
    {
      events_total: 40, events_last_7d: 12, events_last_30d: 30,
      accuracy_overall: 0.7, accuracy_last_7d: 0.75, accuracy_last_30d: 0.7,
      current_streak_days: 3, longest_streak_days: 9, sections_active: 2,
      last_active_at: "2026-08-01", ...POISON,
    },
  ];
  rows.student_section_projections = [
    { section: "M", projected_score_mid: 600, projected_score_low: 570, projected_score_high: 630, relevant_question_count: 40, computed_at: "2026-08-01", ...POISON },
  ];
  rows.student_section_projection_snapshots = [
    { section: "M", projected_score_mid: 590, projected_score_low: 560, projected_score_high: 620, relevant_question_count: 35, snapshot_at: "2026-07-01", snapshot_kind: "periodic", ...POISON },
  ];
  rows.student_study_profile = [{ timezone: "America/Chicago" }];
  rows.audit_logs = [];
}

/** A query builder that ignores filters and hands back the table's fixture rows. */
function fakeClient() {
  return {
    from(table: string) {
      const result = { data: rows[table] ?? [], error: null };
      const builder: Record<string, unknown> = {};
      Object.assign(builder, {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        order: () => builder,
        limit: () => builder,
        insert: async () => ({ error: null }),
        single: async () => ({ data: (rows[table] ?? [])[0] ?? null, error: null }),
        maybeSingle: async () => ({ data: (rows[table] ?? [])[0] ?? null, error: null }),
        then: (f?: (v: typeof result) => unknown) => Promise.resolve(result).then(f),
      });
      return builder;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "guardian_view_decision") return { data: decision(args), error: null };
      if (fn === "entitlement_active") return { data: true, error: null };
      return { data: null, error: null };
    },
  };
}

vi.mock("../../apps/api/src/lib/supabase-server", () => ({ supabaseServer: fakeClient() }));
// `apps/api/src/lib/supabase-admin` is the accessor every apps/api service uses; the
// server-side services use `apps/api/src/lib/supabase-server`. Both are faked, because a
// route that reached a real client would hang for five seconds and then 500 — which is how
// these cases first failed.
vi.mock("../../apps/api/src/lib/supabase-admin", () => ({
  getSupabaseAdmin: () => fakeClient(),
}));
vi.mock("../../server/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

type Req = express.Request & { user?: { id: string; role: string }; requestId?: string };

async function call(principal: string, studentId: string, path: string) {
  const router = (await import("../../server/routes/student-resources")).default;
  const app = express();
  app.use((req, _res, next) => {
    const r = req as Req;
    r.user = { id: principal, role: principal === GUARDIAN ? "guardian" : "student" };
    r.requestId = "req-sr";
    next();
  });
  app.use("/api/students", router);
  return request(app).get(`/api/students/${studentId}${path}`);
}

const ALL_PATHS = Object.values(STUDENT_RESOURCE_PATHS);

describe("subject-scoped resources — one route, two callers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRows();
    decision.mockReturnValue("allow");
  });

  // -- ANTI-LEAK, BOTH `via` VALUES ------------------------------------------
  for (const path of ALL_PATHS) {
    it(`ANTI-LEAK ${path} — no RULE-4 key at any depth, as SELF`, async () => {
      const res = await call(STUDENT, STUDENT, path);
      expect(res.status).toBe(200);
      expect(findRule4Keys(res.body)).toEqual([]);
    });

    it(`ANTI-LEAK ${path} — no RULE-4 key at any depth, as GUARDIAN`, async () => {
      const res = await call(GUARDIAN, STUDENT, path);
      expect(res.status).toBe(200);
      expect(findRule4Keys(res.body)).toEqual([]);
    });
  }

  it("the walk itself can see a leak (gate self-check)", () => {
    // A gate that cannot fail is not a gate. This proves `findRule4Keys` reports a nested
    // occurrence, so an empty result above means "clean", not "never looked".
    expect(findRule4Keys({ a: { b: [{ mastery_score: 1 }] } })).toEqual([
      "a.b[].mastery_score",
    ]);
  });

  // -- PARITY BY PROVENANCE ---------------------------------------------------
  it("PROVENANCE — the guardian body IS the student body, byte for byte", async () => {
    for (const path of ALL_PATHS) {
      if (path === STUDENT_RESOURCE_PATHS.masterySkills) continue; // §10.4, asserted below
      const self = await call(STUDENT, STUDENT, path);
      const guardian = await call(GUARDIAN, STUDENT, path);
      expect(guardian.status).toBe(self.status);
      expect(guardian.body).toEqual(self.body);
    }
  });

  it("MUTATION — a new field on the shared row reaches BOTH callers, or neither", async () => {
    // If a handler rebuilt the body for one audience, this field would appear on one side
    // only. It must appear on both (it does not, because fields are NAMED) — the assertion
    // is that the two paths agree, not that the field is present.
    rows.student_section_kpi = [
      { section: "M", events_total: 1, accuracy_overall: 1, current_streak_days: 1, last_active_at: null, freshlyAddedField: "x" },
    ];
    const self = await call(STUDENT, STUDENT, STUDENT_RESOURCE_PATHS.kpiSections);
    const guardian = await call(GUARDIAN, STUDENT, STUDENT_RESOURCE_PATHS.kpiSections);
    expect(guardian.body).toEqual(self.body);
    expect(JSON.stringify(self.body)).not.toContain("freshlyAddedField");
  });

  // -- §10.4 SKILLS DENIAL ----------------------------------------------------
  it("SKILLS — a guardian gets 200 and an empty list, never 403 (Doc 05B §10.4)", async () => {
    const guardian = await call(GUARDIAN, STUDENT, STUDENT_RESOURCE_PATHS.masterySkills);
    expect(guardian.status).toBe(200);
    expect(guardian.body.skills).toEqual([]);
    // `catalogEmpty` reports on the QUESTION BANK, not on the caller's permissions. Saying
    // "the catalogue is empty" here would be a claim about the bank made from a denial.
    expect(guardian.body.catalogEmpty).toBe(false);
  });

  it("SKILLS — the student gets their rows from the same route", async () => {
    const self = await call(STUDENT, STUDENT, STUDENT_RESOURCE_PATHS.masterySkills);
    expect(self.status).toBe(200);
    expect(self.body.skills.length).toBeGreaterThan(0);
    // FLAT: every node carries its own section and domain, so the drill-down filters in the
    // client from one fetch (Doc 05B §10.3 names the resource without a path segment).
    expect(self.body.skills[0]).toMatchObject({ section: "M", domain: "Algebra" });
  });

  // -- STATUS CODES -----------------------------------------------------------
  it("404 for an unrelated caller, and the body does not vary by studentId", async () => {
    decision.mockReturnValue("not_linked");
    const a = await call(GUARDIAN, STUDENT, STUDENT_RESOURCE_PATHS.kpiOverall);
    const b = await call(GUARDIAN, OTHER_STUDENT, STUDENT_RESOURCE_PATHS.kpiOverall);
    expect(a.status).toBe(404);
    expect(b.status).toBe(404);
    // MUTATION: interpolate the studentId into either message and this reds. A body that
    // varies by id is the enumeration channel returning 404 was meant to close.
    expect(a.body).toEqual(b.body);
  });

  it("402 when the subject's entitlement lapsed — the ruled deviation from 404", async () => {
    decision.mockReturnValue("student_unentitled");
    const res = await call(GUARDIAN, STUDENT, STUDENT_RESOURCE_PATHS.kpiOverall);
    expect(res.status).toBe(402);
    expect(res.body.code).toBe("PAYMENT_REQUIRED");
  });

  it("400 for a malformed studentId, before any read", async () => {
    const res = await call(STUDENT, "not-a-uuid", STUDENT_RESOURCE_PATHS.kpiOverall);
    expect(res.status).toBe(400);
  });
});

