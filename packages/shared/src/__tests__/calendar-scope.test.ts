/**
 * @spec [Doc_05F §7.4; supabase/migrations/20260917130000_calendar_v1.sql
 *        `calendar_scope_is_valid`] | @implemented [2026-09-17]
 * plain English: the shared scope schema accepts exactly what the CHECK accepts, and names
 * the rule when it does not. Every rejection below is a triple the database would also
 * refuse.
 */
import { describe, expect, it } from "vitest";
import {
  CANONICAL_DOMAINS,
  DOMAIN_SECTION,
  parseBlockScope,
  sectionOfDomain,
  type ScopeRule,
} from "../calendar/scope";

function rejectionOf(input: unknown): { rule: ScopeRule; detail: string; path: string } {
  const result = parseBlockScope(input);
  if (result.ok) {
    throw new Error(`expected a rejection, got ${JSON.stringify(result.value)}`);
  }
  return result.error;
}

describe("canonical domains", () => {
  it("is the eight names the domain CHECK enforces, Math first (canonical_domain_order)", () => {
    expect([...CANONICAL_DOMAINS]).toEqual([
      "Algebra",
      "Advanced Math",
      "Problem Solving and Data Analysis",
      "Geometry and Trigonometry",
      "Information and Ideas",
      "Craft and Structure",
      "Expression of Ideas",
      "Standard English Conventions",
    ]);
  });

  it("maps every domain to exactly one section, four each", () => {
    const math = CANONICAL_DOMAINS.filter((d) => DOMAIN_SECTION[d] === "M");
    const rw = CANONICAL_DOMAINS.filter((d) => DOMAIN_SECTION[d] === "RW");
    expect(math).toHaveLength(4);
    expect(rw).toHaveLength(4);
    expect(sectionOfDomain("Algebra")).toBe("M");
    expect(sectionOfDomain("Craft and Structure")).toBe("RW");
  });
});

describe("round-trips a row shaped like the DDL", () => {
  const rows = [
    {
      name: "practice, domain level — the steady-state block",
      row: {
        block_type: "practice",
        section: "M",
        scope: {
          level: "domain",
          mix: [
            { domain: "Algebra", count: 15, explanation_key: "weak" },
            { domain: "Geometry and Trigonometry", count: 5, explanation_key: "balanced" },
          ],
        },
      },
    },
    {
      name: "practice, section level — cold start and every fallback plan",
      row: {
        block_type: "practice",
        section: "RW",
        scope: { level: "section", count: 20, explanation_key: "cold_start" },
      },
    },
    {
      name: "review, queue mode",
      row: { block_type: "review", section: null, scope: { mode: "queue" } },
    },
    {
      name: "review, session mode",
      row: {
        block_type: "review",
        section: null,
        scope: {
          mode: "session",
          source_engine: "full_length",
          source_session_id: "6f1d2f5a-9f8a-4a1e-8f4c-0b2f1d3e4a5b",
        },
      },
    },
    {
      name: "full_length with a pinned form",
      row: { block_type: "full_length", section: null, scope: { form_id: "FORM-A", exam_mode: "strict" } },
    },
    {
      name: "full_length left to Doc 04 rotation (B3: key present, value null)",
      row: { block_type: "full_length", section: null, scope: { form_id: null, exam_mode: "lenient" } },
    },
  ] as const;

  for (const { name, row } of rows) {
    it(name, () => {
      const result = parseBlockScope(row);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual(row);
    });
  }
});

describe("rejects an invalid practice scope with the rule that failed", () => {
  const base = { block_type: "practice", section: "M" } as const;

  it("a practice block with no section (calendar_blocks_section_by_type)", () => {
    expect(
      rejectionOf({
        block_type: "practice",
        section: null,
        scope: { level: "section", count: 10, explanation_key: "cold_start" },
      }).rule,
    ).toBe("section_presence");
  });

  it("an unknown level", () => {
    expect(rejectionOf({ ...base, scope: { level: "skill", codes: ["LIN"] } }).rule).toBe(
      "scope_shape",
    );
  });

  it("an empty mix (jsonb_array_length >= 1)", () => {
    expect(rejectionOf({ ...base, scope: { level: "domain", mix: [] } }).rule).toBe(
      "scope_shape",
    );
  });

  it("a fractional count — the CHECK's ^[1-9][0-9]*$ refuses 10.5", () => {
    expect(
      rejectionOf({
        ...base,
        scope: {
          level: "domain",
          mix: [{ domain: "Algebra", count: 10.5, explanation_key: "weak" }],
        },
      }).rule,
    ).toBe("scope_shape");
  });

  it("a zero count", () => {
    expect(
      rejectionOf({
        ...base,
        scope: {
          level: "domain",
          mix: [{ domain: "Algebra", count: 0, explanation_key: "weak" }],
        },
      }).rule,
    ).toBe("scope_shape");
  });

  it("a mix entry missing explanation_key (mandatory per the merged CHECK)", () => {
    expect(
      rejectionOf({
        ...base,
        scope: { level: "domain", mix: [{ domain: "Algebra", count: 10 }] },
      }).rule,
    ).toBe("scope_shape");
  });

  it("an extra key in the scope (the CHECK counts keys exactly)", () => {
    expect(
      rejectionOf({
        ...base,
        scope: {
          level: "domain",
          mix: [{ domain: "Algebra", count: 10, explanation_key: "weak" }],
          skill_codes: ["LIN"],
        },
      }).rule,
    ).toBe("scope_shape");
  });

  it("the same domain twice (count(DISTINCT domain) = array_length)", () => {
    const rejection = rejectionOf({
      ...base,
      scope: {
        level: "domain",
        mix: [
          { domain: "Algebra", count: 10, explanation_key: "weak" },
          { domain: "Algebra", count: 5, explanation_key: "balanced" },
        ],
      },
    });
    expect(rejection.rule).toBe("domain_unique");
    expect(rejection.path).toBe("scope.mix.1.domain");
  });

  it("a Reading & Writing domain on a Math block", () => {
    const rejection = rejectionOf({
      ...base,
      scope: {
        level: "domain",
        mix: [{ domain: "Craft and Structure", count: 10, explanation_key: "weak" }],
      },
    });
    expect(rejection.rule).toBe("domain_section_match");
    expect(rejection.path).toBe("scope.mix.0.domain");
  });

  it("a domain that is not one of the canonical eight", () => {
    expect(
      rejectionOf({
        ...base,
        scope: {
          level: "domain",
          mix: [{ domain: "Linear Equations", count: 10, explanation_key: "weak" }],
        },
      }).rule,
    ).toBe("scope_shape");
  });
});

