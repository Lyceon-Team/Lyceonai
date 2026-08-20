import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * @spec [Doc 05A §6.2 + Doc 05 Parent §6.6 — below MIN_EVENTS_FOR_MASTERY the row is written
 *   with mastery_score/pct/level NULL; NULL is the insufficient-evidence signal, not a zero]
 * | @implemented [2026-08-20]
 *
 * plain English: the weakest-skills surface must show only skills the mastery formula has
 * actually MEASURED. Until 2026-08-20 it filtered on `event_count_total >= 2` while the
 * formula's threshold is 5, then coerced the resulting NULL score to 0.0 with `|| 0`, then
 * sorted ascending — so a student's least-practiced skills were presented as their worst.
 * In production that was 18 of 46 skill rows.
 *
 * This test exercises the REAL fetchWeakestSkills against an in-memory table that actually
 * applies the filters the query builds, rather than asserting which methods were called.
 * A filter that is built but does not discriminate would pass a call-shape assertion and
 * fail this one.
 */

type Row = {
  section: string;
  domain: string;
  skill: string;
  mastery_score: number | null;
  mastery_level: number | null;
  event_count_total: number;
  student_id: string;
};

/**
 * Canonical fixture values only. `section` is CHECK-constrained to 'M'|'RW'
 * (genesis-schema.expected.sql:130); domain and skill are the College Board canonical
 * strings the pipeline actually writes.
 *
 * Three skills at 2, 4 and 6 events. MIN_EVENTS_FOR_MASTERY is 5, so the formula scored
 * exactly one of them and left the other two NULL — the real shape of a mid-diagnostic
 * student.
 */
const SEED: Row[] = [
  {
    student_id: "student-1",
    section: "M",
    domain: "Algebra",
    skill: "Linear Equations in One Variable",
    event_count_total: 2,
    mastery_score: null,
    mastery_level: null,
  },
  {
    student_id: "student-1",
    section: "M",
    domain: "Algebra",
    skill: "Linear Functions",
    event_count_total: 4,
    mastery_score: null,
    mastery_level: null,
  },
  {
    student_id: "student-1",
    section: "M",
    domain: "Algebra",
    skill: "Systems of Two Linear Equations in Two Variables",
    event_count_total: 6,
    mastery_score: 0.42,
    mastery_level: 2,
  },
];

let failNextQuery = false;

/**
 * A query builder that APPLIES what it is given. The point is that the assertions below
 * are about returned rows, not about which builder methods ran.
 */
function makeQuery(rows: Row[]) {
  let working = [...rows];
  const builder = {
    eq(column: keyof Row, value: unknown) {
      working = working.filter((r) => r[column] === value);
      return builder;
    },
    not(column: keyof Row, op: string, value: unknown) {
      if (op !== "is" || value !== null) {
        throw new Error(`unsupported not(${column}, ${op}, ${String(value)})`);
      }
      working = working.filter((r) => r[column] !== null);
      return builder;
    },
    gte(column: keyof Row, value: number) {
      working = working.filter((r) => Number(r[column]) >= value);
      return builder;
    },
    order(column: keyof Row, opts: { ascending: boolean }) {
      working = [...working].sort((a, b) => {
        // Postgres sorts NULLs LAST on ASC by default. Reproducing that matters: it is
        // why the old `|| 0` coercion — applied AFTER the sort, in JS — was what put
        // unmeasured rows on top, and a fixture that sorted NULLs first would hide it.
        const av = a[column];
        const bv = b[column];
        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        return opts.ascending
          ? Number(av) - Number(bv)
          : Number(bv) - Number(av);
      });
      return builder;
    },
    limit(n: number) {
      working = working.slice(0, n);
      return builder;
    },
    then(
      resolve: (value: {
        data: Row[] | null;
        error: { message: string } | null;
      }) => unknown,
    ) {
      if (failNextQuery) {
        return Promise.resolve(
          resolve({ data: null, error: { message: "connection reset" } }),
        );
      }
      return Promise.resolve(resolve({ data: working, error: null }));
    },
  };
  return builder;
}

vi.mock("../../apps/api/src/lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== "student_skill_mastery") {
        throw new Error(`unexpected table: ${table}`);
      }
      return { select: () => makeQuery(SEED) };
    },
  }),
}));

describe("weakest skills — measured rows only", () => {
  beforeEach(() => {
    failNextQuery = false;
  });

  it("returns only the skill the formula actually scored", async () => {
    const { fetchWeakestSkills } =
      await import("../../apps/api/src/services/mastery-read");

    const rows = await fetchWeakestSkills({ userId: "student-1" });

    expect(rows).toHaveLength(1);
    expect(rows[0].skill).toBe(
      "Systems of Two Linear Equations in Two Variables",
    );
    expect(rows[0].mastery_score).toBe(0.42);
    expect(rows[0].mastery_level).toBe(2);

    // The two unmeasured skills must not appear under any label. Naming them
    // explicitly is what makes the restore-the-coercion mutation legible when it fails.
    const skills = rows.map((r) => r.skill);
    expect(skills).not.toContain("Linear Equations in One Variable");
    expect(skills).not.toContain("Linear Functions");
  });

  it("never reports a 0.0 score — an unmeasured skill is absent, not bottom-ranked", async () => {
    const { fetchWeakestSkills } =
      await import("../../apps/api/src/services/mastery-read");

    const rows = await fetchWeakestSkills({ userId: "student-1" });

    expect(rows.every((r) => r.mastery_score > 0)).toBe(true);
    expect(rows.every((r) => r.mastery_level !== null)).toBe(true);
  });

  it("throws on a query error rather than reporting no weaknesses", async () => {
    const { fetchWeakestSkills } =
      await import("../../apps/api/src/services/mastery-read");

    failNextQuery = true;

    await expect(fetchWeakestSkills({ userId: "student-1" })).rejects.toThrow(
      /weakest_skills_query_failed/,
    );
  });

  it("does not accept a caller-supplied evidence threshold", async () => {
    const masteryRead =
      await import("../../apps/api/src/services/mastery-read");

    // minAttempts is gone from the contract: a client query string must not be able to
    // lower the bar and resurface unmeasured skills. Passing it is a type error at
    // compile time; at runtime it must simply have no effect.
    const rows = await masteryRead.fetchWeakestSkills({
      userId: "student-1",
      ...({ minAttempts: 1 } as Record<string, never>),
    });

    expect(rows).toHaveLength(1);
  });
});
