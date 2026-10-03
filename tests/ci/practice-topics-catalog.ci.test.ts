/**
 * F-56: the practice topic list is complete however large the question bank grows.
 *
 * @spec [Doc-02B_V4 §14; student-UI register §8 F-56; owner ruling (Karl) 2026-10-02: build the
 *   topic list from canonical_skill_catalog] | @implemented [2026-10-02]
 *
 * plain English: both database reads are faked with PostgREST's production behaviour, a response
 * capped at 1,000 rows (production returned `content-range: 0-999/*` for every topics call while
 * the bank held 6,821 servable questions). The bank has 1,001 rows, and one skill appears only
 * in the last row. `canonical_skill_catalog` is faked as the view computes it: DISTINCT
 * (section, domain, skill) over the same rows.
 * expected outcome: `GET /api/practice/topics` lists that skill. Built from the bank (the old
 * read), it was cut off at row 1,000 and the skill was missing.
 * edge cases: presence before absence is not needed here; the assertion IS presence, and the
 * fixture is checked to put the skill beyond the cap first, so the test cannot pass by the
 * skill landing inside the first 1,000 rows.
 */
import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const POSTGREST_MAX_ROWS = 1000;

type Row = { section: string; domain: string; skill_codes: string[] };

const COMMON_SKILL = "Linear equations in one variable";
const LATE_SKILL = "Circles";

const bank: Row[] = [
  ...Array.from({ length: POSTGREST_MAX_ROWS }, () => ({
    section: "M",
    domain: "Algebra",
    skill_codes: [COMMON_SKILL],
  })),
  {
    section: "M",
    domain: "Geometry and Trigonometry",
    skill_codes: [LATE_SKILL],
  },
];

function capped<T>(rows: T[]): { data: T[]; error: null } {
  return { data: rows.slice(0, POSTGREST_MAX_ROWS), error: null };
}

function catalogRows(): Array<{
  section: string;
  domain: string;
  skill: string;
}> {
  const seen = new Map<
    string,
    { section: string; domain: string; skill: string }
  >();
  for (const r of bank) {
    for (const skill of r.skill_codes) {
      seen.set(`${r.section}|${r.domain}|${skill}`, {
        section: r.section,
        domain: r.domain,
        skill,
      });
    }
  }
  return [...seen.values()];
}

/** A thenable PostgREST-shaped query that ignores filters it is not given. */
function query<T>(rows: () => T[]) {
  const q = {
    select: () => q,
    eq: () => q,
    then: <R>(resolve: (v: { data: T[]; error: null }) => R) =>
      Promise.resolve(capped(rows())).then(resolve),
  };
  return q;
}

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    from: (table: string) => {
      if (table !== "servable_questions")
        throw new Error(`unexpected table ${table}`);
      return query(() => bank);
    },
  },
}));

vi.mock("../../apps/api/src/lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== "canonical_skill_catalog")
        throw new Error(`unexpected table ${table}`);
      return query(catalogRows);
    },
  }),
}));

import { getPracticeTopics } from "../../server/routes/practice-topics-routes";

type TopicsBody = {
  sections: Array<{
    section: string;
    domains: Array<{ domain: string; skills: string[] }>;
  }>;
};

async function callTopics(): Promise<{ status: number; body: TopicsBody }> {
  let status = 0;
  let body: unknown;
  const res = {
    status(code: number) {
      status = code;
      return res;
    },
    json(payload: unknown) {
      body = payload;
      return res;
    },
  };
  await getPracticeTopics({} as Request, res as unknown as Response);
  return { status, body: body as TopicsBody };
}

describe("GET /api/practice/topics: complete beyond the PostgREST row cap (F-56)", () => {
  it("lists a skill that appears only after the first 1,000 bank rows", async () => {
    // The fixture really does put the late skill beyond the cap.
    expect(bank.length).toBe(POSTGREST_MAX_ROWS + 1);
    expect(
      capped(bank).data.some((r) => r.skill_codes.includes(LATE_SKILL)),
    ).toBe(false);

    const { status, body } = await callTopics();
    expect(status).toBe(200);

    const math = body.sections.find((s) => s.section === "M");
    const geometry = math?.domains.find(
      (d) => d.domain === "Geometry and Trigonometry",
    );
    const algebra = math?.domains.find((d) => d.domain === "Algebra");
    expect(algebra?.skills).toEqual([COMMON_SKILL]);
    expect(geometry?.skills).toEqual([LATE_SKILL]);
  });
});