describe("rejects an invalid review scope with the rule that failed", () => {
  it("a review block carrying a section", () => {
    expect(
      rejectionOf({ block_type: "review", section: "M", scope: { mode: "queue" } }).rule,
    ).toBe("section_presence");
  });

  it("an unknown mode", () => {
    expect(
      rejectionOf({ block_type: "review", section: null, scope: { mode: "backlog" } }).rule,
    ).toBe("scope_shape");
  });

  it("queue mode with an extra key", () => {
    expect(
      rejectionOf({
        block_type: "review",
        section: null,
        scope: { mode: "queue", source_engine: "practice" },
      }).rule,
    ).toBe("scope_shape");
  });

  it("session mode missing source_session_id", () => {
    expect(
      rejectionOf({
        block_type: "review",
        section: null,
        scope: { mode: "session", source_engine: "practice" },
      }).rule,
    ).toBe("scope_shape");
  });

  it("session mode with a source_engine outside (practice, full_length)", () => {
    expect(
      rejectionOf({
        block_type: "review",
        section: null,
        scope: { mode: "session", source_engine: "review", source_session_id: "s1" },
      }).rule,
    ).toBe("scope_shape");
  });

  it("session mode with a JSON-null source_engine — the totality case the CHECK guards", () => {
    expect(
      rejectionOf({
        block_type: "review",
        section: null,
        scope: { mode: "session", source_engine: null, source_session_id: "s1" },
      }).rule,
    ).toBe("scope_shape");
  });
});

describe("rejects an invalid full_length scope with the rule that failed", () => {
  it("a full_length block carrying a section", () => {
    expect(
      rejectionOf({
        block_type: "full_length",
        section: "RW",
        scope: { form_id: null, exam_mode: "strict" },
      }).rule,
    ).toBe("section_presence");
  });

  it("an absent form_id key — required-present, nullable value (B3)", () => {
    expect(
      rejectionOf({ block_type: "full_length", section: null, scope: {} }).rule,
    ).toBe("scope_shape");
  });

  it("a non-string form_id", () => {
    expect(
      rejectionOf({
        block_type: "full_length",
        section: null,
        scope: { form_id: 7, exam_mode: "strict" },
      }).rule,
    ).toBe("scope_shape");
  });

  // SCL-167: exam_mode is the second REQUIRED key, in the exam engine's own vocabulary.
  it("an absent exam_mode key — both keys are required-present (SCL-167)", () => {
    expect(
      rejectionOf({ block_type: "full_length", section: null, scope: { form_id: null } }).rule,
    ).toBe("scope_shape");
  });

  it("an exam_mode the exam engine does not accept", () => {
    expect(
      rejectionOf({
        block_type: "full_length",
        section: null,
        scope: { form_id: null, exam_mode: "untimed" },
      }).rule,
    ).toBe("scope_shape");
  });

  it("an extra key", () => {
    expect(
      rejectionOf({
        block_type: "full_length",
        section: null,
        scope: { form_id: null, exam_mode: "strict", module: 2 },
      }).rule,
    ).toBe("scope_shape");
  });
});

describe("rejects an unknown block type", () => {
  it("names the block_type rule", () => {
    expect(
      rejectionOf({ block_type: "tutor", section: null, scope: { mode: "queue" } }).rule,
    ).toBe("block_type");
  });

  it("refuses a scope with no triple at all rather than casting it", () => {
    expect(rejectionOf(null).rule).toBe("block_type");
    expect(rejectionOf("practice").rule).toBe("block_type");
  });
});
