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
// Driven FROM the route table, not from a copy of it: a path added there with no gate wired
// up must fail these cases rather than ship open.
import { requiresEntitlement } from "../../server/routes/student-resources";
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
  // Step 7: the mastery gate now asks `canAccessFeature('mastery_detail')`, which reads THIS
  // table before it consults the entitlement predicate. Without the row the feature key is
  // unknown, `canAccessFeature` fails closed, and every mastery case 402s — which is exactly
  // how these six cases failed when the gate moved. The values mirror the genesis seed
  // (`00000000000000_genesis.sql:206`): premium, and enabled.
  rows.entitlement_features = [
    { feature_key: "mastery_detail", required_tier: "premium", enabled: true },
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

  /**
   * @spec [owner ruling 2026-08-28 step 7 — "route-table requiresEntitlement, one
   *        canAccessFeature('mastery_detail') call site, no new keys"] | @implemented [2026-08-28]
   *
   * THE TABLE IS THE MECHANISM, AND THIS IS WHAT SAYS SO.
   *
   * Before step 7 the table `REQUIRES_ACTIVE_ENTITLEMENT` gated nothing: its only two `true`
   * entries were the mastery routes, which do not go through `resource()`, and every path that
   * did go through `resource()` was `false` — so the `=== true` branch never executed once, in
   * any request. Two hand-copied `subjectEntitlementActive` calls did the real gating. Nothing
   * failed, because nothing asked whether the table was consulted.
   *
   * These cases ask. They are driven FROM the exported table rather than from a hand-written
   * list, so a path added to it with no gate wired up fails here instead of shipping open:
   *   - every entry with a feature key must 402 when that feature is denied;
   *   - every entry with `null` must still answer 200 in the same conditions, which is what
   *     keeps this from passing under a middleware that simply denies everything.
   *
   * Denial is induced by removing the feature ROW rather than by mocking `canAccessFeature`:
   * an unknown key is one of the fail-closed paths that function specifies, and driving it
   * through the real function means these cases cover the wiring AND the posture. Mocking the
   * gate would only prove the mock was called.
   *
   * MUTATIONS, AS OBSERVED — including two that disproved what I first declared, which is
   * recorded here rather than quietly corrected (2026-08-28; baseline 30/30 green):
   *   1. `entitlementGate` returns `true` before consulting the table.
   *      → reds both gated-path cases and neither open-path case. 2 of 30. As declared.
   *   2. Make the gated branch deny: `if (false)` around the `canAccessFeature` result.
   *      → reds the 4 mastery ANTI-LEAK cases and the 2 SKILLS cases. 6 of 30.
   *      I DECLARED this would red the two OPEN-path cases. It does not, and cannot: a
   *      `null` entry returns from `if (!featureKey) return true` before ever reaching the
   *      branch this mutates. The open half needed its own mutation, which is (3).
   *   3. Make the OPEN branch deny: replace `if (!featureKey) return true` with a 402.
   *      → reds 15 cases, among them all five "still serves ... under the same denial".
   *      This is the mutation that actually proves the `null` half, and the one the old dead
   *      table would have survived.
   *   4. Point `masteryDomains` at `null` in the table.
   *      → reds ONLY the membership assertion above. 1 of 30, individually proven.
   *      It reddened ZERO cases before that assertion existed: the gated case derived itself
   *      from the table, so removing the entry deleted the case instead of failing it. A
   *      table-driven suite cannot police its own table.
   */
  describe("step 7 — every requiresEntitlement entry is actually consulted", () => {
    const gated = Object.entries(requiresEntitlement).filter(
      ([, key]) => key !== null,
    );
    const open = Object.entries(requiresEntitlement).filter(
      ([, key]) => key === null,
    );

    /**
     * THE MEMBERSHIP ASSERTION, AND WHY IT IS NOT PADDING.
     *
     * The two `it.each` blocks below derive their cases FROM the table, which makes them
     * blind in one direction: point `masteryDomains` at `null` and its gated case does not
     * fail, it CEASES TO EXIST, and the suite stays green while the route silently opens.
     * Staging that mutation reddened zero cases — the table-driven design defeated its own
     * proof, in exactly the way a `describe.each` over a shrinking list always can.
     *
     * So the expected posture is pinned here as a literal. Moving any path between the gated
     * and open halves now fails THIS assertion, whether or not a case disappears with it.
     * Changing the paywall stays a one-line edit to the table — plus one line here, which is
     * the point: it should not be possible to do silently.
     */
    it("gates exactly the mastery paths, and nothing else", () => {
      expect(gated.map(([path]) => path).sort()).toEqual(
        [
          STUDENT_RESOURCE_PATHS.masteryDomains,
          STUDENT_RESOURCE_PATHS.masterySkills,
        ].sort(),
      );
      expect(gated.map(([, key]) => key)).toEqual([
        "mastery_detail",
        "mastery_detail",
      ]);
      expect(open.map(([path]) => path).sort()).toEqual(
        [
          STUDENT_RESOURCE_PATHS.kpiSections,
          STUDENT_RESOURCE_PATHS.kpiDomains,
          STUDENT_RESOURCE_PATHS.kpiOverall,
          STUDENT_RESOURCE_PATHS.projectionsSections,
          STUDENT_RESOURCE_PATHS.projectionsSnapshots,
        ].sort(),
      );
    });

    it.each(gated)("402s %s when its feature is denied", async (path) => {
      decision.mockReturnValue("allow");
      rows.entitlement_features = []; // unknown key -> canAccessFeature fails closed
      const res = await call(STUDENT, STUDENT, path);
      expect(res.status).toBe(402);
      expect(res.body.code).toBe("PAYMENT_REQUIRED");
    });

    it.each(open)("still serves %s under the same denial", async (path) => {
      decision.mockReturnValue("allow");
      rows.entitlement_features = [];
      const res = await call(STUDENT, STUDENT, path);
      expect(res.status).toBe(200);
    });
  });

  it("400 for a malformed studentId, before any read", async () => {
    const res = await call(STUDENT, "not-a-uuid", STUDENT_RESOURCE_PATHS.kpiOverall);
    expect(res.status).toBe(400);
  });
});

